import { createNoise2D } from "simplex-noise";
import { createRandom } from "../terrain/rng";
import type { Point, Polyline } from "../terrain/types";

// 手仕事の揺らぎ（SPEC_v3.4 §6.2）。線の手ぶれ・太さの揺らぎ・版ずれ・水彩のむらと縁のにじみ。
// どれも seed 付きで決定論。可読性を優先して、ずれは画素で上限を設ける（HAND_MAX_WOBBLE_PX）。

/** 手ぶれの最大のずれ（画素）。文字・記号の判別を妨げないように小さく保つ */
export const HAND_MAX_WOBBLE_PX = 1.2;
/** 手ぶれの波長（画素） */
const WOBBLE_WAVE_PX = 40;
/** 線の太さの揺らぎ（±割合） */
export const HAND_WIDTH_JITTER = 0.22;
/** 版ずれ（色面を線画からずらす量、画素） */
export const MISREGISTRATION_PX: Point = [0.9, 0.6];

const noise = createNoise2D(createRandom(0x51ed));

/** 画素座標の折れ線に手ぶれを加える（法線方向へ、長さに沿った低周波ノイズで）。端点のずれも上限内 */
export const wobble = (pts: Polyline, seed: number, amplitudePx = HAND_MAX_WOBBLE_PX * 0.7): Point[] => {
  if (pts.length < 2) return [...pts];
  const amp = Math.min(amplitudePx, HAND_MAX_WOBBLE_PX);
  const out: Point[] = [];
  let s = 0;
  for (let k = 0; k < pts.length; k++) {
    const p = pts[k]!;
    const q = pts[Math.min(pts.length - 1, k + 1)]!;
    const r = pts[Math.max(0, k - 1)]!;
    const tx = q[0] - r[0];
    const ty = q[1] - r[1];
    const tl = Math.hypot(tx, ty) || 1;
    if (k > 0) s += Math.hypot(p[0] - pts[k - 1]![0], p[1] - pts[k - 1]![1]);
    const d = amp * noise(s / WOBBLE_WAVE_PX, seed * 0.137);
    out.push([p[0] - (ty / tl) * d, p[1] + (tx / tl) * d]);
  }
  return out;
};

/** 長い折れ線を、太さの揺らぎのための区間に分ける（各区間の太さの倍率つき） */
export const widthRuns = (pts: Polyline, seed: number, runPx = 24): { points: Point[]; scale: number }[] => {
  const runs: { points: Point[]; scale: number }[] = [];
  let cur: Point[] = [];
  let s = 0;
  let start = 0;
  pts.forEach((p, k) => {
    if (k > 0) s += Math.hypot(p[0] - pts[k - 1]![0], p[1] - pts[k - 1]![1]);
    cur.push(p);
    if (s - start >= runPx || k === pts.length - 1) {
      const scale = 1 + HAND_WIDTH_JITTER * noise((start + s) / 2 / 60, seed * 0.29 + 11);
      runs.push({ points: cur, scale });
      cur = [p];
      start = s;
    }
  });
  return runs.filter((r) => r.points.length > 1);
};

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** 手描き風の線（手ぶれ＋太さの揺らぎ） */
export const handStroke = (ctx: Ctx, pts: Polyline, widthPx: number, seed: number, wobblePx = HAND_MAX_WOBBLE_PX * 0.7): void => {
  for (const run of widthRuns(wobble(pts, seed, wobblePx), seed)) {
    ctx.beginPath();
    run.points.forEach((p, k) => (k === 0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1])));
    ctx.lineWidth = Math.max(0.3, widthPx * run.scale);
    ctx.stroke();
  }
};

/** 水彩の塗り：版ずれ・むら（パターン）・縁のにじみ（薄い太線を重ねる） */
export const washFill = (ctx: Ctx, path: Path2D, color: string, edge: string, mottle: CanvasPattern | null, alpha = 0.85): void => {
  ctx.save();
  ctx.translate(MISREGISTRATION_PX[0], MISREGISTRATION_PX[1]);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fill(path);
  if (mottle) {
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = mottle;
    ctx.fill(path);
  }
  ctx.globalAlpha = 0.14;
  ctx.strokeStyle = edge;
  ctx.lineWidth = 3;
  ctx.stroke(path);
  ctx.globalAlpha = 0.22;
  ctx.lineWidth = 1.2;
  ctx.stroke(path);
  ctx.restore();
};

/** 水彩のむらのパターンの画素（灰色のノイズ。乗算で重ねる） */
export const mottlePixels = (size: number, seed: number): Uint8ClampedArray<ArrayBuffer> => {
  const n = createNoise2D(createRandom(seed));
  const px = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // タイルとしてつながるように、円周上でノイズを取る
      const a = (x / size) * Math.PI * 2;
      const b = (y / size) * Math.PI * 2;
      const v = 0.5 + 0.35 * n(Math.cos(a) * 1.3 + Math.sin(b) * 0.7, Math.sin(a) * 1.3 + Math.cos(b) * 0.7) + 0.15 * n(x / 6, y / 6);
      const g = Math.max(0, Math.min(255, Math.round(v * 255)));
      const k = (y * size + x) * 4;
      px[k] = g;
      px[k + 1] = g;
      px[k + 2] = g;
      px[k + 3] = 255;
    }
  }
  return px;
};
