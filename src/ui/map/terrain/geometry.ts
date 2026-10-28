import { VILLAGE_CELLS, PARCEL_M } from "./terrainConstants";
import type { Point, Polygon, Polyline, VillageFrame } from "./types";

// 幾何の小道具（純関数）。村域の座標系 (a, b) と地図座標の変換、線分・多角形と村域の距離など。

export const toLocal = (f: VillageFrame, p: Point): Point => {
  const dx = p[0] - f.center[0];
  const dy = p[1] - f.center[1];
  return [dx * f.axisA[0] + dy * f.axisA[1], dx * f.axisB[0] + dy * f.axisB[1]];
};

export const toWorld = (f: VillageFrame, a: number, b: number): Point => [
  f.center[0] + a * f.axisA[0] + b * f.axisB[0],
  f.center[1] + a * f.axisA[1] + b * f.axisB[1],
];

/** 区画 (x, y) の局所座標の範囲 */
export const cellLocalBounds = (x: number, y: number, half: number): { a0: number; a1: number; b0: number; b1: number } => ({
  a0: x * PARCEL_M - half,
  a1: (x + 1) * PARCEL_M - half,
  b0: half - (y + 1) * PARCEL_M,
  b1: half - y * PARCEL_M,
});

/** 区画の多角形（正方形。地形への吸着は ParcelMapper〔M2〕が担う） */
export const parcelPolygon = (f: VillageFrame, gridIndex: number): Polygon => {
  const x = gridIndex % VILLAGE_CELLS;
  const y = Math.floor(gridIndex / VILLAGE_CELLS);
  const { a0, a1, b0, b1 } = cellLocalBounds(x, y, f.halfM);
  return [toWorld(f, a0, b1), toWorld(f, a1, b1), toWorld(f, a1, b0), toWorld(f, a0, b0)];
};

const pointRectDistance = (a: number, b: number, half: number): number => {
  const da = Math.max(Math.abs(a) - half, 0);
  const db = Math.max(Math.abs(b) - half, 0);
  return Math.hypot(da, db);
};

const segSegIntersect = (p: Point, q: Point, r: Point, s: Point): boolean => {
  const cross = (o: Point, u: Point, v: Point) => (u[0] - o[0]) * (v[1] - o[1]) - (u[1] - o[1]) * (v[0] - o[0]);
  const d1 = cross(r, s, p);
  const d2 = cross(r, s, q);
  const d3 = cross(p, q, r);
  const d4 = cross(p, q, s);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
};

export const pointSegmentDistance = (p: Point, a: Point, b: Point): number => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
};

/** 局所座標の線分と、中心原点・半幅 half の正方形との距離（交われば 0） */
export const segmentRectDistance = (p: Point, q: Point, half: number): number => {
  if (Math.max(Math.abs(p[0]), Math.abs(p[1])) <= half || Math.max(Math.abs(q[0]), Math.abs(q[1])) <= half) return 0;
  const c: Point[] = [
    [-half, -half],
    [half, -half],
    [half, half],
    [-half, half],
  ];
  for (let i = 0; i < 4; i++) if (segSegIntersect(p, q, c[i]!, c[(i + 1) % 4]!)) return 0;
  let d = Math.min(pointRectDistance(p[0], p[1], half), pointRectDistance(q[0], q[1], half));
  for (const corner of c) d = Math.min(d, pointSegmentDistance(corner, p, q));
  return d;
};

/** 折れ線（各点に半径）が村域の正方形へ近づく最小の余裕（距離 − 半径）。負なら重なる */
export const polylineClearance = (f: VillageFrame, line: Polyline, radii: readonly number[], half = f.halfM): number => {
  let min = Infinity;
  const local = line.map((p) => toLocal(f, p));
  for (let i = 0; i + 1 < local.length; i++) {
    const r = Math.max(radii[i] ?? 0, radii[i + 1] ?? 0);
    min = Math.min(min, segmentRectDistance(local[i]!, local[i + 1]!, half) - r);
  }
  if (local.length === 1) min = pointRectDistance(local[0]![0], local[0]![1], half) - (radii[0] ?? 0);
  return min;
};

export const pointInPolygon = (p: Point, poly: Polygon): boolean => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
};

/** 多角形と村域の正方形の余裕（距離。重なれば 0 以下） */
export const polygonClearance = (f: VillageFrame, poly: Polygon, half = f.halfM): number => {
  if (poly.length === 0) return Infinity;
  const corners = [toWorld(f, -half, -half), toWorld(f, half, -half), toWorld(f, half, half), toWorld(f, -half, half)];
  if (corners.some((c) => pointInPolygon(c, poly))) return 0;
  const ring = [...poly, poly[0]!];
  return polylineClearance(f, ring, [], half);
};

export const polylineLength = (line: Polyline): number => {
  let len = 0;
  for (let i = 0; i + 1 < line.length; i++) len += Math.hypot(line[i + 1]![0] - line[i]![0], line[i + 1]![1] - line[i]![1]);
  return len;
};

/** Douglas–Peucker（保持する点の添字を返す） */
export const simplifyIndices = (line: Polyline, tolerance: number): number[] => {
  if (line.length <= 2) return line.map((_, i) => i);
  const keep = new Uint8Array(line.length);
  keep[0] = 1;
  keep[line.length - 1] = 1;
  const stack: [number, number][] = [[0, line.length - 1]];
  while (stack.length > 0) {
    const [s, e] = stack.pop()!;
    let best = -1;
    let bestD = tolerance;
    for (let i = s + 1; i < e; i++) {
      const d = pointSegmentDistance(line[i]!, line[s]!, line[e]!);
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([s, best], [best, e]);
    }
  }
  const out: number[] = [];
  keep.forEach((k, i) => {
    if (k) out.push(i);
  });
  return out;
};

export const polygonArea = (poly: Polygon): number => {
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) s += (poly[j]![0] + poly[i]![0]) * (poly[j]![1] - poly[i]![1]);
  return Math.abs(s) / 2;
};

/** 移動平均で折れ線をならす（両端は動かさない）。格子の階段状の折れを消す */
export const smoothPolyline = (line: Polyline, radius: number): Point[] =>
  line.map((p, k) => {
    if (k === 0 || k === line.length - 1) return p;
    const r = Math.min(radius, k, line.length - 1 - k);
    let x = 0;
    let y = 0;
    for (let q = k - r; q <= k + r; q++) {
      x += line[q]![0];
      y += line[q]![1];
    }
    return [x / (2 * r + 1), y / (2 * r + 1)];
  });

/** Chaikin の角切り（両端は動かさない） */
export const chaikin = (line: Polyline, iterations: number): Point[] => {
  let pts: Point[] = [...line];
  for (let it = 0; it < iterations; it++) {
    if (pts.length < 3) break;
    const out: Point[] = [pts[0]!];
    for (let k = 0; k + 1 < pts.length; k++) {
      const a = pts[k]!;
      const b = pts[k + 1]!;
      if (k > 0) out.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]]);
      if (k + 2 < pts.length) out.push([0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    out.push(pts[pts.length - 1]!);
    pts = out;
  }
  return pts;
};
