import { smoothstep } from "./BaseTerrain";
import { pointSegmentDistance, polygonClearance, simplifyIndices, smoothPolyline, toLocal } from "./geometry";
import { filterComponents, type Grid } from "./grid";
import { maskToPolygons } from "./MarchingSquares";
import { range, type RandomFn } from "./rng";
import {
  HYDROLOGY,
  LAKE_MAX_COUNT,
  LAKE_MIN_AREA_M2,
  LAKE_MIN_DEPTH_M,
  RIVER_MIN_KM2,
  RIVER_WIDTH_BASE_M,
  RIVER_WIDTH_K,
  WORLD_M,
} from "./terrainConstants";
import type { Point, Polygon, River, VillageFrame } from "./types";

// 水文（SPEC_v3.4 §3.1 の 4、§3.3）。
// 1) 優先度付きの窪地埋め（16bit に量子化した標高のバケットキュー）。外周のセルが出口。
//    セルを最初に見つけた（＝先に取り出された低い）隣が流れの行き先（D8 の親）。窪地は水面まで埋まり、湖沼になる。
// 2) 取り出しの逆順に流量を累積する。
// 3) 集水域 1km² 以上を川とし（BB-14）、本流・支流の折れ線にする。水面の標高は下流へ単調に下がる。
// 4) 平坦部に蛇行を付け、旧河道（湿地）を1〜2か所置く。村域の近くでは蛇行を弱める。

export interface Routing {
  /** 窪地を埋めた水面（m） */
  readonly level: Float32Array;
  /** 流れの行き先のセル。外周（出口）は -2 */
  readonly parent: Int32Array;
  /** 集水域（セル数） */
  readonly acc: Float32Array;
}

export const OUTLET = -2;

export const route = (H: Float32Array, g: Grid): Routing => {
  const n = g.n;
  const total = n * n;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < total; i++) {
    const h = H[i]!;
    if (h < lo) lo = h;
    if (h > hi) hi = h;
  }
  const scale = 65535 / (hi - lo || 1);
  const hq = new Uint16Array(total);
  for (let i = 0; i < total; i++) hq[i] = Math.round((H[i]! - lo) * scale);
  const levelQ = new Uint16Array(total);
  const parent = new Int32Array(total).fill(-1);
  const closed = new Uint8Array(total);
  const head = new Int32Array(65536).fill(-1);
  const next = new Int32Array(total);
  const seed = (i: number) => {
    if (closed[i]) return;
    closed[i] = 1;
    levelQ[i] = hq[i]!;
    parent[i] = OUTLET;
    next[i] = head[hq[i]!]!;
    head[hq[i]!] = i;
  };
  for (let k = 0; k < n; k++) {
    seed(k);
    seed((n - 1) * n + k);
    seed(k * n);
    seed(k * n + n - 1);
  }
  const order = new Int32Array(total);
  let count = 0;
  let cur = 0;
  while (count < total) {
    while (head[cur]! < 0) cur++;
    const i = head[cur]!;
    head[cur] = next[i]!;
    order[count++] = i;
    const x = i % n;
    const y = (i - x) / n;
    for (let dy = -1; dy <= 1; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= n) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx;
        if ((dx === 0 && dy === 0) || xx < 0 || xx >= n) continue;
        const j = yy * n + xx;
        if (closed[j]) continue;
        closed[j] = 1;
        parent[j] = i;
        const l = hq[j]! > cur ? hq[j]! : cur;
        levelQ[j] = l;
        next[j] = head[l]!;
        head[l] = j;
      }
    }
  }
  const acc = new Float32Array(total).fill(1);
  for (let k = total - 1; k >= 0; k--) {
    const i = order[k]!;
    const p = parent[i]!;
    if (p >= 0) acc[p] = acc[p]! + acc[i]!;
  }
  const level = new Float32Array(total);
  for (let i = 0; i < total; i++) level[i] = lo + levelQ[i]! / scale;
  return { level, parent, acc };
};

export const riverWidth = (areaKm2: number): number => RIVER_WIDTH_K * Math.sqrt(areaKm2) + RIVER_WIDTH_BASE_M;
const areaKm2Of = (acc: number, g: Grid): number => (acc * g.cell * g.cell) / 1e6;
const riverCells = (g: Grid): number => (RIVER_MIN_KM2 * 1e6) / (g.cell * g.cell);

/** 窪地（湖沼）のマスク：埋めた深さが下限以上で、面積が下限以上 */
export const lakeMask = (H: Float32Array, r: Routing, g: Grid): Uint8Array => {
  const raw = new Uint8Array(g.n * g.n);
  for (let i = 0; i < raw.length; i++) if (r.level[i]! - H[i]! >= LAKE_MIN_DEPTH_M) raw[i] = 1;
  return filterComponents(raw, g, LAKE_MIN_AREA_M2, LAKE_MAX_COUNT);
};

/** 村域（＋余白）の内側に川・湖のセルがあるか（重い本生成の前の下見と、本生成の検査） */
export const waterCellsInVillage = (
  H: Float32Array,
  r: Routing,
  g: Grid,
  F: VillageFrame,
  marginM: number,
): "river" | "lake" | null => {
  const reach = F.halfM + marginM + riverWidth(areaKm2Of(g.n * g.n, g));
  const minCells = riverCells(g);
  const i0 = Math.max(0, Math.floor((F.center[0] - reach * Math.SQRT2) / g.cell));
  const i1 = Math.min(g.n - 1, Math.ceil((F.center[0] + reach * Math.SQRT2) / g.cell));
  const j0 = Math.max(0, Math.floor((F.center[1] - reach * Math.SQRT2) / g.cell));
  const j1 = Math.min(g.n - 1, Math.ceil((F.center[1] + reach * Math.SQRT2) / g.cell));
  let found: "river" | "lake" | null = null;
  for (let j = j0; j <= j1 && found !== "river"; j++) {
    for (let i = i0; i <= i1; i++) {
      const k = j * g.n + i;
      const [a, b] = toLocal(F, [(i + 0.5) * g.cell, (j + 0.5) * g.cell]);
      const out = Math.max(Math.abs(a), Math.abs(b)) - F.halfM;
      if (r.acc[k]! >= minCells && out < marginM + riverWidth(areaKm2Of(r.acc[k]!, g)) / 2) {
        found = "river";
        break;
      }
      if (out < marginM && r.level[k]! - H[k]! >= LAKE_MIN_DEPTH_M) found = "lake";
    }
  }
  return found;
};

export interface RiverDraft {
  readonly points: Point[];
  readonly widths: number[];
  readonly levels: number[];
  readonly main: boolean;
  readonly areaKm2: number;
  /** 下流端が他の川への合流点か（false なら地図の縁で終わる） */
  readonly joins: boolean;
}

const borderPoint = (p: Point): Point => {
  const d = [p[0], WORLD_M - p[0], p[1], WORLD_M - p[1]];
  const k = d.indexOf(Math.min(...d));
  return k === 0 ? [0, p[1]] : k === 1 ? [WORLD_M, p[1]] : k === 2 ? [p[0], 0] : [p[0], WORLD_M];
};

/** 川の折れ線を取り出す（本流が先頭、以降は集水域の大きい順） */
export const extractRivers = (r: Routing, g: Grid): RiverDraft[] => {
  const n = g.n;
  const total = n * n;
  const minCells = riverCells(g);
  const mainChild = new Int32Array(total).fill(-1);
  const riverChildren = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    if (r.acc[i]! < minCells) continue;
    const p = r.parent[i]!;
    if (p < 0) continue;
    riverChildren[p] = Math.min(255, riverChildren[p]! + 1);
    const m = mainChild[p]!;
    if (m < 0 || r.acc[i]! > r.acc[m]!) mainChild[p] = i;
  }
  const drafts: { cells: number[]; joins: boolean }[] = [];
  for (let head = 0; head < total; head++) {
    if (r.acc[head]! < minCells || riverChildren[head]) continue;
    const cells = [head];
    let cur = head;
    let joins = false;
    for (;;) {
      const p = r.parent[cur]!;
      if (p < 0) break;
      cells.push(p);
      if (mainChild[p] !== cur) {
        joins = true;
        break;
      }
      cur = p;
    }
    drafts.push({ cells, joins });
  }
  const tol = HYDROLOGY.simplifyCells * g.cell;
  const rivers = drafts.map(({ cells, joins }) => {
    const points: Point[] = cells.map((c) => [((c % n) + 0.5) * g.cell, (Math.floor(c / n) + 0.5) * g.cell]);
    const lastCell = joins ? cells[cells.length - 2]! : cells[cells.length - 1]!;
    const widths = cells.map((c) => riverWidth(areaKm2Of(r.acc[c]!, g)));
    const levels = cells.map((c) => r.level[c]!);
    if (!joins) {
      points.push(borderPoint(points[points.length - 1]!));
      widths.push(widths[widths.length - 1]!);
      levels.push(levels[levels.length - 1]!);
    }
    const smoothed = smoothPolyline(points, 3);
    const keep = simplifyIndices(smoothed, tol);
    return {
      points: keep.map((k) => smoothed[k]!),
      widths: keep.map((k) => widths[k]!),
      levels: keep.map((k) => levels[k]!),
      main: false,
      areaKm2: areaKm2Of(r.acc[lastCell]!, g),
      joins,
    };
  });
  rivers.sort((a, b) => Number(a.joins) - Number(b.joins) || b.areaKm2 - a.areaKm2);
  return rivers.map((d, k) => ({ ...d, main: k === 0 && !d.joins }));
};

const resample = (d: RiverDraft, step: number): { points: Point[]; widths: number[]; levels: number[]; s: number[] } => {
  const points: Point[] = [];
  const widths: number[] = [];
  const levels: number[] = [];
  const s: number[] = [];
  let acc = 0;
  for (let k = 0; k + 1 < d.points.length; k++) {
    const a = d.points[k]!;
    const b = d.points[k + 1]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const parts = Math.max(1, Math.ceil(len / step));
    for (let t = 0; t < parts; t++) {
      const u = t / parts;
      points.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]);
      widths.push(d.widths[k]! + (d.widths[k + 1]! - d.widths[k]!) * u);
      levels.push(d.levels[k]! + (d.levels[k + 1]! - d.levels[k]!) * u);
      s.push(acc + len * u);
    }
    acc += len;
  }
  points.push(d.points[d.points.length - 1]!);
  widths.push(d.widths[d.widths.length - 1]!);
  levels.push(d.levels[d.levels.length - 1]!);
  s.push(acc);
  return { points, widths, levels, s };
};

const rectDistanceLocal = (F: VillageFrame, p: Point): number => {
  const [a, b] = toLocal(F, p);
  return Math.hypot(Math.max(Math.abs(a) - F.halfM, 0), Math.max(Math.abs(b) - F.halfM, 0));
};

/** 平坦部に蛇行を付ける（村域の近く・両端では弱める）。合流点は合流先の川に吸着させる */
export const meanderRivers = (drafts: readonly RiverDraft[], F: VillageFrame, random: RandomFn): RiverDraft[] => {
  const out: RiverDraft[] = [];
  for (const d of drafts) {
    const step = HYDROLOGY.meanderResampleM;
    const { points, widths, levels, s } = resample(d, step);
    const total = s[s.length - 1]!;
    const phase = range(random, 0, Math.PI * 2);
    const meanWidth = widths.reduce((x, y) => x + y, 0) / widths.length;
    const wave = Math.max(120, HYDROLOGY.meanderWavePerWidth * meanWidth);
    const moved: Point[] = points.map((p, k) => {
      const prev = points[Math.max(0, k - 1)]!;
      const next = points[Math.min(points.length - 1, k + 1)]!;
      const tx = next[0] - prev[0];
      const ty = next[1] - prev[1];
      const tl = Math.hypot(tx, ty) || 1;
      const w = 4;
      const lUp = levels[Math.max(0, k - w)]!;
      const lDown = levels[Math.min(levels.length - 1, k + w)]!;
      const span = Math.max(step, s[Math.min(s.length - 1, k + w)]! - s[Math.max(0, k - w)]!);
      const grad = (lUp - lDown) / span;
      const flat = Math.max(0, 1 - grad / HYDROLOGY.meanderFlatGradient);
      const ends = smoothstep(0, wave / 2, s[k]!) * smoothstep(0, wave / 2, total - s[k]!);
      const keep = HYDROLOGY.meanderVillageKeepM;
      const near = smoothstep(keep, keep * 3, rectDistanceLocal(F, p) - widths[k]! / 2);
      const amp = Math.min(HYDROLOGY.meanderAmpPerWidth * widths[k]!, HYDROLOGY.meanderAmpMaxM) * flat * ends * near;
      const off = amp * Math.sin((Math.PI * 2 * s[k]!) / wave + phase);
      return [p[0] - (ty / tl) * off, p[1] + (tx / tl) * off];
    });
    if (d.joins && out.length > 0) {
      // 合流点を、すでに置いた川の最寄りの点に吸着させる
      const end = moved[moved.length - 1]!;
      let best: Point = end;
      let bestD = Infinity;
      for (const r of out) {
        for (const q of r.points) {
          const dd = Math.hypot(q[0] - end[0], q[1] - end[1]);
          if (dd < bestD) {
            bestD = dd;
            best = q;
          }
        }
      }
      moved[moved.length - 1] = best;
    }
    const keep = simplifyIndices(moved, 1);
    out.push({
      points: keep.map((k) => moved[k]!),
      widths: keep.map((k) => widths[k]!),
      levels: keep.map((k) => levels[k]!),
      main: d.main,
      areaKm2: d.areaKm2,
      joins: d.joins,
    });
  }
  return out;
};

/** 旧河道（三日月形の湿地）を本流沿いに1〜2か所置く。置けた多角形を返す */
export const placeOldChannels = (main: RiverDraft, F: VillageFrame, random: RandomFn): Polygon[] => {
  const { points, widths, s } = resample(main, 50);
  const total = s[s.length - 1]!;
  const want = random() < 0.5 ? HYDROLOGY.oldChannelCount[0] : HYDROLOGY.oldChannelCount[1];
  const offset = Math.floor(random() * points.length);
  const result: Polygon[] = [];
  const used: Point[] = [];
  for (let t = 0; t < points.length && result.length < want; t++) {
    const k = (offset + t) % points.length;
    const p = points[k]!;
    if (s[k]! < 300 || total - s[k]! < 300) continue;
    if (used.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 500)) continue;
    const width = widths[k]!;
    const radius = Math.max(HYDROLOGY.oldChannelMinRadiusM, range(random, ...HYDROLOGY.oldChannelRadiusPerWidth) * width);
    const prev = points[Math.max(0, k - 1)]!;
    const next = points[Math.min(points.length - 1, k + 1)]!;
    const tx = next[0] - prev[0];
    const ty = next[1] - prev[1];
    const tl = Math.hypot(tx, ty) || 1;
    const side = random() < 0.5 ? -1 : 1;
    const nx = (-ty / tl) * side;
    const ny = (tx / tl) * side;
    const dist = radius + 0.6 * width + 15;
    const c: Point = [p[0] + nx * dist, p[1] + ny * dist];
    const edge = HYDROLOGY.oldChannelEdgeKeepM + radius + 20;
    if (c[0] < edge || c[1] < edge || c[0] > WORLD_M - edge || c[1] > WORLD_M - edge) continue;
    const thick = Math.max(10, 0.7 * width);
    const base = Math.atan2(ny, nx);
    const arc = (rr: number, from: number, to: number): Point[] => {
      const pts: Point[] = [];
      for (let q = 0; q <= 16; q++) {
        const ang = base + from + ((to - from) * q) / 16;
        pts.push([c[0] + rr * Math.cos(ang), c[1] + rr * Math.sin(ang)]);
      }
      return pts;
    };
    const spread = (110 * Math.PI) / 180;
    const poly: Polygon = [...arc(radius + thick / 2, -spread, spread), ...arc(radius - thick / 2, spread, -spread)];
    if (polygonClearance(F, poly) < HYDROLOGY.oldChannelVillageKeepM) continue;
    const tooClose = poly.some((q) => {
      for (let m = 0; m + 1 < main.points.length; m++) {
        if (pointSegmentDistance(q, main.points[m]!, main.points[m + 1]!) < main.widths[m]! / 2 + 5) return true;
      }
      return false;
    });
    if (tooClose) continue;
    result.push(poly);
    used.push(p);
  }
  return result;
};

/** 川の折れ線（幅つき）をマスクに塗る */
export const rasterizeRivers = (rivers: readonly { points: readonly Point[]; widths: readonly number[] }[], g: Grid): Uint8Array => {
  const mask = new Uint8Array(g.n * g.n);
  for (const r of rivers) {
    for (let k = 0; k + 1 < r.points.length; k++) {
      const a = r.points[k]!;
      const b = r.points[k + 1]!;
      const rad = Math.max(r.widths[k]!, r.widths[k + 1]!) / 2;
      const i0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - rad) / g.cell));
      const i1 = Math.min(g.n - 1, Math.ceil((Math.max(a[0], b[0]) + rad) / g.cell));
      const j0 = Math.max(0, Math.floor((Math.min(a[1], b[1]) - rad) / g.cell));
      const j1 = Math.min(g.n - 1, Math.ceil((Math.max(a[1], b[1]) + rad) / g.cell));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          if (pointSegmentDistance([(i + 0.5) * g.cell, (j + 0.5) * g.cell], a, b) <= Math.max(rad, g.cell * 0.5)) mask[j * g.n + i] = 1;
        }
      }
    }
  }
  return mask;
};

export const lakePolygons = (mask: Uint8Array, g: Grid): Polygon[] => maskToPolygons(mask, g);

export const toRivers = (drafts: readonly RiverDraft[], names: readonly string[]): River[] =>
  drafts.map((d, k) => ({
    points: d.points,
    widths: d.widths,
    levels: d.levels,
    name: names[k] ?? "",
    main: d.main,
    areaKm2: d.areaKm2,
  }));

