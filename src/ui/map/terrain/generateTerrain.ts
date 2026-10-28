import { buildHeight, makeLayout, planeProtectMask, type TerrainLayout } from "./BaseTerrain";
import { hydraulicErosion, thermalErosion } from "./Erosion";
import { classifyGeology, waterDistance } from "./Geology";
import { polygonArea, polygonClearance, polylineClearance, toWorld } from "./geometry";
import { filterComponents, gridOf, quantize, sampleBilinear, type Grid } from "./grid";
import { routeHighway } from "./Highway";
import {
  extractRivers,
  lakeMask,
  lakePolygons,
  meanderRivers,
  placeOldChannels,
  rasterizeRivers,
  route,
  toRivers,
  waterCellsInVillage,
} from "./Hydrology";
import { maskToPolygons } from "./MarchingSquares";
import { createRandom, subSeed, terrainSeed } from "./rng";
import {
  MAX_TERRAIN_ATTEMPTS,
  MOUNTAIN_ABOVE_VILLAGE_M,
  PARCEL_M,
  PARCEL_SLOPE_MAX_DEG,
  PASS_RISE_M,
  PEAK_SEPARATION_M,
  PRECHECK_MARGIN_M,
  PRECHECK_N,
  RIVER_CLEARANCE_M,
  SURROUND_HEIGHT_STEP_M,
  SURROUND_N,
  TOPONYM_COUNTS,
  VILLAGE_CELLS,
  VILLAGE_N,
  WATER_CLEARANCE_M,
} from "./terrainConstants";
import { assignToponyms, districtOf, generateToponymNames } from "./Toponyms";
import type { AttemptFailure, Point, Polygon, TerrainDataV2, TerrainResult } from "./types";
import { classifyVegetation, rasterizePolygons, VEGETATION_CLASS } from "./Vegetation";
import { buildParcels, buildVillageField, villageNormals } from "./Village";

// 地形生成 v2 の司令塔（SPEC_v3.4 §3.1）。純関数：saveId（と解像度）が同じなら同じ TerrainDataV2 を返す。
// 試行ごとに seed を派生させ、村域の条件（水域なし・傾斜 ≤ 5°）、川の条件、街道の到達を満たすまで再試行する。
// 上限を超えたら ok: false（表示は抽象グリッドに戻る。不変条件29）。

export interface TerrainOptions {
  readonly surroundN?: number;
  readonly villageN?: number;
  readonly precheckN?: number;
  readonly maxAttempts?: number;
}

const now = (): number => performance.now();

const centroid = (poly: Polygon): Point => {
  let x = 0;
  let y = 0;
  for (const p of poly) {
    x += p[0];
    y += p[1];
  }
  return [x / poly.length, y / poly.length];
};

/** 頂を拾う（粗い格子の極大。互いに離れ、村から離れたもの） */
const findPeaks = (H: Float32Array, g: Grid, center: Point): { anchor: Point; height: number }[] => {
  const c = 64;
  const ratio = g.n / c;
  const block = new Float32Array(c * c).fill(-Infinity);
  const where: Point[] = new Array<Point>(c * c);
  for (let j = 0; j < g.n; j++) {
    for (let i = 0; i < g.n; i++) {
      const k = Math.floor(j / ratio) * c + Math.floor(i / ratio);
      if (H[j * g.n + i]! > block[k]!) {
        block[k] = H[j * g.n + i]!;
        where[k] = [(i + 0.5) * g.cell, (j + 0.5) * g.cell];
      }
    }
  }
  const cands: { anchor: Point; height: number }[] = [];
  for (let j = 1; j < c - 1; j++) {
    for (let i = 1; i < c - 1; i++) {
      const k = j * c + i;
      let isMax = true;
      for (let dj = -1; dj <= 1 && isMax; dj++) for (let di = -1; di <= 1; di++) if ((di || dj) && block[k + dj * c + di]! > block[k]!) isMax = false;
      const p = where[k]!;
      if (isMax && Math.hypot(p[0] - center[0], p[1] - center[1]) > 900) cands.push({ anchor: p, height: block[k]! });
    }
  }
  cands.sort((a, b) => b.height - a.height || a.anchor[0] - b.anchor[0]);
  const picked: { anchor: Point; height: number }[] = [];
  for (const cand of cands) {
    if (picked.length >= TOPONYM_COUNTS.mountains + TOPONYM_COUNTS.hills) break;
    if (picked.every((q) => Math.hypot(q.anchor[0] - cand.anchor[0], q.anchor[1] - cand.anchor[1]) >= PEAK_SEPARATION_M)) picked.push(cand);
  }
  return picked;
};

interface Attempt {
  readonly failure?: AttemptFailure;
  readonly data?: TerrainDataV2;
}

const runAttempt = (
  saveId: string,
  seed: number,
  attempt: number,
  L: TerrainLayout,
  o: Required<TerrainOptions>,
  t: Record<string, number>,
): Attempt => {
  const tick = (stage: string, since: number) => {
    t[stage] = (t[stage] ?? 0) + now() - since;
    return now();
  };
  const F = L.frame;
  let t0 = now();

  // 下見：粗い格子・侵食なしで、川や湖が村域にかからないか（重い本生成を無駄にしない）
  const gp = gridOf(o.precheckN);
  const Hp = buildHeight(L, gp);
  const precheck = waterCellsInVillage(Hp, route(Hp, gp), gp, F, PRECHECK_MARGIN_M);
  t0 = tick("precheck", t0);
  if (precheck) return { failure: "precheck" };

  const g = gridOf(o.surroundN);
  const H = buildHeight(L, g);
  t0 = tick("height", t0);
  const protect = planeProtectMask(F, g);
  hydraulicErosion(H, g, createRandom(subSeed(seed, 1000 + attempt)), protect);
  t0 = tick("erosion", t0);
  thermalErosion(H, g, protect);
  t0 = tick("thermal", t0);
  const r = route(H, g);
  const rasterIssue = waterCellsInVillage(H, r, g, F, RIVER_CLEARANCE_M);
  const lakes = lakeMask(H, r, g);
  t0 = tick("hydrology", t0);
  if (rasterIssue) return { failure: rasterIssue };

  const random = createRandom(subSeed(seed, 2000 + attempt));
  const drafts = meanderRivers(extractRivers(r, g), F, random);
  const main = drafts[0];
  const oldChannels = main?.main ? placeOldChannels(main, F, random) : [];
  const lakePolys = lakePolygons(lakes, g);
  t0 = tick("rivers", t0);
  if (!main?.main) return { failure: "noMainRiver" };
  for (const d of drafts) {
    if (polylineClearance(F, d.points, d.widths.map((w) => w / 2)) < RIVER_CLEARANCE_M) return { failure: "riverShape" };
  }
  for (const poly of [...lakePolys, ...oldChannels]) if (polygonClearance(F, poly) < WATER_CLEARANCE_M) return { failure: "lake" };

  // 村域の高解像度ハイトマップと区画の傾斜
  const village = buildVillageField(H, g, F, o.villageN);
  const names = generateToponymNames(saveId);
  const parcels = buildParcels(village, F, (x, y) => names.districts[districtOf(x, y)] ?? "");
  t0 = tick("village", t0);
  if (parcels.some((p) => p.slope > PARCEL_SLOPE_MAX_DEG)) return { failure: "slope" };
  const normal = villageNormals(village);
  t0 = tick("normals", t0);

  // 地質・植生・湿地
  const villageLevel = sampleBilinear(H, g, F.center[0], F.center[1]);
  const water = rasterizeRivers(drafts, g);
  for (let i = 0; i < water.length; i++) if (lakes[i]) water[i] = 1;
  const wd = waterDistance(water, r.level, g);
  const geology = classifyGeology(H, g, wd, F, villageLevel);
  t0 = tick("geology", t0);
  const vegetation = classifyVegetation(H, g, water, geology, wd, oldChannels, F, villageLevel, subSeed(seed, 4000 + attempt));
  const wetRaw = new Uint8Array(g.n * g.n);
  const oldMask = rasterizePolygons(oldChannels, g);
  for (let i = 0; i < wetRaw.length; i++) if (vegetation[i] === VEGETATION_CLASS.wetland && !oldMask[i]) wetRaw[i] = 1;
  const wetlands = maskToPolygons(filterComponents(wetRaw, g, 5000), g).filter((p) => polygonClearance(F, p) >= WATER_CLEARANCE_M);
  t0 = tick("vegetation", t0);

  // 街道・渡河点
  const wet = new Uint8Array(g.n * g.n);
  for (let i = 0; i < wet.length; i++) if (wetRaw[i]) wet[i] = 1;
  const highway = routeHighway(H, g, water, lakes, wet, F, Math.floor(random() * 4));
  t0 = tick("highway", t0);
  if (!highway) return { failure: "highway" };

  // 地名の割り当て
  const districtAnchors: Point[] = Array.from({ length: TOPONYM_COUNTS.districts }, (_, d) => {
    let sa = 0;
    let sb = 0;
    let cnt = 0;
    for (let y = 0; y < VILLAGE_CELLS; y++) {
      for (let x = 0; x < VILLAGE_CELLS; x++) {
        if (districtOf(x, y) !== d) continue;
        sa += (x + 0.5) * PARCEL_M - F.halfM;
        sb += F.halfM - (y + 0.5) * PARCEL_M;
        cnt++;
      }
    }
    return toWorld(F, sa / cnt, sb / cnt);
  });
  const peaks = findPeaks(H, g, F.center).map((p) => ({ anchor: p.anchor, mountain: p.height - villageLevel >= MOUNTAIN_ABOVE_VILLAGE_M }));
  const lakesByArea = [...lakePolys].sort((a, b) => polygonArea(b) - polygonArea(a));
  const wetByArea = [...oldChannels, ...[...wetlands].sort((a, b) => polygonArea(b) - polygonArea(a))];
  const start = highway.elevations[0]!;
  let top = 0;
  highway.elevations.forEach((e, k) => {
    if (e > highway.elevations[top]!) top = k;
  });
  const passAnchor = highway.elevations[top]! - start >= PASS_RISE_M ? highway.points[top]! : null;
  const toponyms = assignToponyms(names, {
    villageCenter: F.center,
    districtAnchors,
    riverAnchors: drafts.slice(0, names.rivers.length).map((d) => d.points[Math.floor(d.points.length / 2)]!),
    peaks,
    lakeAnchors: lakesByArea.slice(0, names.lakes.length).map(centroid),
    wetlandAnchors: wetByArea.slice(0, names.wetlands.length).map(centroid),
    passAnchor,
    destinationAnchor: highway.points[highway.points.length - 1]!,
  });
  const surround = quantize(H, SURROUND_HEIGHT_STEP_M);
  tick("assemble", t0);

  const data: TerrainDataV2 = {
    version: 2,
    seed,
    attempt,
    worldM: g.n * g.cell,
    surround: { size: g.n, heightmap: surround.heightmap, offsetM: surround.offsetM, stepM: SURROUND_HEIGHT_STEP_M },
    village: {
      size: village.size,
      heightmap: village.heightmap,
      offsetM: village.offsetM,
      stepM: village.stepM,
      windowHalfM: village.windowHalfM,
      frame: F,
      normal,
    },
    rivers: toRivers(drafts, names.rivers),
    lakes: lakePolys,
    wetlands,
    oldChannels,
    geology,
    vegetation,
    highway: { points: highway.points, from: highway.from, destination: names.destination },
    fords: highway.fords,
    parcels,
    toponyms,
  };
  return { data };
};

export const generateTerrain = (saveId: string, options: TerrainOptions = {}): TerrainResult => {
  const o: Required<TerrainOptions> = {
    surroundN: options.surroundN ?? SURROUND_N,
    villageN: options.villageN ?? VILLAGE_N,
    precheckN: options.precheckN ?? PRECHECK_N,
    maxAttempts: options.maxAttempts ?? MAX_TERRAIN_ATTEMPTS,
  };
  const seed = terrainSeed(saveId);
  const timings: Record<string, number> = {};
  const failures: AttemptFailure[] = [];
  const t0 = now();
  for (let attempt = 0; attempt < o.maxAttempts; attempt++) {
    const L = makeLayout(subSeed(seed, attempt));
    if (!L) {
      failures.push("layout");
      continue;
    }
    const result = runAttempt(saveId, seed, attempt, L, o, timings);
    if (result.data) {
      timings.total = now() - t0;
      return { ok: true, data: result.data, attempts: attempt + 1, failures, timings };
    }
    failures.push(result.failure ?? "river");
  }
  timings.total = now() - t0;
  return { ok: false, attempts: o.maxAttempts, failures, timings };
};

