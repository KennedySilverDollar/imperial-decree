import { chaikin, simplifyIndices, smoothPolyline, toLocal, toWorld } from "./geometry";
import { gridOf, sampleBilinear, type Grid } from "./grid";
import { HIGHWAY, WORLD_M } from "./terrainConstants";
import type { ArmEnd, Point, VillageFrame } from "./types";

// 街道（SPEC_v3.4 §4.4）。十字の本通りの一端から、地形のコスト（傾斜・水）を使った A* で地図の縁まで。
// 行き先は十字の端の外向きの先の地図の縁（川側の端なら川を渡り、丘側の端なら丘を越える）。
// 村域には入らない。湖は通れない。川は渡れる（渡った所が渡河点）。

const ARM_ROW_B = 30; // 十字の横の通り（y = 4 の行）の中心 b
const ARM_COL_A = -30; // 十字の縦の通り（x = 4 の列）の中心 a
const ARM_ORDER: readonly ArmEnd[] = ["upstream", "downstream", "hillside", "riverside"];

/** 十字の各端の点（局所座標）と外向きの向き */
export const armEnd = (F: VillageFrame, end: ArmEnd): { local: Point; out: Point } => {
  const h = F.halfM;
  switch (end) {
    case "upstream":
      return { local: [-h, ARM_ROW_B], out: [-1, 0] };
    case "downstream":
      return { local: [h, ARM_ROW_B], out: [1, 0] };
    case "hillside":
      return { local: [ARM_COL_A, h], out: [0, 1] };
    case "riverside":
      return { local: [ARM_COL_A, -h], out: [0, -1] };
  }
};

export const armEndPoint = (F: VillageFrame, end: ArmEnd): Point => {
  const { local } = armEnd(F, end);
  return toWorld(F, local[0], local[1]);
};

interface Heap {
  ids: Int32Array;
  keys: Float64Array;
  size: number;
}

const heapPush = (h: Heap, id: number, key: number) => {
  let i = h.size++;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (h.keys[p]! <= key) break;
    h.ids[i] = h.ids[p]!;
    h.keys[i] = h.keys[p]!;
    i = p;
  }
  h.ids[i] = id;
  h.keys[i] = key;
};

const heapPop = (h: Heap): number => {
  const top = h.ids[0]!;
  const lastId = h.ids[--h.size]!;
  const lastKey = h.keys[h.size]!;
  let i = 0;
  for (;;) {
    const l = i * 2 + 1;
    if (l >= h.size) break;
    const r = l + 1;
    const c = r < h.size && h.keys[r]! < h.keys[l]! ? r : l;
    if (h.keys[c]! >= lastKey) break;
    h.ids[i] = h.ids[c]!;
    h.keys[i] = h.keys[c]!;
    i = c;
  }
  h.ids[i] = lastId;
  h.keys[i] = lastKey;
  return top;
};

export interface HighwayResult {
  readonly points: Point[];
  readonly from: ArmEnd;
  readonly fords: Point[];
  /** 街道上の標高（峠の判定） */
  readonly elevations: number[];
}

/**
 * H：地図全体の標高（g の格子）、water：川（渡れる）、lakes：湖（通れない）、wet：湿地・旧河道（通りにくい）。
 * 最初に試す端は random で選び、道が見つからなければ次の端を試す。どの端からも行けなければ null。
 */
export const routeHighway = (
  H: Float32Array,
  g: Grid,
  water: Uint8Array,
  lakes: Uint8Array,
  wet: Uint8Array,
  F: VillageFrame,
  first: number,
): HighwayResult | null => {
  const c = gridOf(HIGHWAY.gridN);
  const n = c.n;
  const ratio = g.n / n;
  const height = new Float32Array(n * n);
  const flags = new Uint8Array(n * n); // 1: 川、2: 湖、4: 湿地、8: 村域
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const x = (i + 0.5) * c.cell;
      const y = (j + 0.5) * c.cell;
      height[k] = sampleBilinear(H, g, x, y);
      let f = 0;
      for (let jj = 0; jj < ratio; jj++) {
        for (let ii = 0; ii < ratio; ii++) {
          const q = (j * ratio + jj) * g.n + i * ratio + ii;
          if (water[q]) f |= 1;
          if (lakes[q]) f |= 2;
          if (wet[q]) f |= 4;
        }
      }
      const [a, b] = toLocal(F, [x, y]);
      if (Math.max(Math.abs(a), Math.abs(b)) < F.halfM + HIGHWAY.villageKeepM) f |= 8;
      flags[k] = f;
    }
  }
  const cellOf = (p: Point) =>
    Math.min(n - 1, Math.max(0, Math.floor(p[1] / c.cell))) * n + Math.min(n - 1, Math.max(0, Math.floor(p[0] / c.cell)));
  for (let t = 0; t < ARM_ORDER.length; t++) {
    const from = ARM_ORDER[(first + t) % ARM_ORDER.length]!;
    const { local, out } = armEnd(F, from);
    // 行き先：十字の端の外向きに村の中心から伸ばした線が地図の縁と交わる所。その近く（±goalSpread）の縁に着けばよい
    const dir: Point = [out[0] * F.axisA[0] + out[1] * F.axisB[0], out[0] * F.axisA[1] + out[1] * F.axisB[1]];
    const tx = dir[0] > 0 ? (WORLD_M - F.center[0]) / dir[0] : dir[0] < 0 ? -F.center[0] / dir[0] : Infinity;
    const ty = dir[1] > 0 ? (WORLD_M - F.center[1]) / dir[1] : dir[1] < 0 ? -F.center[1] / dir[1] : Infinity;
    const reach = Math.min(tx, ty);
    const target: Point = [F.center[0] + dir[0] * reach, F.center[1] + dir[1] * reach];
    const spread = HIGHWAY.goalSpreadM;
    const toTarget = (k: number) => {
      const x = ((k % n) + 0.5) * c.cell;
      const y = (Math.floor(k / n) + 0.5) * c.cell;
      return Math.max(0, Math.hypot(x - target[0], y - target[1]) - spread);
    };
    const startPoint = toWorld(F, local[0] + out[0] * (HIGHWAY.villageKeepM + c.cell * 2), local[1] + out[1] * (HIGHWAY.villageKeepM + c.cell * 2));
    const start = cellOf(startPoint);
    if (flags[start]! & 2) continue;
    const gScore = new Float64Array(n * n).fill(Infinity);
    const came = new Int32Array(n * n).fill(-1);
    const closed = new Uint8Array(n * n);
    const heap: Heap = { ids: new Int32Array(n * n * 8), keys: new Float64Array(n * n * 8), size: 0 };
    gScore[start] = 0;
    heapPush(heap, start, toTarget(start));
    let goal = -1;
    while (heap.size > 0) {
      const k = heapPop(heap);
      if (closed[k]) continue;
      closed[k] = 1;
      const i = k % n;
      const j = (k - i) / n;
      if ((i === 0 || j === 0 || i === n - 1 || j === n - 1) && toTarget(k) === 0) {
        goal = k;
        break;
      }
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          if (di === 0 && dj === 0) continue;
          const ii = i + di;
          const jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
          const q = jj * n + ii;
          if (closed[q]) continue;
          const f = flags[q]!;
          if (f & 2 || f & 8) continue;
          const len = (di !== 0 && dj !== 0 ? Math.SQRT2 : 1) * c.cell;
          const slope = Math.abs(height[q]! - height[k]!) / len;
          let cost = len * (1 + HIGHWAY.slopeCost * slope * slope);
          if (f & 1) cost += len * HIGHWAY.riverCost;
          if (f & 4) cost += len * 4;
          const tentative = gScore[k]! + cost;
          if (tentative < gScore[q]!) {
            gScore[q] = tentative;
            came[q] = k;
            heapPush(heap, q, tentative + toTarget(q));
          }
        }
      }
    }
    if (goal < 0) continue;
    const cells: number[] = [];
    for (let k = goal; k >= 0; k = came[k]!) cells.push(k);
    cells.reverse();
    const centers: Point[] = cells.map((k) => [((k % n) + 0.5) * c.cell, (Math.floor(k / n) + 0.5) * c.cell]);
    const last = centers[centers.length - 1]!;
    const gi = goal % n;
    const gj = Math.floor(goal / n);
    const edge: Point = gi === 0 ? [0, last[1]] : gi === n - 1 ? [WORLD_M, last[1]] : gj === 0 ? [last[0], 0] : [last[0], WORLD_M];
    const fords: Point[] = [];
    for (let m = 0; m < cells.length; m++) {
      if (!(flags[cells[m]!]! & 1)) continue;
      let e = m;
      while (e + 1 < cells.length && flags[cells[e + 1]!]! & 1) e++;
      fords.push(centers[Math.floor((m + e) / 2)]!);
      m = e;
    }
    const raw: Point[] = [armEndPoint(F, from), ...smoothPolyline(centers, 2), edge];
    const keep = simplifyIndices(raw, c.cell * 0.4);
    const points = chaikin(
      keep.map((k) => raw[k]!),
      2,
    );
    return { points, from, fords, elevations: points.map((p) => sampleBilinear(H, g, p[0], p[1])) };
  }
  return null;
};
