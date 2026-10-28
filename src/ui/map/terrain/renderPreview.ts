import { decode, gridOf } from "./grid";
import { toWorld } from "./geometry";
import { MAP_COLORS, vegetationColor, type Rgb } from "./palette";
import { VILLAGE_CELLS } from "./terrainConstants";
import type { Point, Polygon, Polyline, TerrainDataV2 } from "./types";

// 地形の下塗り（ベイク）と開発用プレビューの画素を作る純関数。DOM・Canvas に依存しない。
// Worker はこれを OffscreenCanvas に載せて ImageBitmap にする（terrain.worker.ts）。M3 の本格的な画法の前の簡易版。

export type Pixels = Uint8ClampedArray<ArrayBuffer>;

interface Canvas {
  readonly px: Pixels;
  readonly size: number;
  /** 1画素あたりのメートル */
  readonly mpp: number;
}

const blank = (size: number, worldM: number, c: Rgb): Canvas => {
  const px = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    px[i * 4] = c[0];
    px[i * 4 + 1] = c[1];
    px[i * 4 + 2] = c[2];
    px[i * 4 + 3] = 255;
  }
  return { px, size, mpp: worldM / size };
};

const blend = (cv: Canvas, x: number, y: number, c: Rgb, alpha: number) => {
  if (x < 0 || y < 0 || x >= cv.size || y >= cv.size) return;
  const k = (y * cv.size + x) * 4;
  cv.px[k] = cv.px[k]! * (1 - alpha) + c[0] * alpha;
  cv.px[k + 1] = cv.px[k + 1]! * (1 - alpha) + c[1] * alpha;
  cv.px[k + 2] = cv.px[k + 2]! * (1 - alpha) + c[2] * alpha;
};

const disc = (cv: Canvas, cx: number, cy: number, r: number, c: Rgb, alpha: number) => {
  const rr = Math.max(0.5, r);
  for (let y = Math.floor(cy - rr); y <= Math.ceil(cy + rr); y++) {
    for (let x = Math.floor(cx - rr); x <= Math.ceil(cx + rr); x++) {
      if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= rr * rr) blend(cv, x, y, c, alpha);
    }
  }
};

export const strokePolyline = (cv: Canvas, line: Polyline, widthM: (k: number) => number, c: Rgb, alpha = 1, minPx = 1) => {
  for (let k = 0; k + 1 < line.length; k++) {
    const a = line[k]!;
    const b = line[k + 1]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) / cv.mpp;
    const steps = Math.max(1, Math.ceil(len * 2));
    const r = Math.max(minPx, widthM(k) / cv.mpp) / 2;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      disc(cv, (a[0] + (b[0] - a[0]) * t) / cv.mpp, (a[1] + (b[1] - a[1]) * t) / cv.mpp, r, c, alpha);
    }
  }
};

export const fillPolygon = (cv: Canvas, poly: Polygon, c: Rgb, alpha = 1) => {
  const ys = poly.map((p) => p[1] / cv.mpp);
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const y1 = Math.min(cv.size - 1, Math.ceil(Math.max(...ys)));
  for (let y = y0; y <= y1; y++) {
    const sy = y + 0.5;
    const xs: number[] = [];
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i]!;
      const b = poly[j]!;
      const ay = a[1] / cv.mpp;
      const by = b[1] / cv.mpp;
      if (ay > sy !== by > sy) xs.push(a[0] / cv.mpp + ((sy - ay) / (by - ay)) * (b[0] / cv.mpp - a[0] / cv.mpp));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = Math.ceil(xs[k]! - 0.5); x <= Math.floor(xs[k + 1]! - 0.5); x++) blend(cv, x, y, c, alpha);
    }
  }
};

/** ヒルシェード（光源は左上：机のランプの向き。§7.4） */
const hillshade = (h: Float32Array, n: number, cell: number): Float32Array => {
  const out = new Float32Array(n * n);
  const lx = -0.6;
  const ly = -0.6;
  const lz = 0.53;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const x0 = Math.max(0, x - 1);
      const x1 = Math.min(n - 1, x + 1);
      const y0 = Math.max(0, y - 1);
      const y1 = Math.min(n - 1, y + 1);
      const gx = (h[y * n + x1]! - h[y * n + x0]!) / ((x1 - x0) * cell);
      const gy = (h[y1 * n + x]! - h[y0 * n + x]!) / ((y1 - y0) * cell);
      const inv = 1 / Math.sqrt(gx * gx + gy * gy + 1);
      out[y * n + x] = Math.max(0, (-gx * lx - gy * ly + lz) * inv);
    }
  }
  return out;
};

const shadeAt = (shade: Float32Array, n: number, size: number, x: number, y: number): number =>
  shade[Math.min(n - 1, Math.floor((y * n) / size)) * n + Math.min(n - 1, Math.floor((x * n) / size))]!;

const drawWater = (cv: Canvas, d: TerrainDataV2) => {
  for (const lake of d.lakes) fillPolygon(cv, lake, MAP_COLORS.waterShallow);
  for (const w of [...d.wetlands, ...d.oldChannels]) fillPolygon(cv, w, MAP_COLORS.wetland, 0.85);
  for (const r of d.rivers) {
    strokePolyline(cv, r.points, (k) => r.widths[k]! + 6, MAP_COLORS.riverLine, 1, r.main ? 2.5 : 1.5);
    strokePolyline(cv, r.points, (k) => r.widths[k]!, MAP_COLORS.waterShallow, 1, r.main ? 1.5 : 0.8);
  }
};

const drawVillage = (cv: Canvas, d: TerrainDataV2) => {
  const F = d.village.frame;
  const h = F.halfM;
  for (let k = 0; k <= VILLAGE_CELLS; k++) {
    const t = -h + (2 * h * k) / VILLAGE_CELLS;
    const strong = k === 0 || k === VILLAGE_CELLS;
    const lines: [Point, Point][] = [
      [toWorld(F, t, -h), toWorld(F, t, h)],
      [toWorld(F, -h, t), toWorld(F, h, t)],
    ];
    for (const [a, b] of lines) strokePolyline(cv, [a, b], () => 0, MAP_COLORS.ink, strong ? 0.9 : 0.3, strong ? 1.5 : 0.6);
  }
};

const drawHighway = (cv: Canvas, d: TerrainDataV2) => {
  strokePolyline(cv, d.highway.points, () => 14, MAP_COLORS.roadLine, 1, 2.5);
  strokePolyline(cv, d.highway.points, () => 8, MAP_COLORS.road, 1, 1.2);
  for (const f of d.fords) disc(cv, f[0] / cv.mpp, f[1] / cv.mpp, 3, MAP_COLORS.vermilion, 1);
};

/** 下塗り：植生の色 × 陰影＋水系（Worker が ImageBitmap にする） */
export const renderBaseLayer = (d: TerrainDataV2, size = d.surround.size): Pixels => {
  const n = d.surround.size;
  const cell = d.worldM / n;
  const shade = hillshade(decode(d.surround), n, cell);
  const cv = blank(size, d.worldM, MAP_COLORS.paper);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const k = Math.min(n - 1, Math.floor((y * n) / size)) * n + Math.min(n - 1, Math.floor((x * n) / size));
      const c = vegetationColor(d.vegetation[k]!);
      const s = 0.55 + 0.6 * shadeAt(shade, n, size, x, y);
      const p = (y * size + x) * 4;
      cv.px[p] = c[0] * s;
      cv.px[p + 1] = c[1] * s;
      cv.px[p + 2] = c[2] * s;
    }
  }
  drawWater(cv, d);
  return cv.px;
};

/** 開発用プレビュー：標高（段彩＋陰影）／水系・街道・村域／植生 の3枚 */
export const renderPreviewPanels = (d: TerrainDataV2, size: number): { height: Pixels; water: Pixels; vegetation: Pixels } => {
  const n = d.surround.size;
  const g = gridOf(n);
  const h = decode(d.surround);
  const shade = hillshade(h, n, g.cell);
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of h) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  const ramp: Rgb[] = [
    [96, 128, 92],
    [168, 176, 120],
    [214, 196, 140],
    [176, 140, 104],
    [150, 130, 120],
    [236, 232, 226],
  ];
  const height = blank(size, d.worldM, MAP_COLORS.paper);
  const water = blank(size, d.worldM, MAP_COLORS.paper);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const k = Math.min(n - 1, Math.floor((y * n) / size)) * n + Math.min(n - 1, Math.floor((x * n) / size));
      const t = Math.sqrt((h[k]! - lo) / (hi - lo || 1)) * (ramp.length - 1);
      const i0 = Math.min(ramp.length - 2, Math.floor(t));
      const f = t - i0;
      const s = 0.45 + 0.7 * shadeAt(shade, n, size, x, y);
      const p = (y * size + x) * 4;
      for (let ch = 0; ch < 3; ch++) height.px[p + ch] = (ramp[i0]![ch]! * (1 - f) + ramp[i0 + 1]![ch]! * f) * s;
      const w = 0.82 + 0.25 * shadeAt(shade, n, size, x, y);
      for (let ch = 0; ch < 3; ch++) water.px[p + ch] = MAP_COLORS.paper[ch]! * w;
    }
  }
  drawWater(height, d);
  drawWater(water, d);
  drawHighway(water, d);
  drawVillage(water, d);
  for (const t of d.toponyms) disc(water, t.anchor[0] / water.mpp, t.anchor[1] / water.mpp, 2.5, MAP_COLORS.vermilion, 1);
  const vegetation = blank(size, d.worldM, MAP_COLORS.paper);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const k = Math.min(n - 1, Math.floor((y * n) / size)) * n + Math.min(n - 1, Math.floor((x * n) / size));
      const c = vegetationColor(d.vegetation[k]!);
      const p = (y * size + x) * 4;
      for (let ch = 0; ch < 3; ch++) vegetation.px[p + ch] = c[ch]!;
    }
  }
  drawWater(vegetation, d);
  drawHighway(vegetation, d);
  drawVillage(vegetation, d);
  return { height: height.px, water: water.px, vegetation: vegetation.px };
};
