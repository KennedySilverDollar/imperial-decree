import { GEOLOGY_CLASS } from "../terrain/Geology";
import { decode, gridOf, sampleBilinear } from "../terrain/grid";
import { toLocal } from "../terrain/geometry";
import { MAP_COLORS, vegetationColor, type Rgb } from "../terrain/palette";
import type { Point, Polyline, TerrainDataV2 } from "../terrain/types";
import { contourLines, type HeightRegion } from "./Contours";
import { hachures, steepCell } from "./Hachure";
import { mottlePixels, wobble } from "./HandDrawn";
import { vegetationSymbols, type VegetationSymbol } from "./Symbols";

// 静的なレイヤのベイク（SPEC_v3.4 §6.1・§6.3・§6.4・§9）。Worker の中で、段階ごとに一度だけ画像にする。
// 紙の地 → 地質・植生の淡彩 → 陰影（机のランプの向き：左上）→ 等高線（計曲線と標高）→ ケバ・崖 → 水系 → 植生の記号 → 街道・渡河点 → 標高点。
// 区画・道路・建物・普請中・メモ・注記は実行時に描く（Layers.ts）。
// 3枚：b0 = 地図全体（L0）、b1 = 村の周り 1.6km（L1）、b3 = 村域の窓（村の座標系に合わせて回した 720m。L2・L3）。
// 描くのは OffscreenCanvas（Worker と主スレッドのどちらでも動く）。図形の計算は純関数（Contours・Hachure・Symbols）。

export type BakeId = "b0" | "b1" | "b3";

export interface BakeSpec {
  readonly id: BakeId;
  /** 画素 (0,0) の角の地図座標 */
  readonly origin: Point;
  /** 画素の +x・+y の向き（地図座標の単位ベクトル） */
  readonly ux: Point;
  readonly uy: Point;
  /** 一辺（m） */
  readonly sizeM: number;
  /** 一辺（画素） */
  readonly px: number;
  readonly contourM: number;
  readonly indexEvery: number;
  readonly hachureM: number;
  readonly symbolM: number;
  /** 標高を取り直す格子の数（一辺） */
  readonly regionN: number;
  /** 淡彩の格子の数（一辺）。粗い格子を拡大して、色の境をにじませる */
  readonly washN: number;
  /** 縁をぼかして下の層と馴染ませる */
  readonly feather: boolean;
  /** 線の太さの単位（画素）。表示のときの見え方を段階ごとに揃える */
  readonly linePx: number;
  /** 等高線の標高の数字を入れる */
  readonly elevationLabels: boolean;
}

/** 等高線・ケバ・崖の色（セピア） */
const CONTOUR_COLOR = "rgba(122,88,56,0.55)";
const INDEX_COLOR = "rgba(110,76,46,0.8)";
const HACHURE_COLOR = "rgba(92,66,42,0.72)";
const SCARP_COLOR = "rgba(80,56,34,0.9)";
const SYMBOL_INK = "rgba(58,70,44,0.78)";
/** 崖線とみなす傾斜（m/m、約 35°） */
const SCARP_SLOPE = 0.7;
/** 縁のぼかしの幅（一辺に対する割合） */
const FEATHER = 0.08;
const B1_HALF_M = 800;

const rgb = (c: Rgb, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;

export const bakeSpecs = (d: TerrainDataV2): BakeSpec[] => {
  const F = d.village.frame;
  const wh = d.village.windowHalfM;
  const [cx, cy] = F.center;
  return [
    {
      id: "b0",
      origin: [0, 0],
      ux: [1, 0],
      uy: [0, 1],
      sizeM: d.worldM,
      px: 1536,
      contourM: 10,
      indexEvery: 5,
      hachureM: 36,
      symbolM: 95,
      regionN: d.surround.size,
      washN: d.surround.size,
      feather: false,
      linePx: 1.6,
      elevationLabels: true,
    },
    {
      id: "b1",
      origin: [cx - B1_HALF_M, cy - B1_HALF_M],
      ux: [1, 0],
      uy: [0, 1],
      sizeM: B1_HALF_M * 2,
      px: 2048,
      contourM: 5,
      indexEvery: 5,
      hachureM: 14,
      symbolM: 30,
      regionN: 800,
      washN: 420,
      feather: true,
      linePx: 2,
      elevationLabels: true,
    },
    {
      // 村の座標系（a：下流向き、b：丘側）に合わせる。行 0 が丘側（b = +wh）、列 0 が上流側（a = −wh）
      id: "b3",
      origin: [cx - wh * F.axisA[0] + wh * F.axisB[0], cy - wh * F.axisA[1] + wh * F.axisB[1]],
      ux: F.axisA,
      uy: [-F.axisB[0], -F.axisB[1]],
      sizeM: wh * 2,
      px: 2048,
      contourM: 1,
      indexEvery: 5,
      hachureM: 6,
      symbolM: 9,
      regionN: 720,
      washN: 260,
      feather: true,
      linePx: 1.5,
      elevationLabels: true,
    },
  ];
};

/** ベイクの局所座標（m。画素の向き）→ 地図座標 */
export const bakeToWorld = (s: BakeSpec, u: number, v: number): Point => [
  s.origin[0] + u * s.ux[0] + v * s.uy[0],
  s.origin[1] + u * s.ux[1] + v * s.uy[1],
];

/** 地図座標 → ベイクの局所座標（m） */
export const worldToBake = (s: BakeSpec, p: Point): Point => {
  const dx = p[0] - s.origin[0];
  const dy = p[1] - s.origin[1];
  return [dx * s.ux[0] + dy * s.ux[1], dx * s.uy[0] + dy * s.uy[1]];
};

/** ベイクの範囲の標高を、局所座標（m）の格子に取り直す */
export const bakeRegion = (d: TerrainDataV2, s: BakeSpec, H: Float32Array = decode(d.surround)): HeightRegion => {
  const n = s.regionN;
  const cell = s.sizeM / n;
  const g = gridOf(d.surround.size);
  const h = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const [x, y] = bakeToWorld(s, (i + 0.5) * cell, (j + 0.5) * cell);
      h[j * n + i] = sampleBilinear(H, g, x, y);
    }
  }
  return { h, n, cell, origin: [cell / 2, cell / 2] };
};

type Ctx = OffscreenCanvasRenderingContext2D;

const surroundIndex = (d: TerrainDataV2, p: Point): number => {
  const n = d.surround.size;
  const c = d.worldM / n;
  const i = Math.max(0, Math.min(n - 1, Math.floor(p[0] / c)));
  const j = Math.max(0, Math.min(n - 1, Math.floor(p[1] / c)));
  return j * n + i;
};

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** 地質の色を植生の淡彩に少し混ぜる（岩・礫の所が灰色がかる） */
const washColor = (veg: number, geo: number): Rgb => {
  const base = mix(MAP_COLORS.paper, vegetationColor(veg), 0.78);
  if (geo === GEOLOGY_CLASS.bedrock) return mix(base, MAP_COLORS.bedrock, 0.35);
  if (geo === GEOLOGY_CLASS.gravel) return mix(base, MAP_COLORS.gravel, 0.3);
  if (geo === GEOLOGY_CLASS.clay) return mix(base, [196, 170, 130], 0.12);
  return base;
};

const smallCanvas = (n: number, px: Uint8ClampedArray<ArrayBuffer>): OffscreenCanvas => {
  const c = new OffscreenCanvas(n, n);
  c.getContext("2d")!.putImageData(new ImageData(px, n, n), 0, 0);
  return c;
};

const drawWash = (ctx: Ctx, d: TerrainDataV2, s: BakeSpec) => {
  const n = s.washN;
  const cell = s.sizeM / n;
  const px = new Uint8ClampedArray(n * n * 4);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = surroundIndex(d, bakeToWorld(s, (i + 0.5) * cell, (j + 0.5) * cell));
      const c = washColor(d.vegetation[k]!, d.geology[k]!);
      const o = (j * n + i) * 4;
      px[o] = c[0];
      px[o + 1] = c[1];
      px[o + 2] = c[2];
      px[o + 3] = 255;
    }
  }
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.globalAlpha = 0.9;
  ctx.drawImage(smallCanvas(n, px), 0, 0, s.px, s.px);
  ctx.restore();
};

/** 陰影（乗算）。光源は左上（机のランプの向き。§7.4）。平らな所は 1（紙の色のまま）、陰の斜面だけを暗くする */
export const hillshade = (r: HeightRegion): Float32Array => {
  const { h, n, cell } = r;
  const out = new Float32Array(n * n);
  const lx = -0.6;
  const ly = -0.6;
  const lz = 0.53;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const i0 = Math.max(0, i - 1);
      const i1 = Math.min(n - 1, i + 1);
      const j0 = Math.max(0, j - 1);
      const j1 = Math.min(n - 1, j + 1);
      const gx = (h[j * n + i1]! - h[j * n + i0]!) / ((i1 - i0) * cell);
      const gy = (h[j1 * n + i]! - h[j0 * n + i]!) / ((j1 - j0) * cell);
      const inv = 1 / Math.sqrt(gx * gx + gy * gy + 1);
      const shade = (-gx * lx - gy * ly + lz) * inv;
      out[j * n + i] = Math.max(0.45, Math.min(1, 1 + 0.95 * (shade - lz)));
    }
  }
  return out;
};

const drawShade = (ctx: Ctx, s: BakeSpec, r: HeightRegion) => {
  const shade = hillshade(r);
  const n = r.n;
  const px = new Uint8ClampedArray(n * n * 4);
  for (let k = 0; k < n * n; k++) {
    const v = shade[k]!;
    // 陰は少し青みのある灰色に（墨の黒にしない）
    px[k * 4] = 255 * v;
    px[k * 4 + 1] = 255 * (0.02 + 0.98 * v);
    px[k * 4 + 2] = 255 * (0.06 + 0.94 * v);
    px[k * 4 + 3] = 255;
  }
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.globalCompositeOperation = "multiply";
  ctx.drawImage(smallCanvas(n, px), 0, 0, s.px, s.px);
  ctx.restore();
};

const toPx = (s: BakeSpec, p: Point): Point => [(p[0] * s.px) / s.sizeM, (p[1] * s.px) / s.sizeM];
const worldPx = (s: BakeSpec, p: Point): Point => toPx(s, worldToBake(s, p));

const addPath = (ctx: Ctx, pts: Polyline) => {
  pts.forEach((p, k) => (k === 0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1])));
};

const pathLength = (pts: Polyline) => {
  let s = 0;
  for (let k = 1; k < pts.length; k++) s += Math.hypot(pts[k]![0] - pts[k - 1]![0], pts[k]![1] - pts[k - 1]![1]);
  return s;
};

const drawContours = (ctx: Ctx, s: BakeSpec, r: HeightRegion, seed: number) => {
  const lines = contourLines(r, s.contourM, s.indexEvery, steepCell(r));
  const amp = 0.45 * s.linePx;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const index of [false, true]) {
    ctx.beginPath();
    for (const line of lines) {
      if (line.index !== index) continue;
      addPath(ctx, wobble(line.points.map((p) => toPx(s, p)), seed + line.level, amp));
    }
    ctx.strokeStyle = index ? INDEX_COLOR : CONTOUR_COLOR;
    ctx.lineWidth = (index ? 0.95 : 0.5) * s.linePx;
    ctx.stroke();
  }
  // 計曲線の標高：長い線に、間隔を空けて
  if (s.elevationLabels) {
    const fontPx = 8.5 * s.linePx;
    ctx.font = `${fontPx}px serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const placed: Point[] = [];
    const every = 260 * s.linePx;
    for (const line of lines) {
      if (!line.index) continue;
      const pts = line.points.map((p) => toPx(s, p));
      const total = pathLength(pts);
      if (total < every * 0.8) continue;
      let acc = 0;
      let next = every * 0.4;
      for (let k = 1; k < pts.length; k++) {
        const a = pts[k - 1]!;
        const b = pts[k]!;
        const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (acc + seg >= next && seg > 0) {
          const t = (next - acc) / seg;
          const at: Point = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
          next += every;
          if (at[0] < fontPx * 2 || at[1] < fontPx * 2 || at[0] > s.px - fontPx * 2 || at[1] > s.px - fontPx * 2) continue;
          if (placed.some((q) => Math.hypot(q[0] - at[0], q[1] - at[1]) < every * 0.6)) continue;
          placed.push(at);
          // 地図に置いたときに逆さにならないように（b3 は村の座標系に回して置くので、その回転を足して判定する）
          let angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
          if (Math.cos(angle + Math.atan2(s.ux[1], s.ux[0])) < 0) angle += Math.PI;
          ctx.save();
          ctx.translate(at[0], at[1]);
          ctx.rotate(angle);
          const text = String(Math.round(line.level));
          ctx.lineWidth = 2.6 * s.linePx;
          ctx.strokeStyle = "rgba(232,220,192,0.85)";
          ctx.strokeText(text, 0, 0);
          ctx.fillStyle = INDEX_COLOR;
          ctx.fillText(text, 0, 0);
          ctx.restore();
        }
        acc += seg;
      }
    }
  }
  ctx.restore();
};

const drawHachures = (ctx: Ctx, s: BakeSpec, r: HeightRegion, seed: number) => {
  const marks = hachures(r, s.hachureM, seed);
  ctx.save();
  ctx.lineCap = "round";
  ctx.strokeStyle = HACHURE_COLOR;
  // 太さの段ごとにまとめて引く（速さのため）
  const buckets = new Map<number, typeof marks>();
  for (const m of marks) {
    const b = Math.round(m.weight * 4) / 4;
    const list = buckets.get(b);
    if (list) list.push(m);
    else buckets.set(b, [m]);
  }
  for (const [w, list] of buckets) {
    ctx.beginPath();
    for (const m of list) {
      const a = toPx(s, m.from);
      const b = toPx(s, m.to);
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
    }
    ctx.lineWidth = 0.45 * w * s.linePx;
    ctx.stroke();
  }
  ctx.restore();
};

/** 崖線：傾斜が SCARP_SLOPE を超える所の縁に、下り向きの歯を付けた線（段丘の縁などを明瞭に） */
const drawScarps = (ctx: Ctx, s: BakeSpec, r: HeightRegion) => {
  const { h, n, cell } = r;
  const slope = new Float32Array(n * n);
  const grad = (i: number, j: number): [number, number] => {
    const i0 = Math.max(0, i - 1);
    const i1 = Math.min(n - 1, i + 1);
    const j0 = Math.max(0, j - 1);
    const j1 = Math.min(n - 1, j + 1);
    return [(h[j * n + i1]! - h[j * n + i0]!) / ((i1 - i0) * cell), (h[j1 * n + i]! - h[j0 * n + i]!) / ((j1 - j0) * cell)];
  };
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const [gx, gy] = grad(i, j);
      // 1つの水準（SCARP_SLOPE）だけの等値線になるよう、上限を 2 倍未満に抑える
      slope[j * n + i] = Math.min(SCARP_SLOPE * 1.9, Math.hypot(gx, gy));
    }
  }
  const edges = contourLines({ h: slope, n, cell, origin: r.origin }, SCARP_SLOPE, 1).filter((l) => l.points.length > 3);
  ctx.save();
  ctx.strokeStyle = SCARP_COLOR;
  ctx.lineCap = "round";
  ctx.lineWidth = 0.8 * s.linePx;
  ctx.beginPath();
  for (const e of edges) addPath(ctx, e.points.map((p) => toPx(s, p)));
  ctx.stroke();
  // 歯（下り向き）
  ctx.lineWidth = 0.6 * s.linePx;
  ctx.beginPath();
  const tooth = 3.2 * s.linePx;
  for (const e of edges) {
    const pts = e.points.map((p) => toPx(s, p));
    let acc = 0;
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1]!;
      const b = pts[k]!;
      acc += Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (acc < tooth * 1.6) continue;
      acc = 0;
      const p = e.points[k]!;
      const [gx, gy] = grad(Math.min(n - 1, Math.max(0, Math.round(p[0] / cell - 0.5))), Math.min(n - 1, Math.max(0, Math.round(p[1] / cell - 0.5))));
      const gl = Math.hypot(gx, gy) || 1;
      ctx.moveTo(b[0], b[1]);
      ctx.lineTo(b[0] - (gx / gl) * tooth, b[1] - (gy / gl) * tooth);
    }
  }
  ctx.stroke();
  ctx.restore();
};

const drawWater = (ctx: Ctx, d: TerrainDataV2, s: BakeSpec, seed: number) => {
  const mpp = s.sizeM / s.px;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // 湿地・旧河道：淡い面と、水平の短い線（記号は植生の記号が担う）
  for (const w of [...d.wetlands, ...d.oldChannels]) {
    ctx.beginPath();
    addPath(ctx, w.map((p) => worldPx(s, p)));
    ctx.closePath();
    ctx.fillStyle = rgb(MAP_COLORS.wetland, 0.45);
    ctx.fill();
  }
  ctx.setLineDash([3 * s.linePx, 2.5 * s.linePx]);
  for (const w of d.oldChannels) {
    ctx.beginPath();
    addPath(ctx, wobble(w.map((p) => worldPx(s, p)), seed + 3, 0.5 * s.linePx));
    ctx.closePath();
    ctx.strokeStyle = rgb(MAP_COLORS.riverLine, 0.45);
    ctx.lineWidth = 0.6 * s.linePx;
    ctx.stroke();
  }
  ctx.setLineDash([]);
  // 湖：淡い面、岸の線、岸に沿う内側の線
  for (const lake of d.lakes) {
    const pts = wobble(lake.map((p) => worldPx(s, p)), seed + 5, 0.5 * s.linePx);
    ctx.beginPath();
    addPath(ctx, pts);
    ctx.closePath();
    ctx.fillStyle = rgb(MAP_COLORS.waterShallow, 0.95);
    ctx.fill();
    ctx.strokeStyle = rgb(MAP_COLORS.waterDeep, 0.5);
    ctx.lineWidth = 3.2 * s.linePx;
    ctx.save();
    ctx.clip();
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = rgb(MAP_COLORS.riverLine, 0.9);
    ctx.lineWidth = 0.8 * s.linePx;
    ctx.stroke();
  }
  // 川：岸の線（濃い）→ 水面（淡い）。幅は集水域から
  for (const [color, extra] of [
    [rgb(MAP_COLORS.riverLine, 0.95), 1.5],
    [rgb(MAP_COLORS.waterShallow), 0],
  ] as const) {
    ctx.strokeStyle = color;
    for (const r of d.rivers) {
      const pts = wobble(r.points.map((p) => worldPx(s, p)), seed + r.name.length, 0.35 * s.linePx);
      for (let k = 0; k + 1 < pts.length; k++) {
        ctx.beginPath();
        ctx.moveTo(pts[k]![0], pts[k]![1]);
        ctx.lineTo(pts[k + 1]![0], pts[k + 1]![1]);
        const w = Math.max((r.main ? 1.4 : 0.8) * s.linePx, r.widths[k]! / mpp);
        ctx.lineWidth = w + extra * s.linePx;
        ctx.stroke();
      }
    }
  }
  ctx.restore();
};

const drawSymbol = (ctx: Ctx, sym: VegetationSymbol, at: Point, r: number) => {
  const [x, y] = at;
  const z = r * sym.size;
  switch (sym.kind) {
    case "broadleaf":
      ctx.moveTo(x + z, y);
      ctx.arc(x, y, z, 0, Math.PI * 2);
      ctx.moveTo(x, y + z);
      ctx.lineTo(x, y + z * 1.6);
      break;
    case "conifer":
      ctx.moveTo(x, y - z * 1.3);
      ctx.lineTo(x - z * 0.75, y + z * 0.7);
      ctx.lineTo(x + z * 0.75, y + z * 0.7);
      ctx.closePath();
      ctx.moveTo(x, y + z * 0.7);
      ctx.lineTo(x, y + z * 1.4);
      break;
    case "scrub":
      for (const [dx, dy] of [
        [-0.7, 0.2],
        [0, -0.4],
        [0.7, 0.2],
      ] as const) {
        ctx.moveTo(x + dx * z + z * 0.3, y + dy * z);
        ctx.arc(x + dx * z, y + dy * z, z * 0.3, 0, Math.PI * 2);
      }
      break;
    case "grass":
      ctx.moveTo(x - z * 0.6, y + z * 0.4);
      ctx.lineTo(x - z * 0.3, y - z * 0.4);
      ctx.moveTo(x, y + z * 0.4);
      ctx.lineTo(x, y - z * 0.6);
      ctx.moveTo(x + z * 0.6, y + z * 0.4);
      ctx.lineTo(x + z * 0.3, y - z * 0.4);
      break;
    case "wetland":
      ctx.moveTo(x - z * 1.1, y + z * 0.5);
      ctx.lineTo(x + z * 1.1, y + z * 0.5);
      ctx.moveTo(x - z * 0.5, y + z * 0.3);
      ctx.lineTo(x - z * 0.6, y - z * 0.4);
      ctx.moveTo(x, y + z * 0.3);
      ctx.lineTo(x, y - z * 0.6);
      ctx.moveTo(x + z * 0.5, y + z * 0.3);
      ctx.lineTo(x + z * 0.6, y - z * 0.4);
      break;
  }
};

const drawSymbols = (ctx: Ctx, d: TerrainDataV2, s: BakeSpec, seed: number) => {
  const F = d.village.frame;
  const keepOut = F.halfM + 12;
  const syms = vegetationSymbols(
    (p) => d.vegetation[surroundIndex(d, bakeToWorld(s, p[0], p[1]))]!,
    { x0: 0, y0: 0, x1: s.sizeM, y1: s.sizeM },
    s.symbolM,
    seed,
    (p) => {
      const [a, b] = toLocal(F, bakeToWorld(s, p[0], p[1]));
      return Math.abs(a) < keepOut && Math.abs(b) < keepOut;
    },
  );
  ctx.save();
  ctx.strokeStyle = SYMBOL_INK;
  ctx.fillStyle = "rgba(96,116,70,0.28)";
  ctx.lineWidth = 0.5 * s.linePx;
  const r = 2.4 * s.linePx;
  for (const kind of ["broadleaf", "conifer", "scrub", "grass", "wetland"] as const) {
    ctx.beginPath();
    for (const sym of syms) if (sym.kind === kind) drawSymbol(ctx, sym, toPx(s, sym.at), r);
    if (kind === "broadleaf" || kind === "conifer") ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
};

const drawHighway = (ctx: Ctx, d: TerrainDataV2, s: BakeSpec, seed: number) => {
  const pts = wobble(d.highway.points.map((p) => worldPx(s, p)), seed + 17, 0.4 * s.linePx);
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  addPath(ctx, pts);
  ctx.strokeStyle = rgb(MAP_COLORS.roadLine, 0.9);
  ctx.lineWidth = 2.6 * s.linePx;
  ctx.stroke();
  ctx.strokeStyle = rgb(MAP_COLORS.road);
  ctx.lineWidth = 1.4 * s.linePx;
  ctx.stroke();
  // 渡河点：川を渡る2本の短い線（橋・渡しの記号）
  ctx.strokeStyle = rgb(MAP_COLORS.ink, 0.85);
  ctx.lineWidth = 0.8 * s.linePx;
  for (const f of d.fords) {
    const k = d.highway.points.reduce(
      (best, p, i) => (Math.hypot(p[0] - f[0], p[1] - f[1]) < Math.hypot(d.highway.points[best]![0] - f[0], d.highway.points[best]![1] - f[1]) ? i : best),
      0,
    );
    const a = d.highway.points[Math.max(0, k - 1)]!;
    const b = d.highway.points[Math.min(d.highway.points.length - 1, k + 1)]!;
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const c = worldPx(s, f);
    const len = 4.5 * s.linePx;
    const off = 2.2 * s.linePx;
    ctx.beginPath();
    for (const side of [-1, 1]) {
      const ox = -Math.sin(ang) * off * side;
      const oy = Math.cos(ang) * off * side;
      ctx.moveTo(c[0] + ox - Math.cos(ang) * len, c[1] + oy - Math.sin(ang) * len);
      ctx.lineTo(c[0] + ox + Math.cos(ang) * len, c[1] + oy + Math.sin(ang) * len);
    }
    ctx.stroke();
  }
  ctx.restore();
};

/** 標高点（山・丘の頂）：点と標高の数字 */
const drawSpotHeights = (ctx: Ctx, d: TerrainDataV2, s: BakeSpec, H: Float32Array) => {
  const g = gridOf(d.surround.size);
  ctx.save();
  ctx.fillStyle = rgb(MAP_COLORS.ink, 0.85);
  const fontPx = 8 * s.linePx;
  ctx.font = `${fontPx}px serif`;
  ctx.textBaseline = "middle";
  for (const t of d.toponyms) {
    if (t.kind !== "mountain" && t.kind !== "hill") continue;
    const [x, y] = worldPx(s, t.anchor);
    if (x < 0 || y < 0 || x > s.px || y > s.px) continue;
    ctx.beginPath();
    ctx.arc(x, y, 1.2 * s.linePx, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillText(String(Math.round(sampleBilinear(H, g, t.anchor[0], t.anchor[1]))), x + 2.5 * s.linePx, y);
  }
  ctx.restore();
};

const drawPaper = (ctx: Ctx, s: BakeSpec, mottle: OffscreenCanvas) => {
  ctx.fillStyle = rgb(MAP_COLORS.paper);
  ctx.fillRect(0, 0, s.px, s.px);
  const pattern = ctx.createPattern(mottle, "repeat");
  if (pattern) {
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    ctx.globalAlpha = 0.09;
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, s.px, s.px);
    ctx.restore();
  }
};

/** 水彩のむら（淡彩の上に乗算） */
const drawMottle = (ctx: Ctx, s: BakeSpec, mottle: OffscreenCanvas) => {
  const pattern = ctx.createPattern(mottle, "repeat");
  if (!pattern) return;
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = pattern;
  ctx.scale(2.5, 2.5);
  ctx.fillRect(0, 0, s.px / 2.5, s.px / 2.5);
  ctx.restore();
};

/** 縁を透明へぼかす（下の層と馴染ませ、継ぎ目を見せない） */
const featherEdges = (ctx: Ctx, s: BakeSpec) => {
  const w = s.px * FEATHER;
  ctx.save();
  ctx.globalCompositeOperation = "destination-in";
  for (const horizontal of [true, false]) {
    const g = horizontal ? ctx.createLinearGradient(0, 0, s.px, 0) : ctx.createLinearGradient(0, 0, 0, s.px);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(w / s.px, "rgba(0,0,0,1)");
    g.addColorStop(1 - w / s.px, "rgba(0,0,0,1)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s.px, s.px);
  }
  ctx.restore();
};

export interface BakedLayer {
  readonly spec: BakeSpec;
  readonly canvas: OffscreenCanvas;
  readonly ms: number;
}

/** 1枚をベイクする */
export const bakeLayer = (d: TerrainDataV2, s: BakeSpec, H: Float32Array, mottle: OffscreenCanvas): BakedLayer => {
  const t0 = performance.now();
  const canvas = new OffscreenCanvas(s.px, s.px);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  const seed = d.seed ^ s.px;
  const region = bakeRegion(d, s, H);
  drawPaper(ctx, s, mottle);
  drawWash(ctx, d, s);
  drawMottle(ctx, s, mottle);
  drawShade(ctx, s, region);
  drawContours(ctx, s, region, seed);
  drawHachures(ctx, s, region, seed);
  drawScarps(ctx, s, region);
  drawWater(ctx, d, s, seed);
  drawSymbols(ctx, d, s, seed);
  drawHighway(ctx, d, s, seed);
  drawSpotHeights(ctx, d, s, H);
  if (s.feather) featherEdges(ctx, s);
  return { spec: s, canvas, ms: performance.now() - t0 };
};

/** 3枚すべて（Worker から呼ぶ） */
export const bakeAll = (d: TerrainDataV2): BakedLayer[] => {
  const H = decode(d.surround);
  const m = 256;
  const mottle = smallCanvas(m, mottlePixels(m, d.seed));
  return bakeSpecs(d).map((s) => bakeLayer(d, s, H, mottle));
};
