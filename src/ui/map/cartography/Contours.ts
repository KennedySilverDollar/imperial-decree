import type { Point, Polyline } from "../terrain/types";

// 等高線（SPEC_v3.4 §6.3）。marching squares の自前実装（d3-contour は使わない：BB-06）。
// 格子の範囲を切り出して、間隔ごとの等値線を求め、線分をつないで折れ線にする。
// 計曲線（index）は index 本ごと。急斜面（ケバで描く所）は suppress で等高線を間引く。

export interface HeightRegion {
  /** 標高（m）。n × n、行優先 */
  readonly h: Float32Array;
  readonly n: number;
  /** 1セルの大きさ（m）と、セル (0,0) の中心の地図座標 */
  readonly cell: number;
  readonly origin: Point;
}

export interface ContourLine {
  readonly level: number;
  readonly index: boolean;
  readonly points: Polyline;
}

export const contourLines = (
  r: HeightRegion,
  interval: number,
  indexEvery: number,
  suppress?: (i: number, j: number) => boolean,
): ContourLine[] => {
  const { h, n, cell, origin } = r;
  // 辺の番号：水平の辺 (i,j)-(i+1,j) は 2·(j·n+i)、垂直の辺 (i,j)-(i,j+1) は 2·(j·n+i)+1。等値線ごとに分ける
  const byLevel = new Map<number, Map<number, number[]>>();
  const points = new Map<string, Point>();
  const link = (level: number, a: number, b: number) => {
    let m = byLevel.get(level);
    if (!m) {
      m = new Map();
      byLevel.set(level, m);
    }
    const la = m.get(a);
    if (la) la.push(b);
    else m.set(a, [b]);
    const lb = m.get(b);
    if (lb) lb.push(a);
    else m.set(b, [a]);
  };
  const edgePoint = (level: number, e: number): Point => {
    const key = `${level}:${e}`;
    const cached = points.get(key);
    if (cached) return cached;
    const k = e >> 1;
    const i = k % n;
    const j = (k - i) / n;
    const a = h[k]!;
    const b = e & 1 ? h[k + n]! : h[k + 1]!;
    const t = b === a ? 0.5 : (level - a) / (b - a);
    const p: Point = e & 1 ? [origin[0] + i * cell, origin[1] + (j + t) * cell] : [origin[0] + (i + t) * cell, origin[1] + j * cell];
    points.set(key, p);
    return p;
  };
  for (let j = 0; j + 1 < n; j++) {
    for (let i = 0; i + 1 < n; i++) {
      if (suppress?.(i, j)) continue;
      const k = j * n + i;
      const tl = h[k]!;
      const tr = h[k + 1]!;
      const br = h[k + n + 1]!;
      const bl = h[k + n]!;
      const lo = Math.min(tl, tr, br, bl);
      const hi = Math.max(tl, tr, br, bl);
      for (let lv = Math.ceil(lo / interval) * interval; lv < hi; lv += interval) {
        const c = (tl > lv ? 8 : 0) | (tr > lv ? 4 : 0) | (br > lv ? 2 : 0) | (bl > lv ? 1 : 0);
        if (c === 0 || c === 15) continue;
        const top = 2 * k;
        const bottom = 2 * (k + n);
        const left = 2 * k + 1;
        const right = 2 * (k + 1) + 1;
        switch (c) {
          case 1:
          case 14:
            link(lv, left, bottom);
            break;
          case 2:
          case 13:
            link(lv, bottom, right);
            break;
          case 3:
          case 12:
            link(lv, left, right);
            break;
          case 4:
          case 11:
            link(lv, top, right);
            break;
          case 6:
          case 9:
            link(lv, top, bottom);
            break;
          case 7:
          case 8:
            link(lv, left, top);
            break;
          case 5:
            link(lv, left, top);
            link(lv, bottom, right);
            break;
          case 10:
            link(lv, top, right);
            link(lv, left, bottom);
            break;
        }
      }
    }
  }
  const lines: ContourLine[] = [];
  const levels = [...byLevel.keys()].sort((a, b) => a - b);
  for (const level of levels) {
    const m = byLevel.get(level)!;
    const seen = new Set<number>();
    // 端点（つながりが1つ）から先にたどり、残りは輪
    const starts = [...m.keys()].sort((a, b) => (m.get(a)!.length - m.get(b)!.length) || a - b);
    for (const start of starts) {
      if (seen.has(start)) continue;
      const line: Point[] = [];
      let prev = -1;
      let cur = start;
      while (!seen.has(cur)) {
        seen.add(cur);
        line.push(edgePoint(level, cur));
        const next = m.get(cur)!.find((e) => e !== prev && !seen.has(e));
        if (next === undefined) {
          // 輪なら始点に戻して閉じる
          if (m.get(cur)!.includes(start) && line.length > 2) line.push(line[0]!);
          break;
        }
        prev = cur;
        cur = next;
      }
      if (line.length >= 2) lines.push({ level, index: (((Math.round(level / interval) % indexEvery) + indexEvery) % indexEvery) === 0, points: line });
    }
  }
  return lines;
};
