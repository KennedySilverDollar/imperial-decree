import { describe, expect, it } from "vitest";
import { GRID_SIZE } from "../../domain/constants";
import { terrainSeed } from "../../domain/Landscape";
import { ROAD_TILE_MAX } from "../../domain/constants";
import { distanceToPolyline, pointInPolygon, signedArea, type Point } from "./geometry2d";
import { HEIGHTMAP_SIZE, MAP_PX, RIVER_GAP, RIVER_WIDTH, SLOPE_MAX, TERRAIN_MAX_ATTEMPTS, VILLAGE_ORIGIN, VILLAGE_SIZE } from "./mapConstants";
import { mapParcels, villageOutline } from "./ParcelMapper";
import { buildRoadGraph, routeRoads } from "./RoadRouter";
import { allParcelsBuildable, cellCenter, distanceToVillage, generateTerrain, slopeAt, terrainHash } from "./TerrainGenerator";

// 測量図の地形・区画・道路（SPEC_v3.3 §5.2・§5.3・§13.1 / 不変条件18・19）

const SAVES = ["save-alpha", "save-beta", "save-gamma", "save-delta"];
const terrains = SAVES.map((id) => generateTerrain(terrainSeed(id)));

describe("地形生成の決定論", () => {
  it("同じ saveId なら同じ地形（指紋が一致）、違う saveId なら違う地形", () => {
    expect(terrainHash(generateTerrain(terrainSeed(SAVES[0] as string)))).toBe(terrainHash(terrains[0] as never));
    const hashes = new Set(terrains.map(terrainHash));
    expect(hashes.size).toBe(SAVES.length);
  }, 30000);
});

describe("村域の100区画はすべて建設可能", () => {
  it("どの区画にも水（川・沼）も急傾斜も無い", () => {
    for (const t of terrains) {
      expect(allParcelsBuildable(t)).toBe(true);
      for (const parcel of t.parcels) {
        for (let j = 0; j < HEIGHTMAP_SIZE; j += 3)
          for (let i = 0; i < HEIGHTMAP_SIZE; i += 3) {
            const c = cellCenter(i, j);
            if (!pointInPolygon(c, parcel.polygon)) continue;
            expect(t.water[j * HEIGHTMAP_SIZE + i]).toBe(0);
            expect(slopeAt(t.heightmap, i, j)).toBeLessThan(SLOPE_MAX);
          }
      }
    }
  });

  it("川は地図の縁から縁へ流れ、村域とその周り（RIVER_GAP）に入らない。沼は 0〜1 個で村域の外", () => {
    for (const t of terrains) {
      expect(t.river.length).toBeGreaterThan(10);
      for (const p of t.river) expect(distanceToVillage(p)).toBeGreaterThanOrEqual(RIVER_GAP);
      const ends = [t.river[0] as Point, t.river[t.river.length - 1] as Point];
      for (const e of ends) expect(Math.min(e.x, e.y, MAP_PX - e.x, MAP_PX - e.y)).toBeLessThan(1);
      expect(t.lakes.length).toBeLessThanOrEqual(1);
      for (const lake of t.lakes) for (const p of lake) expect(distanceToVillage(p)).toBeGreaterThan(RIVER_GAP);
      expect(t.water.some((w) => w === 1)).toBe(true);
    }
  });

  it("川の上流は下流より高い（高い縁から低い縁へ）", () => {
    for (const t of terrains) {
      const cell = (v: number) => Math.min(HEIGHTMAP_SIZE - 1, Math.floor(v / (MAP_PX / HEIGHTMAP_SIZE)));
      const at = (p: Point) => t.heightmap[cell(p.y) * HEIGHTMAP_SIZE + cell(p.x)] as number;
      const head = t.river.slice(0, 40).map(at);
      const tail = t.river.slice(-40).map(at);
      expect(head.reduce((a, b) => a + b) / head.length).toBeGreaterThanOrEqual(tail.reduce((a, b) => a + b) / tail.length);
    }
  });

  it("建設可能にできないときは seed を派生させて作り直す（回数に上限、同じ saveId で同じ結果）", () => {
    const seed = terrainSeed("retry");
    const failTwice = (_: unknown, attempt: number) => attempt >= 3;
    const a = generateTerrain(seed, { check: failTwice });
    const b = generateTerrain(seed, { check: failTwice });
    expect(a.attempts).toBe(3);
    expect(terrainHash(a)).toBe(terrainHash(b));
    expect(terrainHash(a)).not.toBe(terrainHash(generateTerrain(seed)));

    let calls = 0;
    const never = () => {
      calls++;
      return false;
    };
    const safe = generateTerrain(seed, { check: never });
    expect(calls).toBe(TERRAIN_MAX_ATTEMPTS);
    expect(safe.attempts).toBe(TERRAIN_MAX_ATTEMPTS + 1);
    expect(allParcelsBuildable(safe)).toBe(true);
    // 安全な地形でも筋書き（地名）は変わらない
    expect(safe.plan).toEqual(a.plan);
  }, 60000);

  it("森・沼・川は村域の区画にかからない（森は村域から離す）", () => {
    for (const t of terrains) {
      for (let k = 0; k < t.forestMask.length; k++) {
        if ((t.forestMask[k] as number) === 0) continue;
        const c = cellCenter(k % HEIGHTMAP_SIZE, Math.floor(k / HEIGHTMAP_SIZE));
        expect(distanceToVillage(c)).toBeGreaterThan(RIVER_WIDTH);
      }
    }
  });
});

describe("区画の写像", () => {
  const parcels = mapParcels(terrainSeed("parcels"));

  it("論理グリッドと1対1（100区画、gridIndex = y*10+x）", () => {
    expect(parcels).toHaveLength(GRID_SIZE * GRID_SIZE);
    parcels.forEach((p, i) => {
      expect(p.gridIndex).toBe(i);
      expect(p.gridIndex).toBe(p.y * GRID_SIZE + p.x);
    });
  });

  it("どの区画も時計回りの単純な多角形（辺が交わらない）", () => {
    for (const p of parcels) {
      expect(signedArea(p.polygon)).toBeGreaterThan(0);
      const n = p.polygon.length;
      for (let a = 0; a < n; a++)
        for (let b = a + 2; b < n; b++) {
          if (a === 0 && b === n - 1) continue;
          expect(segmentsCross(p.polygon[a] as Point, p.polygon[(a + 1) % n] as Point, p.polygon[b] as Point, p.polygon[(b + 1) % n] as Point)).toBe(false);
        }
    }
  });

  it("区画は重ならず隙間がない：面積の和が村域と等しく、村域のどの点もちょうど1区画に入る", () => {
    const total = parcels.reduce((s, p) => s + signedArea(p.polygon), 0);
    expect(total).toBeCloseTo(signedArea(villageOutline(parcels)), 3);
    expect(total).toBeCloseTo(VILLAGE_SIZE * VILLAGE_SIZE, 3);
    const step = VILLAGE_SIZE / 97;
    for (let y = VILLAGE_ORIGIN + step / 3; y < VILLAGE_ORIGIN + VILLAGE_SIZE; y += step)
      for (let x = VILLAGE_ORIGIN + step / 3; x < VILLAGE_ORIGIN + VILLAGE_SIZE; x += step) {
        const hits = parcels.filter((p) => pointInPolygon({ x, y }, p.polygon)).length;
        expect(hits, `${x},${y}`).toBe(1);
      }
  });

  it("隣り合う区画は同じ境界の点を共有する（揺らした辺も一致）", () => {
    const right = parcels[0]?.polygon.slice(3, 6) ?? [];
    const leftOfNeighbor = parcels[1]?.polygon.slice(9, 12).reverse() ?? [];
    // 区画 (0,0) の右辺（上→下）と区画 (1,0) の左辺（下→上）は同じ点を逆にたどる
    expect(right.slice(1)).toEqual(leftOfNeighbor.slice(0, 2));
  });

  it("同じ seed なら同じ区画", () => {
    expect(mapParcels(terrainSeed("parcels"))).toEqual(parcels);
  });
});

describe("道路", () => {
  const t = terrains[0];
  if (!t) throw new Error("no terrain");
  const graph = buildRoadGraph(t.parcels);
  const edgeSet = new Set<string>();
  graph.adjacent.forEach((list, a) => list.forEach(({ to }) => edgeSet.add(`${a}-${to}`)));

  it("A* の経路は区画の境界の辺だけをたどる", () => {
    const roads = routeRoads(graph, ROAD_TILE_MAX);
    expect(roads.paths.length).toBeGreaterThan(0);
    for (const path of roads.paths)
      for (let i = 0; i + 1 < path.length; i++) expect(edgeSet.has(`${path[i]}-${path[i + 1]}`)).toBe(true);
  });

  it("滑らかにした道の中心線は区画の内部を横切らない（どの区画の中にも、境界からわずか以上は入らない）", () => {
    const roads = routeRoads(graph, ROAD_TILE_MAX);
    const tolerance = 4;
    for (const curve of roads.curves) {
      expect(curve.length).toBeGreaterThan(2);
      for (const p of curve) {
        for (const parcel of t.parcels) {
          if (!pointInPolygon(p, parcel.polygon)) continue;
          expect(distanceToPolyline(p, [...parcel.polygon, parcel.polygon[0] as Point])).toBeLessThan(tolerance);
        }
      }
    }
  });

  it("道路の本数（論理）が増えると道は伸び、0本なら道は無い", () => {
    expect(routeRoads(graph, 0).paths).toHaveLength(0);
    const short = routeRoads(graph, 3);
    const long = routeRoads(graph, ROAD_TILE_MAX);
    const length = (r: typeof short) => r.chains.reduce((s, c) => s + c.reduce((acc, p, i) => (i === 0 ? 0 : acc + Math.hypot(p.x - (c[i - 1] as Point).x, p.y - (c[i - 1] as Point).y)), 0), 0);
    expect(length(long)).toBeGreaterThan(length(short));
  });

  it("同じ地形・同じ本数なら同じ道（決定論）", () => {
    expect(routeRoads(buildRoadGraph(t.parcels), 7)).toEqual(routeRoads(graph, 7));
  });
});

const segmentsCross = (a: Point, b: Point, c: Point, d: Point): boolean => {
  const orient = (p: Point, q: Point, r: Point) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  return o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0;
};
