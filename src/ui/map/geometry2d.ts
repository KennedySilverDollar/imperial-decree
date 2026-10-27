import { deriveSeed, nextFloat } from "../../domain/Prng";
import type { Side } from "../../domain/Landscape";
import { MAP_PX } from "./mapConstants";

// 測量図の計算で使う平面幾何と、seed 付きの乱数の流れ（Math.random は使わない：不変条件3）。

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** seed から [0,1) を順に取り出す関数（地形専用の系列。ゲームの Rng は消費しない） */
export const randomStream = (seed: number, salt: number): (() => number) => {
  let state = deriveSeed(seed, salt);
  return () => {
    const [value, next] = nextFloat(state);
    state = next;
    return value;
  };
};

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smoothstep = (edge0: number, edge1: number, v: number): number => {
  const t = clamp01((v - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

/** 符号付き面積（画面座標＝y 下向きでは、時計回りが正） */
export const signedArea = (polygon: readonly Point[]): number => {
  let sum = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i] as Point;
    const b = polygon[(i + 1) % polygon.length] as Point;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
};

export const centroid = (polygon: readonly Point[]): Point => {
  let cx = 0;
  let cy = 0;
  let area = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i] as Point;
    const b = polygon[(i + 1) % polygon.length] as Point;
    const cross = a.x * b.y - b.x * a.y;
    area += cross;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  if (area === 0) return polygon[0] ?? { x: 0, y: 0 };
  return { x: cx / (3 * area), y: cy / (3 * area) };
};

/** 点が多角形の内側か（偶奇則） */
export const pointInPolygon = (p: Point, polygon: readonly Point[]): boolean => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i] as Point;
    const b = polygon[j] as Point;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
};

export const distanceToSegment = (p: Point, a: Point, b: Point): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : clamp01(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2);
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};

export const distanceToPolyline = (p: Point, line: readonly Point[]): number => {
  let best = Infinity;
  for (let i = 0; i + 1 < line.length; i++) best = Math.min(best, distanceToSegment(p, line[i] as Point, line[i + 1] as Point));
  return best;
};

export const boundsOf = (points: readonly Point[]) => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
};

/** Chaikin の角切り（開いた折れ線。端点は保つ） */
export const chaikin = (line: readonly Point[], iterations: number): Point[] => {
  let current = [...line];
  for (let k = 0; k < iterations; k++) {
    const next: Point[] = [current[0] as Point];
    for (let i = 0; i + 1 < current.length; i++) {
      const a = current[i] as Point;
      const b = current[i + 1] as Point;
      next.push({ x: lerp(a.x, b.x, 0.25), y: lerp(a.y, b.y, 0.25) }, { x: lerp(a.x, b.x, 0.75), y: lerp(a.y, b.y, 0.75) });
    }
    next.push(current[current.length - 1] as Point);
    current = next;
  }
  return current;
};

/**
 * 「東の辺」を基準に計算したものを、各辺へ回す（地図の中心のまわりに 90° ずつ）。
 * 東→北→西→南 の順に、画面上で反時計回り。
 */
const TURNS: Readonly<Record<Side, number>> = { east: 0, north: 1, west: 2, south: 3 };

export const fromEastFrame = (side: Side, p: Point): Point => {
  const c = MAP_PX / 2;
  let dx = p.x - c;
  let dy = p.y - c;
  for (let i = 0; i < TURNS[side]; i++) [dx, dy] = [dy, -dx];
  return { x: c + dx, y: c + dy };
};

export const toEastFrame = (side: Side, p: Point): Point => {
  const c = MAP_PX / 2;
  let dx = p.x - c;
  let dy = p.y - c;
  for (let i = 0; i < TURNS[side]; i++) [dx, dy] = [-dy, dx];
  return { x: c + dx, y: c + dy };
};
