import type { HeightRegion } from "./Contours";
import type { Point } from "../terrain/types";

// ケバ（SPEC_v3.4 §6.3）。急斜面に、最大傾斜の向きの短い線を並べる。長さ・太さは傾斜に比例、密度も傾斜に比例。
// 緩斜面（HACHURE_MIN_SLOPE 未満）は等高線と陰影に任せる。崖線（段丘の縁など）は傾斜が大きいので自然に濃くなる。

export const HACHURE_MIN_SLOPE = 0.12;
/** これより急な所は等高線を間引いてケバだけにする */
export const CONTOUR_SUPPRESS_SLOPE = 0.35;

export interface Hachure {
  readonly from: Point;
  readonly to: Point;
  /** 太さの倍率（傾斜に比例） */
  readonly weight: number;
}

const slopeAt = (r: HeightRegion, i: number, j: number): [number, number] => {
  const { h, n, cell } = r;
  const i0 = Math.max(0, i - 1);
  const i1 = Math.min(n - 1, i + 1);
  const j0 = Math.max(0, j - 1);
  const j1 = Math.min(n - 1, j + 1);
  return [(h[j * n + i1]! - h[j * n + i0]!) / ((i1 - i0) * cell), (h[j1 * n + i]! - h[j0 * n + i]!) / ((j1 - j0) * cell)];
};

/** 等高線を間引くべきセル（急斜面） */
export const steepCell = (r: HeightRegion) => (i: number, j: number): boolean => {
  const [gx, gy] = slopeAt(r, i, j);
  return Math.hypot(gx, gy) > CONTOUR_SUPPRESS_SLOPE;
};

/**
 * spacingM 間隔の格子点（seed で少しずらす）ごとに、傾斜に応じた確率でケバを置く。
 * 線は斜面の上から下へ、長さ = spacing × min(1, 傾斜 × 2.2)。
 */
export const hachures = (r: HeightRegion, spacingM: number, seed: number): Hachure[] => {
  const out: Hachure[] = [];
  const step = Math.max(1, Math.round(spacingM / r.cell));
  let state = seed >>> 0 || 1;
  const rand = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 10000) / 10000;
  };
  for (let j = step; j < r.n - step; j += step) {
    for (let i = step; i < r.n - step; i += step) {
      const ji = Math.min(r.n - 2, j + Math.floor((rand() - 0.5) * step));
      const ii = Math.min(r.n - 2, i + Math.floor((rand() - 0.5) * step));
      const [gx, gy] = slopeAt(r, ii, ji);
      const s = Math.hypot(gx, gy);
      if (s < HACHURE_MIN_SLOPE) continue;
      // 密度も傾斜に比例（緩い所は間引く）
      if (rand() > Math.min(1, (s - HACHURE_MIN_SLOPE) * 4 + 0.35)) continue;
      const len = spacingM * Math.min(1, s * 2.2);
      const ux = -gx / s;
      const uy = -gy / s;
      const cx = r.origin[0] + ii * r.cell;
      const cy = r.origin[1] + ji * r.cell;
      out.push({
        from: [cx - (ux * len) / 2, cy - (uy * len) / 2],
        to: [cx + (ux * len) / 2, cy + (uy * len) / 2],
        weight: Math.min(2.2, 0.6 + s * 2),
      });
    }
  }
  return out;
};
