import { simplifyIndices } from "./geometry";
import type { Grid } from "./grid";
import type { Point, Polygon } from "./types";

// 2値マスクの輪郭を marching squares で多角形にする（自前実装。d3-contour は使わない：BB-06）。
// 穴は先に埋めるので、返すのは外周だけ（湖の中の島は M1 では描かない）。

/** マスクの穴（外周から到達できない 0 の領域）を 1 で埋める */
export const fillHoles = (mask: Uint8Array, n: number): Uint8Array => {
  const out = mask.slice();
  const outside = new Uint8Array(n * n);
  const stack: number[] = [];
  const push = (i: number) => {
    if (!out[i] && !outside[i]) {
      outside[i] = 1;
      stack.push(i);
    }
  };
  for (let k = 0; k < n; k++) {
    push(k);
    push((n - 1) * n + k);
    push(k * n);
    push(k * n + n - 1);
  }
  while (stack.length > 0) {
    const i = stack.pop()!;
    const x = i % n;
    const y = (i - x) / n;
    if (x > 0) push(i - 1);
    if (x < n - 1) push(i + 1);
    if (y > 0) push(i - n);
    if (y < n - 1) push(i + n);
  }
  for (let i = 0; i < n * n; i++) if (!out[i] && !outside[i]) out[i] = 1;
  return out;
};

export const maskToPolygons = (mask: Uint8Array, g: Grid, simplifyCells = 0.5): Polygon[] => {
  const n = g.n;
  const filled = fillHoles(mask, n);
  const at = (i: number, j: number): number => (i < 0 || j < 0 || i >= n || j >= n ? 0 : filled[j * n + i]!);
  const w = n + 2;
  // 辺の番号：水平な辺 (i,j)-(i+1,j) と、垂直な辺 (i,j)-(i,j+1)。i, j ∈ [-1, n]
  const hEdge = (i: number, j: number) => ((j + 1) * w + (i + 1)) * 2;
  const vEdge = (i: number, j: number) => ((j + 1) * w + (i + 1)) * 2 + 1;
  const edgePoint = (e: number): Point => {
    const k = e >> 1;
    const i = (k % w) - 1;
    const j = Math.floor(k / w) - 1;
    return e & 1 ? [(i + 0.5) * g.cell, (j + 1) * g.cell] : [(i + 1) * g.cell, (j + 0.5) * g.cell];
  };
  const links = new Map<number, number[]>();
  const link = (a: number, b: number) => {
    const la = links.get(a);
    if (la) la.push(b);
    else links.set(a, [b]);
    const lb = links.get(b);
    if (lb) lb.push(a);
    else links.set(b, [a]);
  };
  for (let j = -1; j < n; j++) {
    for (let i = -1; i < n; i++) {
      const c = (at(i, j) << 3) | (at(i + 1, j) << 2) | (at(i + 1, j + 1) << 1) | at(i, j + 1);
      if (c === 0 || c === 15) continue;
      const top = hEdge(i, j);
      const bottom = hEdge(i, j + 1);
      const left = vEdge(i, j);
      const right = vEdge(i + 1, j);
      switch (c) {
        case 1:
        case 14:
          link(left, bottom);
          break;
        case 2:
        case 13:
          link(bottom, right);
          break;
        case 3:
        case 12:
          link(left, right);
          break;
        case 4:
        case 11:
          link(top, right);
          break;
        case 6:
        case 9:
          link(top, bottom);
          break;
        case 7:
        case 8:
          link(left, top);
          break;
        case 5:
          link(left, top);
          link(bottom, right);
          break;
        case 10:
          link(top, right);
          link(left, bottom);
          break;
      }
    }
  }
  const seen = new Set<number>();
  const polygons: Polygon[] = [];
  for (const start of [...links.keys()].sort((a, b) => a - b)) {
    if (seen.has(start)) continue;
    const ring: Point[] = [];
    let prev = -1;
    let cur = start;
    while (!seen.has(cur)) {
      seen.add(cur);
      ring.push(edgePoint(cur));
      const next = (links.get(cur) ?? []).find((e) => e !== prev && !seen.has(e));
      if (next === undefined) break;
      prev = cur;
      cur = next;
    }
    if (ring.length >= 3) {
      const keep = simplifyIndices([...ring, ring[0]!], simplifyCells * g.cell);
      const poly = keep.slice(0, -1).map((k) => ring[k]!);
      if (poly.length >= 3) polygons.push(poly);
    }
  }
  return polygons;
};
