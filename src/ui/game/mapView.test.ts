import fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";
import { createInitialState, type GameState } from "../../domain/GameState";
import { mapOf } from "../../engine/MapUpdater";
import { playedState } from "../../test/gameApi";
import { convexOverlap } from "../map/BuildingLayout";
import { layoutClearing, markConstruction } from "../map/Clearing";
import { composeMap, parcelShapesOf } from "../map/composeMap";
import { ROAD_WIDTH_M } from "../map/mapConstants";
import type { MapViewModel } from "../map/MapViewModel";
import { routeRoads } from "../map/RoadRouter";
import { generateTerrain } from "../map/terrain/generateTerrain";
import { pointInPolygon, pointSegmentDistance } from "../map/terrain/geometry";
import type { Point, TerrainDataV2 } from "../map/terrain/types";
import { projectMapView } from "./projectMapView";

// 地図の投影と M2 の構図（SPEC_v3.4 §12.2・§12.3）。GameState を使うので src/ui/map/ の外に置く（不変条件26）。

const SMALL = { surroundN: 512, villageN: 512, precheckN: 128 } as const;
const DECREES = ["家を建てよ", "畑を開け", "道を造れ", "家を建てよ", "井戸を掘れ", "畑を開け", "市場を開け", "道を造れ", "家を建てよ", "倉を建てよ", "長屋を建てよ", "畑を開け"];

let states: GameState[] = [];
let terrains: TerrainDataV2[] = [];

beforeAll(async () => {
  states = [createInitialState(1), createInitialState(2), await playedState(3, DECREES), await playedState(4, DECREES.slice(0, 8))];
  terrains = states.slice(0, 3).map((s) => {
    const r = generateTerrain(s.saveId, SMALL);
    if (!r.ok) throw new Error("terrain failed");
    return r.data;
  });
}, 120_000);

/** 見た目に出てはいけない値（空洞・開示・資材・工事の進捗と建材と工期・イベント・派生指標の元・労働人口などの台帳・履歴・乱数）だけを変える */
const hiddenChanges = fc.record({
  flip: fc.array(fc.boolean(), { minLength: 64, maxLength: 64 }),
  disclose: fc.array(fc.boolean(), { minLength: 64, maxLength: 64 }),
  wood: fc.integer({ min: 0, max: 5000 }),
  stone: fc.integer({ min: 0, max: 5000 }),
  progress: fc.double({ min: 0, max: 10, noNaN: true }),
  minTurns: fc.integer({ min: 0, max: 9 }),
  event: fc.constantFrom(null, "plague", "famine", "bandits"),
  population: fc.integer({ min: 0, max: 900 }),
  treasury: fc.integer({ min: -500, max: 5000 }),
  happiness: fc.integer({ min: 0, max: 100 }),
  corruption: fc.integer({ min: 0, max: 100 }),
  rng: fc.integer({ min: 0, max: 0xffffffff }),
  dropHistory: fc.boolean(),
});

type Hidden = typeof hiddenChanges extends fc.Arbitrary<infer T> ? T : never;

const withHidden = (s: GameState, h: Hidden): GameState =>
  ({
    ...s,
    rngState: h.rng,
    params: { ...s.params, population: h.population, treasury: h.treasury, happiness: h.happiness, corruption: h.corruption },
    buildings: s.buildings.map((b, k) => ({ ...b, hollow: h.flip[k % 64]! ? !b.hollow : b.hollow, disclosed: h.disclose[k % 64]! })),
    projects: s.projects.map((p) => ({ ...p, progress: p.work * h.progress, wood: p.wood + h.wood, stone: p.stone + h.stone, minTurns: h.minTurns })),
    materials: { wood: h.wood, stone: h.stone },
    event: h.event === null ? null : { kind: h.event, turns: 1, startedTurn: s.turn },
    eventCooldown: h.minTurns,
    history: h.dropHistory ? [] : s.history,
  }) as GameState;

describe("projectMapView（§5.2・§12.3）", () => {
  it("空洞・資材・工事の進捗・派生指標の元・イベントだけが違う2つの状態から、同じ MapViewModel が得られる", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 3 }), hiddenChanges, (k, h) => {
        const s = states[k]!;
        expect(projectMapView(withHidden(s, h))).toEqual(projectMapView(s));
      }),
      { numRuns: 120 },
    );
  });

  it("MapViewModel には見えない値の欄がない（空洞・進捗・資材・イベント・台帳）", () => {
    for (const s of states) {
      const text = JSON.stringify(projectMapView(s));
      for (const key of ["hollow", "disclosed", "progress", "work", "wood", "stone", "minTurns", "materials", "event", "population", "treasury", "happiness", "corruption", "derived", "labor"]) {
        expect(text.includes(`"${key}"`)).toBe(false);
      }
    }
  });

  it("区画の割当は MapState のまま。修繕の工事は出さない。普請中は種別・区画・棟数だけ", () => {
    for (const s of states) {
      const vm = projectMapView(s);
      const map = mapOf(s);
      expect(vm.parcels).toHaveLength(100);
      for (const p of vm.parcels) expect(p.use).toBe(map.tiles[p.y]![p.x]!.kind);
      expect(vm.construction.map((c) => c.id)).toEqual(s.projects.filter((p) => !p.repair && p.tiles.length > 0).map((p) => p.id).sort((a, b) => a - b));
      for (const c of vm.construction) expect(Object.keys(c).sort()).toEqual(["category", "count", "gridIndices", "id", "kind"]);
    }
  });

  it("整備済みの道路区画の数 = floor(インフラ/5)（最大19）。十字の区画の先頭から順に", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 400, noNaN: true }), (infra) => {
        const s = { ...states[0]!, params: { ...states[0]!.params, infrastructure: infra } };
        const vm = projectMapView(s);
        expect(vm.roads).toHaveLength(Math.min(19, Math.floor(infra / 5)));
        expect(vm.roads.map((r) => r.gridIndex)).toEqual(vm.roadPlan.slice(0, vm.roads.length));
        expect(vm.roads.length).toBe(mapOf(s).roads);
      }),
    );
  });
});

describe("区画の写像（ParcelMapper、§4.1・§12.2）", () => {
  it("100区画がセルと1対1で、重ならず隙間がない（村域の点はちょうど1つの区画に入る）", () => {
    for (const t of terrains) {
      const shapes = parcelShapesOf(t);
      expect(shapes).toHaveLength(100);
      const F = t.village.frame;
      shapes.forEach((s, k) => {
        expect(s.gridIndex).toBe(k);
        expect(pointInPolygon(s.siteLocal, s.local)).toBe(true);
        // 母点は自分のセルの枠の中
        expect(s.siteLocal[0]).toBeGreaterThanOrEqual(s.x * 60 - F.halfM);
        expect(s.siteLocal[0]).toBeLessThanOrEqual((s.x + 1) * 60 - F.halfM);
        expect(s.siteLocal[1]).toBeLessThanOrEqual(F.halfM - s.y * 60);
        expect(s.siteLocal[1]).toBeGreaterThanOrEqual(F.halfM - (s.y + 1) * 60);
      });
      for (let a = -F.halfM + 3.7; a < F.halfM; a += 11.3) {
        for (let b = -F.halfM + 2.9; b < F.halfM; b += 11.3) {
          expect(shapes.filter((s) => pointInPolygon([a, b], s.local))).toHaveLength(1);
        }
      }
    }
  });

  it("同じ地形から同じ区画（決定論）", () => {
    const again = generateTerrain(states[0]!.saveId, SMALL);
    if (!again.ok) throw new Error("terrain failed");
    expect(JSON.stringify(parcelShapesOf(again.data))).toBe(JSON.stringify(parcelShapesOf(terrains[0]!)));
  });
});

const roadPointsInside = (t: TerrainDataV2, vm: MapViewModel, points: readonly Point[]) => {
  const shapes = parcelShapesOf(t);
  const cross = shapes.filter((s) => vm.parcels[s.gridIndex]!.onCross);
  // 腕の端（村域の枠の上の点）は、十字の区画の辺の上にあればよい
  const onEdge = (p: Point, poly: readonly Point[]) => poly.some((q, i) => pointSegmentDistance(p, poly[(i + poly.length - 1) % poly.length]!, q) < 1e-6);
  return points.every((p) => cross.some((s) => pointInPolygon(p, s.polygon) || onEdge(p, s.polygon)));
};

describe("本通り（RoadRouter、§4.2・§12.2）", () => {
  it("描く本数は floor(インフラ/5)（最大19）と常に一致し、帯は連続し、十字の区画の中だけを通る", () => {
    for (const t of terrains) {
      const shapes = parcelShapesOf(t);
      for (let infra = 0; infra <= 120; infra += 2.5) {
        const vm = projectMapView({ ...states[0]!, params: { ...states[0]!.params, infrastructure: infra } });
        const layout = routeRoads(t.village.frame, shapes, vm.parcels, vm.roads, vm.buildings, t.highway.from);
        expect(new Set(layout.pieces.map((p) => p.gridIndex)).size).toBe(Math.min(19, Math.floor(infra / 5)));
        for (const piece of layout.pieces) expect(roadPointsInside(t, vm, piece.points)).toBe(true);
        // 連続：端が接する区間どうし、同じ区画（中央の横と縦）どうしをつなぐと、全体が1つにまとまる
        const n = layout.pieces.length;
        const parent = Array.from({ length: n }, (_, i) => i);
        const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
        const ends = (i: number) => [layout.pieces[i]!.points[0]!, layout.pieces[i]!.points[layout.pieces[i]!.points.length - 1]!];
        for (let i = 0; i < n; i++) {
          for (let j = i + 1; j < n; j++) {
            const touch = ends(i).some((e) => ends(j).some((q) => Math.hypot(q[0] - e[0], q[1] - e[1]) < 0.5));
            if (touch || layout.pieces[i]!.gridIndex === layout.pieces[j]!.gridIndex) parent[find(i)] = find(j);
          }
        }
        expect(new Set(Array.from({ length: n }, (_, i) => find(i))).size).toBeLessThanOrEqual(1);
      }
    }
  });

  it("街道へ続く腕の未整備の部分は踏み跡、街道はその腕の端から出る", () => {
    const t = terrains[0]!;
    const vm = projectMapView(states[0]!);
    const comp = composeMap(vm, t);
    const end = t.highway.points[0]!;
    if (comp.roads.trail.length > 0) {
      const last = comp.roads.trail[comp.roads.trail.length - 1]!;
      const first = comp.roads.trail[0]!;
      expect(Math.min(Math.hypot(last[0] - end[0], last[1] - end[1]), Math.hypot(first[0] - end[0], first[1] - end[1]))).toBeLessThan(1);
    }
  });

  it("道路と脇道は、完成した建物・普請中の区画の内部を横切らない", () => {
    for (const [k, t] of terrains.entries()) {
      const vm = projectMapView(states[k + 1] ?? states[k]!);
      const comp = composeMap(vm, t);
      const blocked = new Set(vm.parcels.filter((p) => p.use === "building" || p.use === "construction").map((p) => p.gridIndex));
      for (const path of comp.roads.sidePaths) {
        const own = vm.buildings.find((b) => b.id === path.buildingId)!.gridIndex;
        const [a, b] = path.points as [Point, Point];
        for (let s = 0.05; s < 1; s += 0.05) {
          const p: Point = [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s];
          const owner = comp.shapes.find((sh) => pointInPolygon(p, sh.polygon));
          if (owner && owner.gridIndex !== own) expect(blocked.has(owner.gridIndex)).toBe(false);
        }
      }
      // 本通りの帯（幅つき）は建物の棟に触れない
      for (const plan of comp.buildings) {
        for (const part of plan.parts.filter((x) => x.role === "structure")) {
          for (const q of part.polygon) {
            for (const piece of comp.roads.pieces) {
              for (let i = 0; i + 1 < piece.points.length; i++) {
                expect(pointSegmentDistance(q, piece.points[i]!, piece.points[i + 1]!)).toBeGreaterThan(ROAD_WIDTH_M / 2);
              }
            }
          }
        }
      }
    }
  });
});

describe("建物・普請中・開墾（§4.3・§8.1・§8.2・§12.2・§12.3）", () => {
  it("建物の外構と棟は区画の内側に収まり、棟どうしは重ならない。同じ建物IDなら同じ姿", () => {
    for (const [k, t] of terrains.entries()) {
      const vm = projectMapView(states[k + 1] ?? states[k]!);
      const comp = composeMap(vm, t);
      const again = composeMap(vm, t);
      expect(JSON.stringify(again.buildings)).toBe(JSON.stringify(comp.buildings));
      for (const plan of comp.buildings) {
        const shape = comp.shapes[plan.gridIndex]!;
        for (const part of plan.parts) for (const q of part.polygon) expect(pointInPolygon(q, shape.polygon)).toBe(true);
        const structures = plan.parts.filter((x) => x.role === "structure");
        expect(structures.length).toBeGreaterThan(0);
        structures.forEach((p, i) => structures.forEach((q, j) => j > i && expect(convexOverlap(p.polygon, q.polygon)).toBe(false)));
      }
    }
  });

  it("普請中の印は一様（種別・進捗によらない）。区画の内側に収まる", () => {
    const t = terrains[0]!;
    const shapes = parcelShapesOf(t);
    const a = markConstruction(t.village.frame, shapes, [{ id: 1, kind: "granary", category: "economy", gridIndices: [12], count: 1 }]);
    const b = markConstruction(t.village.frame, shapes, [{ id: 1, kind: "temple", category: "social", gridIndices: [12], count: 3 }]);
    expect(b).toEqual(a);
    for (const q of a[0]!.rope) expect(pointInPolygon(q, shapes[12]!.polygon)).toBe(true);
  });

  it("開墾は完成した畑の数と位置だけで決まる（他の建物では変わらず、畑が増えると広がる。上限あり）", () => {
    const t = terrains[0]!;
    const F = t.village.frame;
    const shapes = parcelShapesOf(t);
    const farm = (id: number, gridIndex: number) => ({ id, kind: "farm" as const, category: "economy" as const, gridIndex, count: 1, builtTurn: 1 });
    const house = { id: 99, kind: "residential" as const, category: "housing" as const, gridIndex: 23, count: 1, builtTurn: 1 };
    const one = layoutClearing(F, shapes, [farm(1, 0)]);
    expect(layoutClearing(F, shapes, [farm(1, 0), house])).toEqual(one);
    expect(layoutClearing(F, shapes, [house]).clearing).toBeNull();
    const many = layoutClearing(F, shapes, Array.from({ length: 20 }, (_, k) => farm(k, k)));
    expect(many.reachM).toBeGreaterThan(one.reachM);
    expect(many.reachM).toBeLessThanOrEqual(60);
  });

  it("構図全体も、見えない値だけが違う状態から同じになる（開墾・密集・建物の姿・普請中）", () => {
    fc.assert(
      fc.property(hiddenChanges, (h) => {
        const s = states[2]!;
        const t = terrains[2]!;
        expect(JSON.stringify(composeMap(projectMapView(withHidden(s, h)), t))).toBe(JSON.stringify(composeMap(projectMapView(s), t)));
      }),
      { numRuns: 25 },
    );
  });
});
