import type { BuildingId } from "../../../domain/Buildings";
import type { MapComposition } from "../composeMap";
import { decode, gridOf, sampleBilinear } from "../terrain/grid";
import { toLocal, toWorld } from "../terrain/geometry";
import { VEGETATION_CLASS } from "../terrain/Vegetation";
import type { Point, Polygon, TerrainDataV2 } from "../terrain/types";

// 地形模型（SPEC_v3.4 §10、M4。DECISIONS BC-41）の形：標高を高さにした格子、水面、樹木、建物の箱、道・畑・普請中の印。
// 純関数（DOM・Canvas に依存しない）。座標は村の座標系（a：下流向き、b：丘側、h：標高）のメートル。
// 入力は地図と同じ MapViewModel と、それから求めた構図（composeMap）と地形だけ。空洞・進捗・資材は受け取らない（不変条件21・26）。
// 普請中は地図と同じ一様な印（縄張り）だけで、高さ（どこまで建ったか）は持たない。

/** 模型の範囲（村の中心から ±m）。村域（±300m）とその周り */
export const RELIEF_HALF_M = 900;
/** 村域の周り（±INNER_HALF_M）は細かく、外は粗く（§10.2）。描く面の数が 1 フレームの時間を決める（約 3000 面） */
const INNER_HALF_M = 330;
const INNER_STEP_M = 20;
const OUTER_STEP_M = 50;
/** 高さの強調（模型は高さを誇張して作る） */
export const RELIEF_VERTICAL = 3;
/** 台座の厚み（m、模型の最低点の下） */
const PLINTH_M = 18;
/** 樹木を置く間隔と大きさ（m） */
const TREE_STEP_M = 34;
const TREE_HEIGHT_M = 7;
const TREE_RADIUS_M = 4;
/** 水面は地面から少し浮かせる（m） */
const WATER_LIFT_M = 0.6;

/** 棟の高さ（m）。種類ごとの見た目だけで、ロジックには関係しない */
export const BUILDING_HEIGHT_M: Readonly<Record<BuildingId, number>> = {
  residential: 6,
  tenement: 7,
  manor: 9,
  road: 0,
  well: 2,
  granary: 8,
  market: 4,
  farm: 4,
  workshop: 7,
  office: 10,
  school: 8,
  clinic: 7,
  temple: 13,
  watchtower: 16,
  courthouse: 10,
  jail: 7,
  taxoffice: 9,
};

export type Vec3 = readonly [number, number, number];

export interface ReliefGrid {
  /** 格子の線の位置（a・b とも同じ。昇順） */
  readonly lines: readonly number[];
  /** 高さ（m、強調済み）。lines.length² の行優先（行 = b の添字、列 = a の添字） */
  readonly heights: Float32Array;
  /** 台座の底の高さ */
  readonly base: number;
}

export interface FlatShape {
  readonly kind: "river" | "lake" | "wetland" | "road" | "highway" | "field" | "construction";
  /** 地面に沿わせた多角形の頂点（a, b, h） */
  readonly polygon: readonly Vec3[];
}

export interface Tree {
  readonly at: Vec3;
  readonly conifer: boolean;
}

export interface Box {
  readonly buildingId: number;
  readonly kind: BuildingId;
  /** 底面（a, b）の4点と、地面の高さ・棟の高さ（強調済み） */
  readonly footprint: readonly Point[];
  readonly ground: number;
  readonly height: number;
}

export interface ReliefScene {
  readonly grid: ReliefGrid;
  readonly flats: readonly FlatShape[];
  readonly trees: readonly Tree[];
  readonly boxes: readonly Box[];
}

/** 格子の線：外は粗く、村域の周りは細かく */
export const reliefLines = (): number[] => {
  const lines = new Set<number>();
  for (let t = -INNER_HALF_M; t <= INNER_HALF_M + 1e-9; t += INNER_STEP_M) lines.add(Math.round(t * 1000) / 1000);
  for (let t = INNER_HALF_M + OUTER_STEP_M; t < RELIEF_HALF_M; t += OUTER_STEP_M) {
    lines.add(t);
    lines.add(-t);
  }
  lines.add(RELIEF_HALF_M);
  lines.add(-RELIEF_HALF_M);
  return [...lines].sort((p, q) => p - q);
};

const heightCache = new WeakMap<TerrainDataV2, Float32Array>();
const decoded = (t: TerrainDataV2): Float32Array => {
  let h = heightCache.get(t);
  if (!h) {
    h = decode(t.surround);
    heightCache.set(t, h);
  }
  return h;
};

/** 村の座標 (a, b) の標高（強調前、m） */
const elevation = (t: TerrainDataV2, a: number, b: number): number => {
  const [x, y] = toWorld(t.village.frame, a, b);
  return sampleBilinear(decoded(t), gridOf(t.surround.size), x, y);
};

const gridCache = new WeakMap<TerrainDataV2, ReliefGrid>();

/** 標高の格子（地形だけで決まるので地形ごとに一度だけ） */
export const reliefGrid = (t: TerrainDataV2): ReliefGrid => {
  const cached = gridCache.get(t);
  if (cached) return cached;
  const lines = reliefLines();
  const n = lines.length;
  const raw = new Float32Array(n * n);
  let lo = Infinity;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const h = elevation(t, lines[i]!, lines[j]!);
      raw[j * n + i] = h;
      lo = Math.min(lo, h);
    }
  }
  // 最低点を 0 にそろえて強調する
  const heights = new Float32Array(n * n);
  for (let k = 0; k < n * n; k++) heights[k] = Math.max(0, (raw[k]! - lo) * RELIEF_VERTICAL);
  const grid: ReliefGrid = { lines, heights, base: -PLINTH_M };
  gridCache.set(t, grid);
  return grid;
};

/** 格子の上の高さ（双一次補間、強調済み） */
export const heightAt = (g: ReliefGrid, a: number, b: number): number => {
  const L = g.lines;
  const n = L.length;
  const find = (v: number) => {
    let lo = 0;
    let hi = n - 1;
    const c = Math.max(L[0]!, Math.min(L[n - 1]!, v));
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (L[mid]! <= c) lo = mid;
      else hi = mid;
    }
    return { k: lo, f: (c - L[lo]!) / (L[lo + 1]! - L[lo]! || 1) };
  };
  const ia = find(a);
  const ib = find(b);
  const h = g.heights;
  const k = ib.k * n + ia.k;
  return (
    h[k]! * (1 - ia.f) * (1 - ib.f) + h[k + 1]! * ia.f * (1 - ib.f) + h[k + n]! * (1 - ia.f) * ib.f + h[k + n + 1]! * ia.f * ib.f
  );
};

/** 多角形を模型の正方形（±RELIEF_HALF_M）で切る（Sutherland–Hodgman） */
export const clipToModel = (poly: readonly Point[]): Point[] => {
  let out = [...poly];
  const H = RELIEF_HALF_M;
  const edges: [(p: Point) => boolean, (p: Point, q: Point) => Point][] = [
    [(p) => p[0] >= -H, (p, q) => [-H, p[1] + ((q[1] - p[1]) * (-H - p[0])) / (q[0] - p[0])]],
    [(p) => p[0] <= H, (p, q) => [H, p[1] + ((q[1] - p[1]) * (H - p[0])) / (q[0] - p[0])]],
    [(p) => p[1] >= -H, (p, q) => [p[0] + ((q[0] - p[0]) * (-H - p[1])) / (q[1] - p[1]), -H]],
    [(p) => p[1] <= H, (p, q) => [p[0] + ((q[0] - p[0]) * (H - p[1])) / (q[1] - p[1]), H]],
  ];
  for (const [inside, cut] of edges) {
    const src = out;
    out = [];
    for (let k = 0; k < src.length; k++) {
      const p = src[k]!;
      const q = src[(k + 1) % src.length]!;
      if (inside(p)) {
        out.push(p);
        if (!inside(q)) out.push(cut(p, q));
      } else if (inside(q)) out.push(cut(p, q));
    }
    if (out.length === 0) break;
  }
  return out;
};

/** 地図座標の多角形を村の座標に移し、模型の範囲で切り、地面に沿わせる */
const drape = (t: TerrainDataV2, g: ReliefGrid, poly: Polygon, lift: number): Vec3[] =>
  clipToModel(poly.map((p) => toLocal(t.village.frame, p))).map(([a, b]) => [a, b, heightAt(g, a, b) + lift] as Vec3);

/** 折れ線を幅 widthM の帯（区間ごとの四角形）にする */
const ribbon = (line: readonly Point[], widthOf: (k: number) => number): Polygon[] => {
  const out: Polygon[] = [];
  for (let k = 0; k + 1 < line.length; k++) {
    const p = line[k]!;
    const q = line[k + 1]!;
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    const len = Math.hypot(dx, dy) || 1;
    const w = widthOf(k) / 2;
    const nx = (-dy / len) * w;
    const ny = (dx / len) * w;
    out.push([
      [p[0] + nx, p[1] + ny],
      [q[0] + nx, q[1] + ny],
      [q[0] - nx, q[1] - ny],
      [p[0] - nx, p[1] - ny],
    ]);
  }
  return out;
};

/** 地形と構図（MapViewModel から composeMap で求めたもの。地図と同じ）から模型の形を作る */
export const buildRelief = (t: TerrainDataV2, comp: MapComposition): ReliefScene => {
  const g = reliefGrid(t);
  const F = t.village.frame;
  const flats: FlatShape[] = [];
  const add = (kind: FlatShape["kind"], poly: Polygon, lift: number) => {
    if (poly.length < 3) return;
    const polygon = drape(t, g, poly, lift);
    if (polygon.length >= 3) flats.push({ kind, polygon });
  };
  // 水：湿地 → 湖 → 川（川幅は集水域から。細い支流も模型で見えるように最小 6m）
  for (const w of [...t.wetlands, ...t.oldChannels]) add("wetland", w, WATER_LIFT_M * 0.5);
  for (const lake of t.lakes) add("lake", lake, WATER_LIFT_M);
  for (const r of t.rivers) for (const q of ribbon(r.points, (k) => Math.max(6, r.widths[k] ?? 6))) add("river", q, WATER_LIFT_M);
  // 街道・本通り・畑・普請中（地図と同じ構図から）
  for (const q of ribbon(comp.highway, () => 7)) add("highway", q, 0.4);
  for (const piece of comp.roads.pieces) for (const q of ribbon(piece.points, () => 9)) add("road", q, 0.5);
  for (const f of comp.clearing.fields) add("field", f.polygon, 0.3);
  for (const m of comp.construction) add("construction", m.rope, 0.3);

  // 建物：棟の矩形を箱にする（外構の畑は平らな面）
  const boxes: Box[] = [];
  for (const plan of comp.buildings) {
    for (const part of plan.parts) {
      if (part.role === "field") {
        add("field", part.polygon, 0.35);
        continue;
      }
      if (part.role !== "structure") continue;
      const footprint = part.polygon.map((p) => toLocal(F, p));
      const ground = Math.min(...footprint.map(([a, b]) => heightAt(g, a, b)));
      boxes.push({ buildingId: plan.id, kind: plan.kind, footprint, ground, height: BUILDING_HEIGHT_M[plan.kind] * RELIEF_VERTICAL * 0.6 });
    }
  }

  // 樹木：針葉樹・広葉樹の所に、間隔を空けて（村域と開墾地・水辺は避ける）
  const trees: Tree[] = [];
  const n = t.surround.size;
  const cell = t.worldM / n;
  const keep = F.halfM + comp.clearing.reachM + 10;
  const hash = (i: number, j: number) => {
    let x = Math.imul(i * 374761393 + j * 668265263, 1274126177) ^ t.seed;
    x ^= x >>> 15;
    return (x >>> 0) / 4294967296;
  };
  for (let b = -RELIEF_HALF_M + TREE_STEP_M / 2; b < RELIEF_HALF_M; b += TREE_STEP_M) {
    for (let a = -RELIEF_HALF_M + TREE_STEP_M / 2; a < RELIEF_HALF_M; a += TREE_STEP_M) {
      const i = Math.round(a / TREE_STEP_M);
      const j = Math.round(b / TREE_STEP_M);
      const aa = a + (hash(i, j) - 0.5) * TREE_STEP_M * 0.7;
      const bb = b + (hash(j + 11, i + 5) - 0.5) * TREE_STEP_M * 0.7;
      if (Math.abs(aa) < keep && Math.abs(bb) < keep) continue;
      const [x, y] = toWorld(F, aa, bb);
      const k = Math.min(n - 1, Math.max(0, Math.floor(y / cell))) * n + Math.min(n - 1, Math.max(0, Math.floor(x / cell)));
      const v = t.vegetation[k];
      if (v !== VEGETATION_CLASS.conifer && v !== VEGETATION_CLASS.broadleaf) continue;
      trees.push({ at: [aa, bb, heightAt(g, aa, bb)], conifer: v === VEGETATION_CLASS.conifer });
    }
  }
  return { grid: g, flats, trees, boxes };
};

/** 樹木の大きさ（強調済み） */
export const TREE_SIZE = { height: TREE_HEIGHT_M * RELIEF_VERTICAL * 0.6, radius: TREE_RADIUS_M } as const;

/** 模型に出る情報の要約（地図との照合用）：建物ID と普請中の区画、道の本数 */
export const reliefInfo = (s: ReliefScene): { buildings: number[]; construction: number; roads: number } => ({
  buildings: [...new Set(s.boxes.map((b) => b.buildingId))].sort((p, q) => p - q),
  construction: s.flats.filter((f) => f.kind === "construction").length,
  roads: s.flats.filter((f) => f.kind === "road").length,
});
