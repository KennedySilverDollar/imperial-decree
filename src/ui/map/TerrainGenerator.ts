import { createNoise2D, type NoiseFunction2D } from "simplex-noise";
import { landscapePlan, SIDES, sideOf, type LandscapePlan, type Side } from "../../domain/Landscape";
import { deriveSeed } from "../../domain/Prng";
import {
  boundsOf,
  chaikin,
  clamp01,
  distanceToSegment,
  fromEastFrame,
  lerp,
  pointInPolygon,
  randomStream,
  smoothstep,
  toEastFrame,
  type Point,
} from "./geometry2d";
import * as MapConstants from "./mapConstants";
import { mapParcels, type Parcel } from "./ParcelMapper";

// 定数はモジュールの読み込み時に一度だけ取り出す（地形の内側のループで何十万回も読むため）
const {
  BASIN_FALLOFF,
  BASIN_MARGIN,
  EDGE_MARGIN,
  FERTILITY_WATER_REACH,
  FOREST_FREQUENCY,
  FOREST_PEAK,
  FOREST_RISE,
  FOREST_RIVER_GAP,
  FOREST_SIDE_BIAS,
  FOREST_THRESHOLD,
  FOREST_VILLAGE_GAP,
  HEIGHTMAP_SIZE,
  HILL_RISE,
  LAKE_GAP,
  LAKE_RADIUS_MAX,
  LAKE_RADIUS_MIN,
  LAKE_SHORE,
  LAKE_WOBBLE,
  LOWLAND_SINK,
  MAP_PX,
  PLAIN_LEVEL,
  PLAIN_UNDULATION,
  RIVER_GAP,
  RIVER_GRID,
  RIVER_LEVEL_HIGH,
  RIVER_LEVEL_LOW,
  RIVER_TILT,
  RIVER_VALLEY,
  RIVER_WIDTH,
  SIDE_REACH,
  SLOPE_MAX,
  TERRAIN_FREQUENCY,
  TERRAIN_MAX_ATTEMPTS,
  TERRAIN_OCTAVES,
  VILLAGE_ORIGIN,
  VILLAGE_SIZE,
  WARP_OCTAVES,
  WARP_STRENGTH,
} = MapConstants;

// 地形生成（SPEC_v3.3 §5.2）。純粋な計算だけで、DOM・Canvas に触れない（Worker でも Node のテストでも動く）。
// seed = hash(saveId, "terrain")。土地の筋書き（domain/Landscape：四辺の川・丘・森・沼／野）どおりに地形を作る。
//   1. 標高：fBm（simplex noise 6 オクターブ）＋ドメインワーピング
//   2. 四辺の地形で盛る・下げる（丘・森・野／沼・川の傾き）
//   3. 川：筋書きの辺に沿って、高い縁から低い縁へ、粗い格子の最小費用経路で1本。村域とその周り（RIVER_GAP）には入れない
//   4. 沼（0〜1）：筋書きの辺の外側の帯に置き、窪地に刻む
//   5. 盆地化：村域と周りを平らな平地にし、外へなだらかに戻す（村域の 100 区画をすべて建設可能に）
//   6. 森マスク・地味（肥沃度）
// 最後に 100 区画が建設可能（水も急傾斜も含まない）かを確かめ、だめなら seed を派生させて作り直す（上限 TERRAIN_MAX_ATTEMPTS）。
// それでもだめなら、川と沼を外縁に寄せた安全な地形にする。どの段も seed だけで決まるので、同じ saveId なら同じ結果。

export interface TerrainData {
  readonly seed: number;
  readonly plan: LandscapePlan;
  /** 何回目の試行で建設可能になったか（安全な地形に落ちたら TERRAIN_MAX_ATTEMPTS + 1） */
  readonly attempts: number;
  /** 標高（0..1）。HEIGHTMAP_SIZE 四方、行優先 */
  readonly heightmap: Float32Array;
  /** 0：陸、1：川、2：沼 */
  readonly water: Uint8Array;
  /** 川の中心線（上流→下流、地図の画素） */
  readonly river: readonly Point[];
  readonly lakes: readonly (readonly Point[])[];
  /** 森の濃さ 0..255 */
  readonly forestMask: Uint8Array;
  /** 地味 0..255（描画では畑の濃さにだけ使う） */
  readonly fertility: Uint8Array;
  readonly parcels: readonly Parcel[];
  /** 地名を書く場所（地形の目印） */
  readonly anchors: TerrainAnchors;
}

export interface TerrainAnchors {
  readonly river: Point;
  readonly hill: Point;
  readonly forest: Point;
  readonly lake: Point | null;
  readonly plain: Point | null;
}

const H = HEIGHTMAP_SIZE;
const CELL = MAP_PX / H;
const V0 = VILLAGE_ORIGIN;
const V1 = VILLAGE_ORIGIN + VILLAGE_SIZE;

/** 標高の格子の (i, j) の中心の、地図の画素での位置 */
export const cellCenter = (i: number, j: number): Point => ({ x: (i + 0.5) * CELL, y: (j + 0.5) * CELL });

/** 村域の正方形からの距離（内側は 0） */
export const distanceToVillage = (p: Point): number => {
  const dx = Math.max(V0 - p.x, 0, p.x - V1);
  const dy = Math.max(V0 - p.y, 0, p.y - V1);
  return Math.hypot(dx, dy);
};

/** ある辺の外側へ、村域の縁からどれだけ出ているか（その辺の帯の中だけ正）。村域は地図の中央にあるので回さずに求まる */
const outwardXY = (side: Side, x: number, y: number): number => {
  switch (side) {
    case "east":
      return x > V1 ? x - V1 : 0;
    case "west":
      return x < V0 ? V0 - x : 0;
    case "north":
      return y < V0 ? V0 - y : 0;
    case "south":
      return y > V1 ? y - V1 : 0;
  }
};

/** 「東の辺」の座標での縦の位置（toEastFrame(side, p).y と同じ） */
const alongXY = (side: Side, x: number, y: number): number =>
  side === "east" ? y : side === "north" ? x : side === "west" ? MAP_PX - y : MAP_PX - x;

/** 0..1 のなめらかな段差（smoothstep の内側版。ループの中で使う） */
const ease = (edge0: number, edge1: number, v: number): number => {
  const t = v <= edge0 ? 0 : v >= edge1 ? 1 : (v - edge0) / (edge1 - edge0);
  return t * t * (3 - 2 * t);
};

const fbm = (noise: NoiseFunction2D, x: number, y: number, octaves: number): number => {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(x * freq, y * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
};

interface Options {
  /** 安全な地形（川・沼を外縁に寄せる）。再試行が尽きたときだけ */
  readonly safe: boolean;
}

const buildOnce = (seed: number, plan: LandscapePlan, parcels: readonly Parcel[], options: Options): TerrainData => {
  const nHeight = createNoise2D(randomStream(seed, 1));
  const nWarpX = createNoise2D(randomStream(seed, 2));
  const nWarpY = createNoise2D(randomStream(seed, 3));
  const nDetail = createNoise2D(randomStream(seed, 4));
  const random = randomStream(seed, 5);

  // 1) 標高：fBm＋ドメインワーピング → 0..1 に正規化
  const heightmap = new Float32Array(H * H);
  let min = Infinity;
  let max = -Infinity;
  for (let j = 0; j < H; j++)
    for (let i = 0; i < H; i++) {
      const u = ((i + 0.5) / H) * TERRAIN_FREQUENCY;
      const v = ((j + 0.5) / H) * TERRAIN_FREQUENCY;
      const wx = fbm(nWarpX, u + 3.1, v + 1.7, WARP_OCTAVES);
      const wy = fbm(nWarpY, u - 2.3, v + 5.2, WARP_OCTAVES);
      const h = fbm(nHeight, u + WARP_STRENGTH * wx, v + WARP_STRENGTH * wy, TERRAIN_OCTAVES);
      heightmap[j * H + i] = h;
      if (h < min) min = h;
      if (h > max) max = h;
    }
  const span = max - min || 1;
  for (let k = 0; k < heightmap.length; k++) heightmap[k] = ((heightmap[k] as number) - min) / span;

  // 2) 四辺の地形で盛る・下げる
  const riverSide = sideOf(plan, "river") ?? "east";
  const sideFeatures = SIDES.map((side) => [side, plan.sides[side]] as const);
  for (let j = 0; j < H; j++)
    for (let i = 0; i < H; i++) {
      const x = (i + 0.5) * CELL;
      const y = (j + 0.5) * CELL;
      let h = heightmap[j * H + i] as number;
      for (const [side, feature] of sideFeatures) {
        const out = outwardXY(side, x, y);
        if (out === 0) continue;
        const reach = ease(0, SIDE_REACH, out);
        if (feature === "hill") h += HILL_RISE * reach * (0.75 + 0.25 * nDetail(x / 300, y / 300));
        else if (feature === "forest") h += FOREST_RISE * reach;
        else if (feature === "plain" || feature === "lake") h -= LOWLAND_SINK * reach;
      }
      // 川の辺は、筋書きの向きに沿って上流が高くなるように傾ける
      const along = alongXY(riverSide, x, y) / MAP_PX;
      h += RIVER_TILT * (plan.riverClockwise ? 1 - along : along) * ease(0, SIDE_REACH, outwardXY(riverSide, x, y) + VILLAGE_SIZE / 4);
      heightmap[j * H + i] = h;
    }

  // 3) 川
  const river = traceRiver(heightmap, riverSide, plan.riverClockwise, random, options);
  const water = new Uint8Array(H * H);
  // 距離の場は、川を 20px ごとに取り直した折れ線で求める（描く線は滑らかなまま）
  const coarse = resample(river, RIVER_SAMPLE);
  const riverDistance = distanceField(coarse, FERTILITY_WATER_REACH * 2);
  const levels = riverLevels(coarse);
  for (let k = 0; k < H * H; k++) {
    const d = riverDistance.distance[k] as number;
    if (d <= RIVER_WIDTH / 2) water[k] = 1;
    if (d < RIVER_VALLEY) {
      // 水面は上流から下流へ一様に下がる。谷はその水面へ向けてならす（窪地は埋め、高みは削る）
      const level = levels(riverDistance.nearest[k] as number);
      const t = ease(RIVER_WIDTH / 2, RIVER_VALLEY, d);
      const h = heightmap[k] as number;
      heightmap[k] = level + (h - level) * t;
    }
  }

  // 4) 沼
  const lakeSide = sideOf(plan, "lake");
  const lakes: Point[][] = [];
  if (lakeSide !== null) {
    const lake = placeLake(lakeSide, random, nDetail, options);
    lakes.push(lake);
    const b = boundsOf(lake);
    let level = Infinity;
    const inside: number[] = [];
    for (let j = Math.max(0, Math.floor((b.minY - LAKE_SHORE) / CELL)); j < Math.min(H, Math.ceil((b.maxY + LAKE_SHORE) / CELL)); j++)
      for (let i = Math.max(0, Math.floor((b.minX - LAKE_SHORE) / CELL)); i < Math.min(H, Math.ceil((b.maxX + LAKE_SHORE) / CELL)); i++) {
        const k = j * H + i;
        if (pointInPolygon(cellCenter(i, j), lake)) {
          inside.push(k);
          level = Math.min(level, heightmap[k] as number);
        }
      }
    level = Math.min(level, RIVER_LEVEL_LOW + 0.02);
    for (let j = Math.max(0, Math.floor((b.minY - LAKE_SHORE) / CELL)); j < Math.min(H, Math.ceil((b.maxY + LAKE_SHORE) / CELL)); j++)
      for (let i = Math.max(0, Math.floor((b.minX - LAKE_SHORE) / CELL)); i < Math.min(H, Math.ceil((b.maxX + LAKE_SHORE) / CELL)); i++) {
        const k = j * H + i;
        const p = cellCenter(i, j);
        if (pointInPolygon(p, lake)) {
          water[k] = 2;
          heightmap[k] = level;
          continue;
        }
        let d = Infinity;
        for (let s = 0; s < lake.length; s++) d = Math.min(d, distanceToSegment(p, lake[s] as Point, lake[(s + 1) % lake.length] as Point));
        if (d < LAKE_SHORE) heightmap[k] = Math.min(heightmap[k] as number, lerp(level, heightmap[k] as number, smoothstep(0, LAKE_SHORE, d)));
      }
  }

  // 5) 盆地化：村域と周りは平地（わずかな起伏だけ）。外へなだらかに元の地形へ
  for (let j = 0; j < H; j++)
    for (let i = 0; i < H; i++) {
      const x = (i + 0.5) * CELL;
      const y = (j + 0.5) * CELL;
      const dx = x < V0 ? V0 - x : x > V1 ? x - V1 : 0;
      const dy = y < V0 ? V0 - y : y > V1 ? y - V1 : 0;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d >= BASIN_MARGIN + BASIN_FALLOFF * 1.45) continue;
      // 盆地の縁は揺らす（まっすぐな四角い台地にしない）。村域から BASIN_MARGIN までは必ず平ら
      const rim = BASIN_FALLOFF * (0.55 + 0.9 * (0.5 + 0.5 * nDetail(x / 380 - 3.3, y / 380 + 7.9)));
      const flat = 1 - ease(BASIN_MARGIN, BASIN_MARGIN + rim, d);
      const k = j * H + i;
      const plain = PLAIN_LEVEL + PLAIN_UNDULATION * nDetail(x / 520 + 9.1, y / 520 - 4.7);
      const h = heightmap[k] as number;
      heightmap[k] = h + (plain - h) * flat;
    }
  for (let k = 0; k < heightmap.length; k++) heightmap[k] = clamp01(heightmap[k] as number);

  // 6) 森・地味
  const forestMask = new Uint8Array(H * H);
  const fertility = new Uint8Array(H * H);
  const forestSide = sideOf(plan, "forest") ?? "west";
  const nForest = createNoise2D(randomStream(seed, 6));
  for (let j = 0; j < H; j++)
    for (let i = 0; i < H; i++) {
      const k = j * H + i;
      const x = (i + 0.5) * CELL;
      const y = (j + 0.5) * CELL;
      const h = heightmap[k] as number;
      const riverD = riverDistance.distance[k] as number;
      const nearWater = Math.exp(-riverD / FERTILITY_WATER_REACH);
      fertility[k] = Math.round(255 * clamp01(0.55 * (1 - h) + 0.45 * nearWater));
      const dx = x < V0 ? V0 - x : x > V1 ? x - V1 : 0;
      const dy = y < V0 ? V0 - y : y > V1 ? y - V1 : 0;
      if (water[k] !== 0 || dx * dx + dy * dy < FOREST_VILLAGE_GAP * FOREST_VILLAGE_GAP || riverD < FOREST_RIVER_GAP || h > FOREST_PEAK) continue;
      const base = 0.5 + 0.5 * fbm(nForest, ((i + 0.5) / H) * FOREST_FREQUENCY, ((j + 0.5) / H) * FOREST_FREQUENCY, 3);
      const bias = FOREST_SIDE_BIAS * ease(0, SIDE_REACH * 0.7, outwardXY(forestSide, x, y)) + (h > 0.4 && h < 0.75 ? 0.06 : -0.06);
      const f = base + bias - FOREST_THRESHOLD;
      if (f > 0) forestMask[k] = Math.round(255 * clamp01(f * 4));
    }

  return {
    seed,
    plan,
    attempts: 1,
    heightmap,
    water,
    river,
    lakes,
    forestMask,
    fertility,
    parcels,
    anchors: findAnchors(plan, heightmap, forestMask, river, lakes),
  };
};

/** 川：「東の辺」の座標で、北の縁から南の縁へ最小費用経路を引き、筋書きの辺へ回す */
const traceRiver = (heightmap: Float32Array, side: Side, clockwise: boolean, random: () => number, options: Options): Point[] => {
  const G = RIVER_GRID;
  const step = MAP_PX / G;
  const minX = V1 + RIVER_GAP + RIVER_WIDTH;
  const maxX = MAP_PX - EDGE_MARGIN;
  const bandWidth = maxX - minX;
  const target = options.safe ? maxX - bandWidth * 0.1 : minX + bandWidth * (0.15 + 0.35 * random());
  const meander = options.safe ? 0 : bandWidth * (0.08 + 0.12 * random());
  const phase = random() * Math.PI * 2;
  const heightAt = (p: Point) => {
    const w = fromEastFrame(side, p);
    const i = Math.min(H - 1, Math.max(0, Math.floor(w.x / CELL)));
    const j = Math.min(H - 1, Math.max(0, Math.floor(w.y / CELL)));
    return heightmap[j * H + i] as number;
  };
  const center = (gx: number, gy: number): Point => ({ x: (gx + 0.5) * step, y: (gy + 0.5) * step });
  const cost = new Float64Array(G * G).fill(Infinity);
  for (let gy = 0; gy < G; gy++)
    for (let gx = 0; gx < G; gx++) {
      const p = center(gx, gy);
      if (p.x < minX || p.x > maxX) continue;
      const line = target + meander * Math.sin((p.y / MAP_PX) * Math.PI * 2.2 + phase);
      const off = (p.x - line) / bandWidth;
      cost[gy * G + gx] = 1 + 6 * heightAt(p) + 14 * off * off;
    }
  const startX = Math.round((target + meander * Math.sin(phase)) / step);
  const endX = Math.round((target + meander * Math.sin(Math.PI * 2.2 + phase)) / step);
  const start = 0 * G + Math.min(Math.max(startX, Math.ceil(minX / step)), Math.floor(maxX / step) - 1);
  const end = (G - 1) * G + Math.min(Math.max(endX, Math.ceil(minX / step)), Math.floor(maxX / step) - 1);
  const dist = new Float64Array(G * G).fill(Infinity);
  const prev = new Int32Array(G * G).fill(-1);
  dist[start] = 0;
  // Dijkstra（格子は 120×120 と小さいので、単純な配列の優先度付きキューで十分）
  const heap: number[] = [start];
  const better = (a: number, b: number) => (dist[a] as number) < (dist[b] as number);
  const pushHeap = (v: number) => {
    heap.push(v);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!better(heap[i] as number, heap[p] as number)) break;
      [heap[i], heap[p]] = [heap[p] as number, heap[i] as number];
      i = p;
    }
  };
  const popHeap = (): number => {
    const top = heap[0] as number;
    const last = heap.pop() as number;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && better(heap[l] as number, heap[m] as number)) m = l;
        if (r < heap.length && better(heap[r] as number, heap[m] as number)) m = r;
        if (m === i) break;
        [heap[i], heap[m]] = [heap[m] as number, heap[i] as number];
        i = m;
      }
    }
    return top;
  };
  const done = new Uint8Array(G * G);
  while (heap.length > 0) {
    const at = popHeap();
    if (done[at]) continue;
    done[at] = 1;
    if (at === end) break;
    const ax = at % G;
    const ay = Math.floor(at / G);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = ax + dx;
        const ny = ay + dy;
        if (nx < 0 || ny < 0 || nx >= G || ny >= G) continue;
        const n = ny * G + nx;
        const c = cost[n] as number;
        if (!Number.isFinite(c) || done[n]) continue;
        const d = (dist[at] as number) + c * (dx !== 0 && dy !== 0 ? Math.SQRT2 : 1);
        if (d < (dist[n] as number)) {
          dist[n] = d;
          prev[n] = at;
          pushHeap(n);
        }
      }
  }
  const cells: number[] = [];
  for (let at = end; at !== -1; at = prev[at] as number) cells.push(at);
  cells.reverse();
  // 地図の縁から縁まで届くよう、両端を縁に伸ばす
  const local = cells.map((c) => center(c % G, Math.floor(c / G)));
  const first = local[0] as Point;
  const last = local[local.length - 1] as Point;
  const line = chaikin([{ x: first.x, y: 0 }, ...local, { x: last.x, y: MAP_PX }], 3);
  const world = line.map((p) => fromEastFrame(side, p));
  // 高い縁から低い縁へ（筋書きの向き）：東の座標で北が上流なら clockwise
  return clockwise ? world : world.reverse();
};

const RIVER_SAMPLE = 20;

/** 折れ線を、ほぼ一定の間隔の点で取り直す（端点は保つ） */
const resample = (line: readonly Point[], spacing: number): Point[] => {
  const out: Point[] = [line[0] as Point];
  let carried = 0;
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i] as Point;
    const b = line[i + 1] as Point;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    let t = spacing - carried;
    while (t < len) {
      out.push({ x: lerp(a.x, b.x, t / len), y: lerp(a.y, b.y, t / len) });
      t += spacing;
    }
    carried = len - (t - spacing);
  }
  out.push(line[line.length - 1] as Point);
  return out;
};

/** 川の上流→下流で水面の高さを下げる（中心線の点の番号から） */
const riverLevels = (river: readonly Point[]) => (index: number) => lerp(RIVER_LEVEL_HIGH, RIVER_LEVEL_LOW, index / Math.max(1, river.length - 1));

/** 折れ線までの距離と、最も近い点の番号（reach より遠い所は reach のまま） */
const distanceField = (line: readonly Point[], reach: number) => {
  const distance = new Float32Array(H * H).fill(reach);
  const nearest = new Int32Array(H * H).fill(0);
  for (let s = 0; s + 1 < line.length; s++) {
    const a = line[s] as Point;
    const b = line[s + 1] as Point;
    const i0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - reach) / CELL));
    const i1 = Math.min(H - 1, Math.ceil((Math.max(a.x, b.x) + reach) / CELL));
    const j0 = Math.max(0, Math.floor((Math.min(a.y, b.y) - reach) / CELL));
    const j1 = Math.min(H - 1, Math.ceil((Math.max(a.y, b.y) + reach) / CELL));
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len2 = ex * ex + ey * ey || 1;
    for (let j = j0; j <= j1; j++) {
      const py = (j + 0.5) * CELL;
      for (let i = i0; i <= i1; i++) {
        const px = (i + 0.5) * CELL;
        let t = ((px - a.x) * ex + (py - a.y) * ey) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = px - (a.x + t * ex);
        const qy = py - (a.y + t * ey);
        const d = Math.sqrt(qx * qx + qy * qy);
        const k = j * H + i;
        if (d < (distance[k] as number)) {
          distance[k] = d;
          nearest[k] = s;
        }
      }
    }
  }
  return { distance, nearest };
};

/** 沼：筋書きの辺の外側の帯の中ほど。岸を揺らした多角形 */
const placeLake = (side: Side, random: () => number, noise: NoiseFunction2D, options: Options): Point[] => {
  const radius = options.safe ? LAKE_RADIUS_MIN : lerp(LAKE_RADIUS_MIN, LAKE_RADIUS_MAX, random());
  const reach = radius * (1 + LAKE_WOBBLE);
  const nearX = V1 + LAKE_GAP + reach;
  const farX = MAP_PX - EDGE_MARGIN - reach;
  const x = options.safe ? farX : lerp(nearX, Math.max(nearX, farX), random());
  const y = MAP_PX * lerp(0.38, 0.62, random());
  const phase = random() * 100;
  const points: Point[] = [];
  const COUNT = 48;
  for (let n = 0; n < COUNT; n++) {
    const a = (n / COUNT) * Math.PI * 2;
    const r = radius * (1 + LAKE_WOBBLE * noise(Math.cos(a) * 1.3 + phase, Math.sin(a) * 1.3 - phase));
    points.push(fromEastFrame(side, { x: x + Math.cos(a) * r, y: y + Math.sin(a) * r }));
  }
  return points;
};

/** 地名を書く場所：川は中ほど、丘は帯の最も高い所、森は帯で森の濃い所の重心、沼は岸の外、野は帯の中ほど */
const findAnchors = (plan: LandscapePlan, heightmap: Float32Array, forest: Uint8Array, river: readonly Point[], lakes: readonly (readonly Point[])[]): TerrainAnchors => {
  const bandCenter = (side: Side) => fromEastFrame(side, { x: V1 + (MAP_PX - V1) / 2, y: MAP_PX / 2 });
  const hillSide = sideOf(plan, "hill") ?? "north";
  let hill = bandCenter(hillSide);
  let best = -Infinity;
  const forestSide = sideOf(plan, "forest") ?? "west";
  let fx = 0;
  let fy = 0;
  let fw = 0;
  for (let j = 0; j < H; j += 2)
    for (let i = 0; i < H; i += 2) {
      const p = cellCenter(i, j);
      const q = toEastFrame(hillSide, p);
      if (q.x > V1 + 120 && q.x < MAP_PX - 120 && q.y > V0 && q.y < V1) {
        const h = heightmap[j * H + i] as number;
        if (h > best) {
          best = h;
          hill = p;
        }
      }
      const r = toEastFrame(forestSide, p);
      if (r.x > V1 && r.y > V0 - 200 && r.y < V1 + 200) {
        const w = forest[j * H + i] as number;
        fx += p.x * w;
        fy += p.y * w;
        fw += w;
      }
    }
  const lakeSide = sideOf(plan, "lake");
  const lake = lakes[0];
  const plainSide = sideOf(plan, "plain");
  return {
    river: river[Math.floor(river.length / 2)] ?? bandCenter(sideOf(plan, "river") ?? "east"),
    hill,
    forest: fw > 0 ? { x: fx / fw, y: fy / fw } : bandCenter(forestSide),
    lake: lake && lakeSide ? (() => {
      const b = boundsOf(lake);
      return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
    })() : null,
    plain: plainSide ? bandCenter(plainSide) : null,
  };
};

/** 傾き（標高差／地図の 100px）。中心差分 */
export const slopeAt = (heightmap: Float32Array, i: number, j: number): number => {
  const at = (x: number, y: number) => heightmap[Math.min(H - 1, Math.max(0, y)) * H + Math.min(H - 1, Math.max(0, x))] as number;
  const dx = (at(i + 1, j) - at(i - 1, j)) / (2 * CELL);
  const dy = (at(i, j + 1) - at(i, j - 1)) / (2 * CELL);
  return Math.hypot(dx, dy) * 100;
};

/** 区画が建設可能か：中の標高の格子点に水も急傾斜も無い */
export const parcelBuildable = (terrain: Pick<TerrainData, "heightmap" | "water">, parcel: Parcel): boolean => {
  const b = boundsOf(parcel.polygon);
  for (let j = Math.max(0, Math.floor(b.minY / CELL)); j <= Math.min(H - 1, Math.ceil(b.maxY / CELL)); j++)
    for (let i = Math.max(0, Math.floor(b.minX / CELL)); i <= Math.min(H - 1, Math.ceil(b.maxX / CELL)); i++) {
      if (!pointInPolygon(cellCenter(i, j), parcel.polygon)) continue;
      if (terrain.water[j * H + i] !== 0) return false;
      if (slopeAt(terrain.heightmap, i, j) >= SLOPE_MAX) return false;
    }
  return true;
};

export const allParcelsBuildable = (terrain: Pick<TerrainData, "heightmap" | "water" | "parcels">): boolean =>
  terrain.parcels.every((p) => parcelBuildable(terrain, p));

export interface GenerateOptions {
  /** 建設可能の判定（テストで再試行の経路を確かめるために差し替える） */
  readonly check?: (terrain: TerrainData, attempt: number) => boolean;
}

export const generateTerrain = (seed: number, options: GenerateOptions = {}): TerrainData => {
  const plan = landscapePlan(seed);
  const parcels = mapParcels(seed);
  const check = options.check ?? ((t: TerrainData) => allParcelsBuildable(t));
  for (let attempt = 1; attempt <= TERRAIN_MAX_ATTEMPTS; attempt++) {
    const noiseSeed = attempt === 1 ? seed : deriveSeed(seed, attempt);
    const terrain = { ...buildOnce(noiseSeed, plan, parcels, { safe: false }), seed, attempts: attempt };
    if (check(terrain, attempt)) return terrain;
  }
  // 安全な地形：川と沼を外縁に寄せ、蛇行させない。村域は盆地化で必ず平らなので、ここで建設可能になる
  return { ...buildOnce(deriveSeed(seed, 0xfeed), plan, parcels, { safe: true }), seed, attempts: TERRAIN_MAX_ATTEMPTS + 1 };
};

/** 地形の指紋（決定論のテスト用）：標高・水・森・地味・川・区画を FNV-1a でまとめる */
export const terrainHash = (t: TerrainData): number => {
  let hash = 0x811c9dc5;
  const mix = (bytes: Uint8Array) => {
    for (let i = 0; i < bytes.length; i++) {
      hash ^= bytes[i] as number;
      hash = Math.imul(hash, 0x01000193);
    }
  };
  mix(new Uint8Array(t.heightmap.buffer, t.heightmap.byteOffset, t.heightmap.byteLength));
  mix(t.water);
  mix(t.forestMask);
  mix(t.fertility);
  mix(new Uint8Array(Float64Array.from(t.river.flatMap((p) => [p.x, p.y])).buffer));
  mix(new Uint8Array(Float64Array.from(t.parcels.flatMap((p) => p.polygon.flatMap((q) => [q.x, q.y]))).buffer));
  return hash >>> 0;
};
