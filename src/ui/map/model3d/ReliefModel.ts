import { BUILDINGS, type BuildingId, type Category } from "../../../domain/Buildings";
import { categoryTint } from "../../theme";
import { RELIEF_HALF_M, TREE_SIZE, type FlatShape, type ReliefScene, type Vec3 } from "./ReliefMesh";

// 地形模型（SPEC_v3.4 §10、M4）の描画。Three.js は承認されていないので（BB-04・DECISIONS BC-41）、
// Canvas 2D の上の擬似3D：正射影で、格子の面・水面・道・畑・樹木・建物の箱を奥から手前へ塗る（画家のアルゴリズム）。
// 石膏の素材（白い面を光の向きで陰影づけ）、半透明の水面、机のランプと整合した光（光の向きは机に固定し、模型を回すと陰が動く）。
// 描くのは ReliefMesh が MapViewModel と地形から作った形だけ。空洞・進捗は表現しない。

export interface ReliefCamera {
  /** 水平の回転（rad） */
  readonly yaw: number;
  /** 見下ろす角度（rad、水平から） */
  readonly pitch: number;
  readonly zoom: number;
}

export const RELIEF_PITCH_MIN = (20 * Math.PI) / 180;
export const RELIEF_PITCH_MAX = (85 * Math.PI) / 180;
export const RELIEF_ZOOM_MIN = 0.8;
export const RELIEF_ZOOM_MAX = 4;
export const DEFAULT_CAMERA: ReliefCamera = { yaw: (-18 * Math.PI) / 180, pitch: (42 * Math.PI) / 180, zoom: 1 };

export const clampCamera = (c: ReliefCamera): ReliefCamera => ({
  yaw: Math.atan2(Math.sin(c.yaw), Math.cos(c.yaw)),
  pitch: Math.max(RELIEF_PITCH_MIN, Math.min(RELIEF_PITCH_MAX, c.pitch)),
  zoom: Math.max(RELIEF_ZOOM_MIN, Math.min(RELIEF_ZOOM_MAX, c.zoom)),
});

/**
 * 光。向きは机の座標（x：右、y：手前、z：上）で、光源へ向かう向き。
 * 机のランプ（点光源）の位置と模型の置き場から求める（ReliefPanel）。窓の光は弱い補助。
 */
export interface ReliefLight {
  readonly lamp: Vec3;
  readonly window: Vec3;
}

const PLASTER: Vec3 = [236, 230, 217];
const LAMP_TINT: Vec3 = [255, 236, 206];
/** 陰影：平らな面の明るさを FLAT_SHADE にそろえ、光への向きの差を CONTRAST 倍して強調する（石膏の起伏を読みやすく） */
const FLAT_SHADE = 0.96;
const CONTRAST = 1.5;
const WINDOW_STRENGTH = 0.25;
/** 地表の物（水・道・畑・樹木・建物）を、同じ深さの地面より後に塗る（m） */
const FEATURE_BIAS_M = 14;

const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

interface Projector {
  /** 村の座標 (a, b, h) → 画面 (x, y) と深さ（大きいほど奥） */
  readonly project: (a: number, b: number, h: number) => [number, number, number];
  /** 模型の面の法線（a, b, h の向き）→ 回した後の向き（x, 奥, 上） */
  readonly turn: (n: Vec3) => Vec3;
  /** 回した後の座標で、カメラへ向かう向き */
  readonly toCamera: Vec3;
  readonly scale: number;
}

export const projector = (cam: ReliefCamera, size: number, midHeight: number): Projector => {
  const c = Math.cos(cam.yaw);
  const s = Math.sin(cam.yaw);
  const cp = Math.cos(cam.pitch);
  const sp = Math.sin(cam.pitch);
  const scale = (cam.zoom * size) / (2 * RELIEF_HALF_M * 1.45);
  const cy = size / 2 + midHeight * cp * scale;
  return {
    scale,
    project: (a, b, h) => {
      const x1 = c * a - s * b;
      const z1 = s * a + c * b;
      return [size / 2 + x1 * scale, cy - (z1 * sp + h * cp) * scale, z1 * cp - h * sp];
    },
    turn: ([a, b, h]) => [c * a - s * b, s * a + c * b, h],
    toCamera: [0, -cp, sp],
  };
};

/** 光の向き（机の座標）を、回した後の座標（x, 奥, 上）へ。机の手前（+y）は模型の奥の逆 */
const lightIn = (v: Vec3): Vec3 => norm([v[0], -v[1], v[2]]);

const shadeOf = (n: Vec3, light: ReliefLight): number => {
  const l = lightIn(light.lamp);
  const w = lightIn(light.window);
  const d = n[0] * l[0] + n[1] * l[1] + n[2] * l[2];
  const dw = n[0] * w[0] + n[1] * w[1] + n[2] * w[2];
  // 平らな面（n = 上）との差だけを強調する
  return FLAT_SHADE + CONTRAST * (d - l[2]) + WINDOW_STRENGTH * (dw - w[2]);
};

/** 立った面（台座の側面・建物の壁）：上向きとの差ではなく、光の向きへの向きだけで明るさを決める */
const wallShade = (n: Vec3, light: ReliefLight): number => {
  const l = lightIn(light.lamp);
  const w = lightIn(light.window);
  return 0.66 + 0.4 * Math.max(0, n[0] * l[0] + n[1] * l[1] + n[2] * l[2]) + 0.12 * Math.max(0, n[0] * w[0] + n[1] * w[1] + n[2] * w[2]);
};

/** ランプの暖色は半分だけ（石膏の白さを残す） */
const lampTint = (k: 0 | 1 | 2) => 1 - 0.5 * (1 - LAMP_TINT[k] / 255);

/** 陰影の段（塗りをまとめるため、明るさを 1/64 刻みに丸める） */
const plasterColor = (shade: number): string => {
  const q = Math.round(Math.max(0.35, Math.min(1.12, shade)) * 64) / 64;
  const c = (k: 0 | 1 | 2) => Math.round(Math.min(255, PLASTER[k] * q * lampTint(k)));
  return `rgb(${c(0)},${c(1)},${c(2)})`;
};

const FLAT_STYLE: Readonly<Record<FlatShape["kind"], { fill: string; stroke?: string; dash?: boolean }>> = {
  wetland: { fill: "rgba(140,165,140,0.45)" },
  lake: { fill: "rgba(110,150,170,0.55)", stroke: "rgba(70,100,115,0.6)" },
  river: { fill: "rgba(110,150,170,0.6)" },
  highway: { fill: "rgba(176,156,118,0.85)" },
  road: { fill: "rgba(190,168,126,0.95)" },
  field: { fill: "rgba(206,188,132,0.85)" },
  construction: { fill: "rgba(0,0,0,0)", stroke: "rgba(43,29,14,0.8)", dash: true },
};

type Prim =
  | { readonly t: "quad"; readonly depth: number; readonly pts: number[]; readonly color: string }
  | { readonly t: "flat"; readonly depth: number; readonly pts: number[]; readonly kind: FlatShape["kind"] }
  | { readonly t: "tree"; readonly depth: number; readonly base: [number, number]; readonly top: [number, number]; readonly r: number; readonly conifer: boolean }
  | { readonly t: "face"; readonly depth: number; readonly pts: number[]; readonly color: string };

const mixTint = (hex: string, shade: number): string => {
  const v = Number.parseInt(hex.slice(1), 16);
  const c: Vec3 = [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  // 建物は石膏に色を少しだけ差す（彩度を落とす）
  const m = (k: 0 | 1 | 2) => Math.round(Math.min(255, (PLASTER[k] * 0.6 + c[k] * 0.4) * shade));
  return `rgb(${m(0)},${m(1)},${m(2)})`;
};

export interface ReliefDrawStats {
  readonly primitives: number;
}

/** 模型を描く（ctx の 0..size の正方形に） */
export const drawRelief = (ctx: CanvasRenderingContext2D, size: number, scene: ReliefScene, cam: ReliefCamera, light: ReliefLight): ReliefDrawStats => {
  const { grid } = scene;
  const L = grid.lines;
  const n = L.length;
  const H = grid.heights;
  let hi = 0;
  for (const h of H) hi = Math.max(hi, h);
  const P = projector(cam, size, hi / 2);
  const prims: Prim[] = [];

  // 頂点を一度だけ射影する
  const sx = new Float32Array(n * n);
  const sy = new Float32Array(n * n);
  const sd = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const [x, y, d] = P.project(L[i]!, L[j]!, H[k]!);
      sx[k] = x;
      sy[k] = y;
      sd[k] = d;
    }
  }
  // 頂点の勾配（中心差分）。面の法線は4頂点の平均にして、粗い格子でも陰影を滑らかに
  const ga = new Float32Array(n * n);
  const gb = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const i0 = Math.max(0, i - 1);
      const i1 = Math.min(n - 1, i + 1);
      const j0 = Math.max(0, j - 1);
      const j1 = Math.min(n - 1, j + 1);
      ga[j * n + i] = (H[j * n + i1]! - H[j * n + i0]!) / (L[i1]! - L[i0]!);
      gb[j * n + i] = (H[j1 * n + i]! - H[j0 * n + i]!) / (L[j1]! - L[j0]!);
    }
  }
  // 地面の面
  for (let j = 0; j + 1 < n; j++) {
    for (let i = 0; i + 1 < n; i++) {
      const k = j * n + i;
      const qa = (ga[k]! + ga[k + 1]! + ga[k + n]! + ga[k + n + 1]!) / 4;
      const qb = (gb[k]! + gb[k + 1]! + gb[k + n]! + gb[k + n + 1]!) / 4;
      const nrm = P.turn(norm([-qa, -qb, 1]));
      prims.push({
        t: "quad",
        depth: (sd[k]! + sd[k + 1]! + sd[k + n]! + sd[k + n + 1]!) / 4,
        pts: [sx[k]!, sy[k]!, sx[k + 1]!, sy[k + 1]!, sx[k + n + 1]!, sy[k + n + 1]!, sx[k + n]!, sy[k + n]!],
        color: plasterColor(shadeOf(nrm, light)),
      });
    }
  }
  // 台座の側面（カメラに向いた面だけ）。縁の線と底を1枚の面にし、最後に塗る：
  // 模型は角柱なので、カメラに向いた外側の面より手前に模型の中身が来ることはない
  const skirt = (ks: number[], outward: Vec3) => {
    const o = P.turn(outward);
    if (o[0] * P.toCamera[0] + o[1] * P.toCamera[1] + o[2] * P.toCamera[2] <= 0) return;
    const pts: number[] = [];
    for (const k of ks) pts.push(sx[k]!, sy[k]!);
    const last = ks[ks.length - 1]!;
    const first = ks[0]!;
    const [x1, y1] = P.project(L[last % n]!, L[Math.floor(last / n)]!, grid.base);
    const [x0, y0] = P.project(L[first % n]!, L[Math.floor(first / n)]!, grid.base);
    pts.push(x1, y1, x0, y0);
    prims.push({ t: "face", depth: -Infinity, pts, color: plasterColor(wallShade(o, light) * 0.9) });
  };
  const row = (j: number) => Array.from({ length: n }, (_, i) => j * n + i);
  const col = (i: number) => Array.from({ length: n }, (_, j) => j * n + i);
  skirt(row(0), [0, -1, 0]);
  skirt(row(n - 1), [0, 1, 0]);
  skirt(col(0), [-1, 0, 0]);
  skirt(col(n - 1), [1, 0, 0]);

  // 地表の物
  for (const f of scene.flats) {
    const pts: number[] = [];
    let depth = 0;
    for (const [a, b, h] of f.polygon) {
      const [x, y, d] = P.project(a, b, h);
      pts.push(x, y);
      depth += d;
    }
    prims.push({ t: "flat", depth: depth / f.polygon.length - FEATURE_BIAS_M, pts, kind: f.kind });
  }
  for (const tr of scene.trees) {
    const [bx, by, d] = P.project(tr.at[0], tr.at[1], tr.at[2]);
    const [tx, ty] = P.project(tr.at[0], tr.at[1], tr.at[2] + TREE_SIZE.height);
    prims.push({ t: "tree", depth: d - FEATURE_BIAS_M, base: [bx, by], top: [tx, ty], r: TREE_SIZE.radius * P.scale, conifer: tr.conifer });
  }
  // 建物の箱：上面と、カメラに向いた側面
  for (const box of scene.boxes) {
    const fp = box.footprint;
    const top = box.ground + box.height;
    const tint = categoryTint[categoryOf(box.kind)];
    const up = shadeOf(P.turn([0, 0, 1]), light);
    const topPts: number[] = [];
    let topDepth = 0;
    for (const [a, b] of fp) {
      const [x, y, d] = P.project(a, b, top);
      topPts.push(x, y);
      topDepth += d;
    }
    for (let q = 0; q < fp.length; q++) {
      const p0 = fp[q]!;
      const p1 = fp[(q + 1) % fp.length]!;
      const cx = fp.reduce((s, p) => s + p[0], 0) / fp.length;
      const cyy = fp.reduce((s, p) => s + p[1], 0) / fp.length;
      // 外向きの法線
      let nx = p1[1] - p0[1];
      let ny = -(p1[0] - p0[0]);
      if (nx * ((p0[0] + p1[0]) / 2 - cx) + ny * ((p0[1] + p1[1]) / 2 - cyy) < 0) {
        nx = -nx;
        ny = -ny;
      }
      const o = P.turn(norm([nx, ny, 0]));
      if (o[0] * P.toCamera[0] + o[1] * P.toCamera[1] + o[2] * P.toCamera[2] <= 0) continue;
      const a0 = P.project(p0[0], p0[1], box.ground);
      const a1 = P.project(p1[0], p1[1], box.ground);
      const b1 = P.project(p1[0], p1[1], top);
      const b0 = P.project(p0[0], p0[1], top);
      prims.push({
        t: "face",
        depth: (a0[2] + a1[2] + b0[2] + b1[2]) / 4 - FEATURE_BIAS_M,
        pts: [a0[0], a0[1], a1[0], a1[1], b1[0], b1[1], b0[0], b0[1]],
        color: mixTint(tint, wallShade(o, light)),
      });
    }
    prims.push({ t: "face", depth: topDepth / fp.length - FEATURE_BIAS_M - 0.5, pts: topPts, color: mixTint(tint, up) });
  }

  prims.sort((p, q) => q.depth - p.depth);

  ctx.save();
  ctx.lineJoin = "round";
  let batch: string | null = null;
  const flush = () => {
    if (batch === null) return;
    ctx.fillStyle = batch;
    ctx.strokeStyle = batch;
    ctx.lineWidth = 0.8;
    ctx.fill();
    ctx.stroke(); // 隣の面との継ぎ目を埋める
    batch = null;
  };
  const poly = (pts: readonly number[]) => {
    ctx.moveTo(pts[0]!, pts[1]!);
    for (let k = 2; k < pts.length; k += 2) ctx.lineTo(pts[k]!, pts[k + 1]!);
    ctx.closePath();
  };
  for (const p of prims) {
    if (p.t === "quad" || p.t === "face") {
      if (batch !== p.color) {
        flush();
        ctx.beginPath();
        batch = p.color;
      }
      poly(p.pts);
      continue;
    }
    flush();
    if (p.t === "flat") {
      const st = FLAT_STYLE[p.kind];
      ctx.beginPath();
      poly(p.pts);
      ctx.fillStyle = st.fill;
      ctx.fill();
      if (st.stroke) {
        ctx.setLineDash(st.dash ? [3, 2] : []);
        ctx.strokeStyle = st.stroke;
        ctx.lineWidth = 0.8;
        ctx.stroke();
        ctx.setLineDash([]);
      }
    } else {
      // 樹木：針葉樹は円錐（三角）、広葉樹は丸い樹冠。模型の植栽のような濃い緑の塊
      const r = Math.max(1, p.r);
      ctx.beginPath();
      if (p.conifer) {
        ctx.moveTo(p.top[0], p.top[1]);
        ctx.lineTo(p.base[0] - r, p.base[1]);
        ctx.lineTo(p.base[0] + r, p.base[1]);
        ctx.closePath();
        ctx.fillStyle = "rgb(92,108,78)";
      } else {
        const cx = (p.base[0] + p.top[0]) / 2;
        const cy = p.base[1] + (p.top[1] - p.base[1]) * 0.62;
        ctx.ellipse(cx, cy, r * 1.15, r * 1.05, 0, 0, Math.PI * 2);
        ctx.fillStyle = "rgb(118,134,92)";
      }
      ctx.fill();
      ctx.strokeStyle = "rgba(60,70,48,0.6)";
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }
  }
  flush();
  ctx.restore();
  return { primitives: prims.length };
};

// 建物の種類 → 分類（地図の色と同じ）
const categoryOf = (kind: BuildingId): Category => BUILDINGS[kind].category;

/** 画面上の点 → 回転の操作量（ドラッグ）。横で回し、縦で傾ける */
export const dragCamera = (c: ReliefCamera, dxPx: number, dyPx: number, sizePx: number): ReliefCamera =>
  clampCamera({ ...c, yaw: c.yaw + (dxPx / sizePx) * Math.PI, pitch: c.pitch + (dyPx / sizePx) * (Math.PI / 2) });

export const zoomCamera = (c: ReliefCamera, factor: number): ReliefCamera => clampCamera({ ...c, zoom: c.zoom * factor });

/** 机の座標の光源の位置と模型の置き場から、光の向きを求める */
export const lightFrom = (lampAt: Vec3, modelAt: Vec3, window: Vec3): ReliefLight => ({
  lamp: norm([lampAt[0] - modelAt[0], lampAt[1] - modelAt[1], lampAt[2] - modelAt[2]]),
  window: norm(window),
});
