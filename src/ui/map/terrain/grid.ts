import { WORLD_M } from "./terrainConstants";
import type { HeightField, Point } from "./types";

// 正方格子（地図全体を n×n で覆う。セル中心 = (i + 0.5)·cell）の小道具。
// 計算の内側のループでは型付き配列の添字に `!` を使う（noUncheckedIndexedAccess。境界は呼び出し側で保証）。

export interface Grid {
  readonly n: number;
  readonly cell: number;
}

export const gridOf = (n: number): Grid => ({ n, cell: WORLD_M / n });

export const cellCenter = (g: Grid, i: number, j: number): Point => [(i + 0.5) * g.cell, (j + 0.5) * g.cell];

/** 双一次補間（地図座標） */
export const sampleBilinear = (h: Float32Array, g: Grid, x: number, y: number): number => {
  const fx = Math.min(g.n - 1.001, Math.max(0, x / g.cell - 0.5));
  const fy = Math.min(g.n - 1.001, Math.max(0, y / g.cell - 0.5));
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = fx - ix;
  const ty = fy - iy;
  const k = iy * g.n + ix;
  return (
    h[k]! * (1 - tx) * (1 - ty) + h[k + 1]! * tx * (1 - ty) + h[k + g.n]! * (1 - tx) * ty + h[k + g.n + 1]! * tx * ty
  );
};

/** 中心差分の勾配の大きさ（m/m） */
export const slopeAt = (h: Float32Array, g: Grid, i: number, j: number): number => {
  const n = g.n;
  const i0 = Math.max(0, i - 1);
  const i1 = Math.min(n - 1, i + 1);
  const j0 = Math.max(0, j - 1);
  const j1 = Math.min(n - 1, j + 1);
  const gx = (h[j * n + i1]! - h[j * n + i0]!) / ((i1 - i0) * g.cell);
  const gy = (h[j1 * n + i]! - h[j0 * n + i]!) / ((j1 - j0) * g.cell);
  return Math.hypot(gx, gy);
};

export const quantize = (h: Float32Array, stepM: number): { heightmap: Uint16Array; offsetM: number } => {
  let lo = Infinity;
  for (let i = 0; i < h.length; i++) if (h[i]! < lo) lo = h[i]!;
  const offsetM = Math.floor(lo);
  const out = new Uint16Array(h.length);
  for (let i = 0; i < h.length; i++) out[i] = Math.max(0, Math.min(65535, Math.round((h[i]! - offsetM) / stepM)));
  return { heightmap: out, offsetM };
};

export const decode = (f: HeightField): Float32Array => {
  const out = new Float32Array(f.heightmap.length);
  for (let i = 0; i < out.length; i++) out[i] = f.offsetM + f.heightmap[i]! * f.stepM;
  return out;
};

/** 2パスの面取り距離変換（8近傍）。src が 1 のセルからの距離(m)と、最寄りのソースの値 */
export const chamferDistance = (
  src: Uint8Array,
  value: Float32Array,
  g: Grid,
): { dist: Float32Array; nearest: Float32Array } => {
  const n = g.n;
  const dist = new Float32Array(n * n).fill(Infinity);
  const nearest = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) {
    if (src[i]) {
      dist[i] = 0;
      nearest[i] = value[i]!;
    }
  }
  const d1 = g.cell;
  const d2 = g.cell * Math.SQRT2;
  const relax = (i: number, j: number, w: number) => {
    const c = dist[j]! + w;
    if (c < dist[i]!) {
      dist[i] = c;
      nearest[i] = nearest[j]!;
    }
  };
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      if (x > 0) relax(i, i - 1, d1);
      if (y > 0) {
        relax(i, i - n, d1);
        if (x > 0) relax(i, i - n - 1, d2);
        if (x < n - 1) relax(i, i - n + 1, d2);
      }
    }
  }
  for (let y = n - 1; y >= 0; y--) {
    for (let x = n - 1; x >= 0; x--) {
      const i = y * n + x;
      if (x < n - 1) relax(i, i + 1, d1);
      if (y < n - 1) {
        relax(i, i + n, d1);
        if (x < n - 1) relax(i, i + n + 1, d2);
        if (x > 0) relax(i, i + n - 1, d2);
      }
    }
  }
  return { dist, nearest };
};

/** 連結成分に分け、面積が下限以上の成分だけを（大きい順に最大 maxCount 個）残したマスク */
export const filterComponents = (mask: Uint8Array, g: Grid, minArea: number, maxCount = Infinity): Uint8Array => {
  const n = g.n;
  const out = new Uint8Array(n * n);
  const seen = new Uint8Array(n * n);
  const stack: number[] = [];
  const members: number[] = [];
  const kept: number[][] = [];
  const minCells = minArea / (g.cell * g.cell);
  for (let s = 0; s < n * n; s++) {
    if (!mask[s] || seen[s]) continue;
    members.length = 0;
    const visit = (j: number) => {
      if (mask[j] && !seen[j]) {
        seen[j] = 1;
        stack.push(j);
      }
    };
    visit(s);
    while (stack.length > 0) {
      const i = stack.pop()!;
      members.push(i);
      const x = i % n;
      const y = (i - x) / n;
      if (x > 0) visit(i - 1);
      if (x < n - 1) visit(i + 1);
      if (y > 0) visit(i - n);
      if (y < n - 1) visit(i + n);
    }
    if (members.length >= minCells) kept.push([...members]);
  }
  kept.sort((p, q) => q.length - p.length || p[0]! - q[0]!);
  for (const comp of kept.slice(0, maxCount)) for (const i of comp) out[i] = 1;
  return out;
};
