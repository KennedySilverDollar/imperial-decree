import { polygonClearance, polylineClearance, pointInPolygon, pointSegmentDistance, toLocal } from "./geometry";
import { armEndPoint } from "./Highway";
import {
  HYDROLOGY,
  PARCEL_SLOPE_MAX_DEG,
  RIVER_CLEARANCE_M,
  TOPONYM_COUNTS,
  VILLAGE_CELLS,
  WATER_CLEARANCE_M,
} from "./terrainConstants";
import type { Point, TerrainDataV2 } from "./types";
import { VEGETATION_CLASS } from "./Vegetation";

// 生成された地形が SPEC_v3.4 §3.2・§3.3・§4.4・§6.5 の条件を満たすかを、データだけから確かめる。
// `npm run terrain:check` とテストが使う。生成器の内部の判定とは別に、出来上がった形を見て判定する。

const EPS = 0.5;

const onBorder = (p: Point, worldM: number): boolean =>
  Math.abs(p[0]) < EPS || Math.abs(p[1]) < EPS || Math.abs(p[0] - worldM) < EPS || Math.abs(p[1] - worldM) < EPS;

export const validateTerrain = (d: TerrainDataV2): string[] => {
  const issues: string[] = [];
  const F = d.village.frame;

  // 村域100区画：水域でなく、傾斜 ≤ 5°
  if (d.parcels.length !== VILLAGE_CELLS * VILLAGE_CELLS) issues.push(`parcels: ${d.parcels.length}`);
  d.parcels.forEach((p, k) => {
    if (p.gridIndex !== k) issues.push(`parcel ${k}: gridIndex ${p.gridIndex}`);
    if (!(p.slope <= PARCEL_SLOPE_MAX_DEG)) issues.push(`parcel ${k}: slope ${p.slope.toFixed(2)}`);
  });
  d.rivers.forEach((r, k) => {
    const c = polylineClearance(F, r.points, r.widths.map((w) => w / 2));
    if (c < RIVER_CLEARANCE_M) issues.push(`river ${k}: clearance ${c.toFixed(1)}`);
  });
  for (const [kind, polys] of [
    ["lake", d.lakes],
    ["wetland", d.wetlands],
    ["oldChannel", d.oldChannels],
  ] as const) {
    polys.forEach((poly, k) => {
      const c = polygonClearance(F, poly);
      if (c < WATER_CLEARANCE_M) issues.push(`${kind} ${k}: clearance ${c.toFixed(1)}`);
    });
  }
  const n = d.surround.size;
  const cell = d.worldM / n;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      if (d.vegetation[j * n + i] !== VEGETATION_CLASS.water) continue;
      const [a, b] = toLocal(F, [(i + 0.5) * cell, (j + 0.5) * cell]);
      if (Math.max(Math.abs(a), Math.abs(b)) < F.halfM) {
        issues.push(`water cell in village at ${i},${j}`);
        j = n;
        break;
      }
    }
  }

  // 川：本流が先頭、水面は下流へ単調に下がる、本流は地図の縁か湖で終わる
  const main = d.rivers[0];
  if (!main?.main) issues.push("no main river");
  d.rivers.forEach((r, k) => {
    for (let q = 0; q + 1 < r.levels.length; q++) {
      if (r.levels[q + 1]! > r.levels[q]! + 1e-6) {
        issues.push(`river ${k}: flows uphill at ${q}`);
        break;
      }
    }
    if (r.points.length !== r.widths.length || r.points.length !== r.levels.length) issues.push(`river ${k}: length mismatch`);
  });
  if (main) {
    const end = main.points[main.points.length - 1]!;
    if (!onBorder(end, d.worldM) && !d.lakes.some((l) => pointInPolygon(end, l))) issues.push("main river does not end at the edge or a lake");
  }

  // 旧河道：1〜2か所、本流の近く、村域から離れている
  const [minOld, maxOld] = HYDROLOGY.oldChannelCount;
  if (d.oldChannels.length < minOld || d.oldChannels.length > maxOld) issues.push(`old channels: ${d.oldChannels.length}`);
  if (main) {
    d.oldChannels.forEach((poly, k) => {
      if (polygonClearance(F, poly) < HYDROLOGY.oldChannelVillageKeepM) issues.push(`old channel ${k}: near village`);
      const near = Math.min(
        ...poly.map((p) => {
          let best = Infinity;
          for (let q = 0; q + 1 < main.points.length; q++) best = Math.min(best, pointSegmentDistance(p, main.points[q]!, main.points[q + 1]!));
          return best;
        }),
      );
      if (near > 200) issues.push(`old channel ${k}: ${near.toFixed(0)}m from the main river`);
    });
  }

  // 街道：十字の一端から地図の縁まで。村域の中を通らない
  const hw = d.highway.points;
  const start = armEndPoint(F, d.highway.from);
  if (hw.length < 2 || Math.hypot(hw[0]![0] - start[0], hw[0]![1] - start[1]) > EPS) issues.push("highway does not start at the arm end");
  if (hw.length < 2 || !onBorder(hw[hw.length - 1]!, d.worldM)) issues.push("highway does not reach the edge");
  if (hw.length > 2 && polylineClearance(F, hw.slice(1), []) < 0) issues.push("highway enters the village");

  // 地名：一意、小字が全区画に付く
  const names = d.toponyms.map((t) => t.name);
  if (new Set(names).size !== names.length) issues.push("toponyms are not unique");
  if (names.some((x) => x.length === 0)) issues.push("empty toponym");
  const districts = d.toponyms.filter((t) => t.kind === "district").map((t) => t.name);
  if (districts.length !== TOPONYM_COUNTS.districts) issues.push(`districts: ${districts.length}`);
  if (!d.toponyms.some((t) => t.kind === "region")) issues.push("no region name");
  if (!d.toponyms.some((t) => t.kind === "destination" && t.name === d.highway.destination)) issues.push("no destination name");
  if (d.parcels.some((p) => !districts.includes(p.name))) issues.push("parcel without a district name");

  // 格子の大きさ
  if (d.surround.heightmap.length !== n * n || d.geology.length !== n * n || d.vegetation.length !== n * n) issues.push("surround size");
  const vn = d.village.size;
  if (d.village.heightmap.length !== vn * vn || d.village.normal.length !== vn * vn) issues.push("village size");
  return issues;
};
