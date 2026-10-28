import { cellLocalBounds, parcelPolygon } from "./geometry";
import { quantize, type Grid } from "./grid";
import { SLOPE_BASELINE_M, SLOPE_SAMPLE_STEP_M, VILLAGE_CELLS, VILLAGE_HEIGHT_STEP_M, VILLAGE_WINDOW_HALF_M } from "./terrainConstants";
import type { HeightField, Parcel, VillageFrame } from "./types";

// 村域の段丘面の高解像度ハイトマップ（SPEC_v3.4 §3.4 の二段階解像度、BB-03）と、区画の傾斜（§3.2、BB-13）。
// 地図全体の標高を双一次補間して 2048² に起こす。建物平面の細かな陰影のゆらぎは描画側で加える（§3.4、M3）。

export interface VillageField extends HeightField {
  readonly windowHalfM: number;
}

export const buildVillageField = (H: Float32Array, g: Grid, F: VillageFrame, n: number): VillageField => {
  const half = VILLAGE_WINDOW_HALF_M;
  const step = (2 * half) / n;
  const h = new Float32Array(n * n);
  const gn = g.n;
  const inv = 1 / g.cell;
  const [cx, cy] = F.center;
  const [ax, ay] = F.axisA;
  const [bx, by] = F.axisB;
  // 行 0 が丘側（b = +half）、列 0 が上流側（a = −half）。区画の (x, y) と同じ向き
  for (let r = 0; r < n; r++) {
    const b = half - (r + 0.5) * step;
    for (let c = 0; c < n; c++) {
      const a = -half + (c + 0.5) * step;
      const fx = Math.min(gn - 1.001, Math.max(0, (cx + a * ax + b * bx) * inv - 0.5));
      const fy = Math.min(gn - 1.001, Math.max(0, (cy + a * ay + b * by) * inv - 0.5));
      const ix = Math.floor(fx);
      const iy = Math.floor(fy);
      const tx = fx - ix;
      const ty = fy - iy;
      const k = iy * gn + ix;
      h[r * n + c] = H[k]! * (1 - tx) * (1 - ty) + H[k + 1]! * tx * (1 - ty) + H[k + gn]! * (1 - tx) * ty + H[k + gn + 1]! * tx * ty;
    }
  }
  const { heightmap, offsetM } = quantize(h, VILLAGE_HEIGHT_STEP_M);
  return { size: n, heightmap, offsetM, stepM: VILLAGE_HEIGHT_STEP_M, windowHalfM: half };
};

/** 村域ハイトマップの局所座標 (a, b) での標高（双一次補間） */
export const villageHeightAt = (f: VillageField, a: number, b: number): number => {
  const n = f.size;
  const step = (2 * f.windowHalfM) / n;
  const fc = Math.min(n - 1.001, Math.max(0, (a + f.windowHalfM) / step - 0.5));
  const fr = Math.min(n - 1.001, Math.max(0, (f.windowHalfM - b) / step - 0.5));
  const c = Math.floor(fc);
  const r = Math.floor(fr);
  const tc = fc - c;
  const tr = fr - r;
  const k = r * n + c;
  const m = f.heightmap;
  const v = m[k]! * (1 - tc) * (1 - tr) + m[k + 1]! * tc * (1 - tr) + m[k + n]! * (1 - tc) * tr + m[k + n + 1]! * tc * tr;
  return f.offsetM + v * f.stepM;
};

/** 法線（上位8bit = nx、下位8bit = ny）。nx, ny は局所座標 (a, b) の向き */
export const villageNormals = (f: VillageField): Uint16Array => {
  const n = f.size;
  const step = (2 * f.windowHalfM) / n;
  const m = f.heightmap;
  const out = new Uint16Array(n * n);
  const enc = (v: number) => Math.max(0, Math.min(255, Math.round((v * 0.5 + 0.5) * 255)));
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const c0 = Math.max(0, c - 1);
      const c1 = Math.min(n - 1, c + 1);
      const r0 = Math.max(0, r - 1);
      const r1 = Math.min(n - 1, r + 1);
      const da = ((m[r * n + c1]! - m[r * n + c0]!) * f.stepM) / ((c1 - c0) * step);
      // 行は b の減る向きなので符号を反転
      const db = -((m[r1 * n + c]! - m[r0 * n + c]!) * f.stepM) / ((r1 - r0) * step);
      const inv = 1 / Math.sqrt(da * da + db * db + 1);
      out[r * n + c] = (enc(-da * inv) << 8) | enc(-db * inv);
    }
  }
  return out;
};

/** 区画 (x, y) の平均傾斜（度）。5m 間隔の点で、±7.5m の差分から勾配を取る */
export const parcelSlope = (f: VillageField, half: number, x: number, y: number): number => {
  const { a0, a1, b0, b1 } = cellLocalBounds(x, y, half);
  const s = SLOPE_SAMPLE_STEP_M;
  const d = SLOPE_BASELINE_M;
  let sum = 0;
  let count = 0;
  for (let b = b0 + s / 2; b < b1; b += s) {
    for (let a = a0 + s / 2; a < a1; a += s) {
      const ga = (villageHeightAt(f, a + d, b) - villageHeightAt(f, a - d, b)) / (2 * d);
      const gb = (villageHeightAt(f, a, b + d) - villageHeightAt(f, a, b - d)) / (2 * d);
      sum += (Math.atan(Math.hypot(ga, gb)) * 180) / Math.PI;
      count++;
    }
  }
  return sum / count;
};

export const buildParcels = (f: VillageField, F: VillageFrame, nameOf: (x: number, y: number) => string): Parcel[] => {
  const parcels: Parcel[] = [];
  for (let gridIndex = 0; gridIndex < VILLAGE_CELLS * VILLAGE_CELLS; gridIndex++) {
    const x = gridIndex % VILLAGE_CELLS;
    const y = Math.floor(gridIndex / VILLAGE_CELLS);
    parcels.push({ gridIndex, polygon: parcelPolygon(F, gridIndex), name: nameOf(x, y), slope: parcelSlope(f, F.halfM, x, y) });
  }
  return parcels;
};
