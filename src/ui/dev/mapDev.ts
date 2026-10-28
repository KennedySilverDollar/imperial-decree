import type { GameState } from "../../domain/GameState";
import { projectMapView } from "../game/projectMapView";
import { drawMapLayers, type Baked } from "../map/cartography/Layers";
import { LOD_WIDTH_M, type Lod, type MapView } from "../map/cartography/lod";
import { composeMap } from "../map/composeMap";
import { drawAbstractGrid } from "../map/drawMap";
import type { MapViewModel } from "../map/MapViewModel";
import { buildRelief } from "../map/model3d/ReliefMesh";
import { DEFAULT_CAMERA, drawRelief } from "../map/model3d/ReliefModel";
import { loadTerrain } from "../map/terrainClient";
import { RELIEF_LIGHT } from "../desk/lighting";

// 開発用ページ（map-dev.html）。scripts/map-browser.mjs が window.mapStates に GameState を入れて開く。
// 各状態を MapViewModel に投影して、測量図を L0〜L3 で描き（M3）、抽象グリッドも並べる。
// さらに「見えない値だけを変えた状態」（空洞・開示・資材・工事の進捗と建材と工期・イベント）でも、
// どの段階でも同じ画素になるかを確かめる（SPEC_v3.4 §12.3・§12.4）。?lite=1 で軽量モード。

interface Row {
  readonly label: string;
  readonly state: GameState;
}

const SIZE = 792;
const GRID = 300;
const RELIEF = 420;
const lite = new URLSearchParams(window.location.search).get("lite") === "1";

/** 見た目に出てはいけない値だけを変える */
const hiddenVariant = (s: GameState): GameState => ({
  ...s,
  buildings: s.buildings.map((b) => ({ ...b, hollow: !b.hollow, disclosed: !b.disclosed })),
  projects: s.projects.map((p) => ({ ...p, progress: p.progress + 0.37 * p.work, work: p.work * 2, wood: p.wood + 5, stone: p.stone + 7, minTurns: p.minTurns + 2 })),
  materials: { ...s.materials, wood: s.materials.wood + 123, stone: s.materials.stone + 45 },
  event: null,
});

const canvas = (size: number): [HTMLCanvasElement, CanvasRenderingContext2D] => {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  return [c, ctx];
};

/** 段階ごとの表示：L0 は地図全体、L1・L2 は村の中心、L3 は建物の多い区画 */
const viewFor = (lod: Lod, vm: MapViewModel, worldM: number, center: readonly [number, number], siteOf: (g: number) => readonly [number, number]): MapView => {
  if (lod === 0) return { center: [worldM / 2, worldM / 2], widthM: LOD_WIDTH_M[0] };
  if (lod === 3) {
    const g = vm.buildings.find((b) => b.kind !== "farm")?.gridIndex ?? vm.buildings[0]?.gridIndex;
    return { center: g === undefined ? center : siteOf(g), widthM: LOD_WIDTH_M[3] };
  }
  return { center, widthM: LOD_WIDTH_M[lod] };
};

const main = async () => {
  const rows = (window as unknown as { mapStates?: Row[] }).mapStates ?? [];
  const host = document.getElementById("maps");
  const results: unknown[] = [];
  for (const { label, state } of rows) {
    const view = projectMapView(state);
    const hidden = projectMapView(hiddenVariant(state));
    const terrain = await loadTerrain(state.saveId);
    const [grid, gctx] = canvas(GRID);
    drawAbstractGrid(gctx, GRID, view);
    const lods: unknown[] = [];
    if (terrain) {
      const baked: readonly Baked[] = terrain.layers;
      const t0 = performance.now();
      const comp = composeMap(view, terrain.data);
      const composeMs = performance.now() - t0;
      const compHidden = composeMap(hidden, terrain.data);
      const F = terrain.data.village.frame;
      const comps = { comp, compHidden };
      for (const lod of [0, 1, 2, 3] as const) {
        const v = viewFor(lod, view, terrain.data.worldM, F.center, (g) => comp.shapes[g]!.site);
        const opts = { view: v, lite, inking: new Map<number, number>(), hover: null, selected: null };
        const box = document.createElement("div");
        box.className = "row";
        box.id = `map-${label}-L${lod}`;
        const [main, ctx] = canvas(SIZE);
        const t1 = performance.now();
        drawMapLayers(ctx, SIZE, comps.comp, terrain.data, baked, view, opts);
        const drawMs = performance.now() - t1;
        const [, ctx2] = canvas(SIZE);
        drawMapLayers(ctx2, SIZE, comps.compHidden, terrain.data, baked, hidden, opts);
        const a = ctx.getImageData(0, 0, SIZE, SIZE).data;
        const b = ctx2.getImageData(0, 0, SIZE, SIZE).data;
        const pixelsEqual = a.length === b.length && a.every((x, i) => x === b[i]);
        box.append(main);
        if (lod === 1) box.append(grid);
        host?.append(box);
        lods.push({ lod, widthM: v.widthM, drawMs: Math.round(drawMs * 10) / 10, pixelsEqual });
      }
      // 地形模型（M4）：既定の向きと、回して低く見た向き。見えない値だけを変えた状態と画素を比べる
      const reliefs: unknown[] = [];
      const cams = [DEFAULT_CAMERA, { yaw: 2.3, pitch: 0.45, zoom: 1.8 }];
      for (const [k, cam] of cams.entries()) {
        const box = document.createElement("div");
        box.className = "row";
        box.id = `relief-${label}-${k}`;
        const [main, ctx] = canvas(RELIEF);
        const t1 = performance.now();
        const scene = buildRelief(terrain.data, comps.comp);
        const buildMs = performance.now() - t1;
        // 1 枚の描画時間：5 回の中央値（初回は JIT と字の準備で長い）
        const times: number[] = [];
        let stats = { primitives: 0 };
        for (let r = 0; r < 5; r++) {
          ctx.clearRect(0, 0, RELIEF, RELIEF);
          const t2 = performance.now();
          stats = drawRelief(ctx, RELIEF, scene, cam, RELIEF_LIGHT);
          times.push(performance.now() - t2);
        }
        const drawMs = times.sort((p, q) => p - q)[2]!;
        const [, ctx2] = canvas(RELIEF);
        drawRelief(ctx2, RELIEF, buildRelief(terrain.data, comps.compHidden), cam, RELIEF_LIGHT);
        const a = ctx.getImageData(0, 0, RELIEF, RELIEF).data;
        const b = ctx2.getImageData(0, 0, RELIEF, RELIEF).data;
        box.append(main);
        host?.append(box);
        reliefs.push({ camera: k, buildMs: Math.round(buildMs), drawMs: Math.round(drawMs * 10) / 10, primitives: stats.primitives, pixelsEqual: a.every((x, i) => x === b[i]) });
      }
      results.push({
        label,
        terrain: true,
        reliefs,
        workerMs: Math.round(terrain.workerMs),
        bakeMs: terrain.bakeMs,
        composeMs: Math.round(composeMs),
        viewEqual: JSON.stringify(view) === JSON.stringify(hidden),
        lods,
        buildings: view.buildings.length,
        construction: view.construction.length,
        roads: view.roads.length,
        hollow: state.buildings.filter((b) => b.hollow).length,
      });
    } else {
      results.push({ label, terrain: false });
    }
    const log = document.getElementById("log");
    if (log) log.textContent = JSON.stringify(results, null, 1);
  }
  (window as unknown as { mapResults: unknown }).mapResults = results;
  document.body.dataset.done = "true";
};

void main();
