import { GRID_SIZE } from "../../domain/constants";
import { centroid, lerp, randomStream, type Point } from "./geometry2d";
import {
  PARCEL_EDGE_SEGMENTS,
  PARCEL_EDGE_WOBBLE,
  PARCEL_JITTER,
  PARCEL_RELAX_BLEND,
  PARCEL_RELAX_ITERATIONS,
  VILLAGE_ORIGIN,
  VILLAGE_SIZE,
} from "./mapConstants";

// 論理グリッド → 有機的な区画（SPEC_v3.3 §5.3）。表示専用の写像で、domain/Map の配置ロジックには触れない（DECISIONS AA-10）。
// 11×11 の格子点をずらし（外周の点は外周に沿ってだけ動かす）、Lloyd 緩和（各頂点を、囲む4区画の重心の平均へ寄せる）を1〜2回かけ、
// さらに各辺を小さな線分に分けて揺らす。辺の折れ点は隣り合う2区画で同じ点を共有するので、区画は重ならず隙間もない。

export interface Parcel {
  /** 0..99（y*10+x）。論理グリッドと1対1 */
  readonly gridIndex: number;
  readonly x: number;
  readonly y: number;
  /** 時計回り（画面座標）の多角形 */
  readonly polygon: readonly Point[];
  readonly center: Point;
}

const N = GRID_SIZE + 1;
const CELL = VILLAGE_SIZE / GRID_SIZE;
const vid = (i: number, j: number) => j * N + i;

/** 村域の外周（区画の外側の輪郭） */
export const villageOutline = (parcels: readonly Parcel[]): Point[] => {
  const at = (x: number, y: number) => parcels[y * GRID_SIZE + x] as Parcel;
  const side = GRID_SIZE - 1;
  const k = PARCEL_EDGE_SEGMENTS;
  // 各区画の多角形は「上辺→右辺→下辺→左辺」の順に k 点ずつ並ぶ
  const edge = (p: Parcel, e: number) => p.polygon.slice(e * k, e * k + k);
  const out: Point[] = [];
  for (let x = 0; x <= side; x++) out.push(...edge(at(x, 0), 0));
  for (let y = 0; y <= side; y++) out.push(...edge(at(side, y), 1));
  for (let x = side; x >= 0; x--) out.push(...edge(at(x, side), 2));
  for (let y = side; y >= 0; y--) out.push(...edge(at(0, y), 3));
  return out;
};

export const mapParcels = (seed: number): readonly Parcel[] => {
  const random = randomStream(seed, 0x9a11);
  // 1) 格子点のずらし
  const vx = new Float64Array(N * N);
  const vy = new Float64Array(N * N);
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const onX = i === 0 || i === N - 1;
      const onY = j === 0 || j === N - 1;
      const jx = (random() * 2 - 1) * PARCEL_JITTER * CELL;
      const jy = (random() * 2 - 1) * PARCEL_JITTER * CELL;
      vx[vid(i, j)] = VILLAGE_ORIGIN + i * CELL + (onX ? 0 : jx);
      vy[vid(i, j)] = VILLAGE_ORIGIN + j * CELL + (onY ? 0 : jy);
    }

  // 2) Lloyd 緩和：区画の重心を求め、内側の頂点を囲む区画の重心の平均へ寄せる（外周の点は外周に沿ってだけ）
  const quad = (x: number, y: number): Point[] => [
    { x: vx[vid(x, y)] as number, y: vy[vid(x, y)] as number },
    { x: vx[vid(x + 1, y)] as number, y: vy[vid(x + 1, y)] as number },
    { x: vx[vid(x + 1, y + 1)] as number, y: vy[vid(x + 1, y + 1)] as number },
    { x: vx[vid(x, y + 1)] as number, y: vy[vid(x, y + 1)] as number },
  ];
  for (let iteration = 0; iteration < PARCEL_RELAX_ITERATIONS; iteration++) {
    const centers: Point[] = [];
    for (let y = 0; y < GRID_SIZE; y++) for (let x = 0; x < GRID_SIZE; x++) centers.push(centroid(quad(x, y)));
    const nx = Float64Array.from(vx);
    const ny = Float64Array.from(vy);
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const around: Point[] = [];
        for (const [x, y] of [
          [i - 1, j - 1],
          [i, j - 1],
          [i - 1, j],
          [i, j],
        ] as const)
          if (x >= 0 && y >= 0 && x < GRID_SIZE && y < GRID_SIZE) around.push(centers[y * GRID_SIZE + x] as Point);
        if (around.length < 2) continue; // 四隅は動かさない
        const ax = around.reduce((s, p) => s + p.x, 0) / around.length;
        const ay = around.reduce((s, p) => s + p.y, 0) / around.length;
        const onX = i === 0 || i === N - 1;
        const onY = j === 0 || j === N - 1;
        if (!onX) nx[vid(i, j)] = lerp(vx[vid(i, j)] as number, ax, PARCEL_RELAX_BLEND);
        if (!onY) ny[vid(i, j)] = lerp(vy[vid(i, j)] as number, ay, PARCEL_RELAX_BLEND);
      }
    vx.set(nx);
    vy.set(ny);
  }

  // 3) 辺を小さな線分に分けて揺らす。辺ごとに1回だけ作り、隣の区画は逆向きにたどって同じ点を使う
  const edgePoints = new Map<string, Point[]>();
  const edgeBetween = (a: number, b: number): Point[] => {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const key = `${lo}-${hi}`;
    let points = edgePoints.get(key);
    if (!points) {
      const wobble = randomStream(seed, 0x5000 + lo * 131 + hi);
      const p0 = { x: vx[lo] as number, y: vy[lo] as number };
      const p1 = { x: vx[hi] as number, y: vy[hi] as number };
      const len = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      const nxv = -(p1.y - p0.y) / len;
      const nyv = (p1.x - p0.x) / len;
      const outer = isOuterEdge(lo, hi);
      points = [p0];
      for (let s = 1; s < PARCEL_EDGE_SEGMENTS; s++) {
        const t = s / PARCEL_EDGE_SEGMENTS;
        // 村域の外周は直線のまま（村域の外へはみ出さない）
        const off = outer ? 0 : (wobble() * 2 - 1) * PARCEL_EDGE_WOBBLE * len;
        points.push({ x: lerp(p0.x, p1.x, t) + nxv * off, y: lerp(p0.y, p1.y, t) + nyv * off });
      }
      edgePoints.set(key, points);
    }
    // points は lo→hi の向き（終点 hi は含まない）。a→b の向きで、始点 a を含み終点 b を含まない列を返す
    if (a === lo) return points;
    const reversed = [...points.slice(1)].reverse();
    return [{ x: vx[hi] as number, y: vy[hi] as number }, ...reversed];
  };

  const parcels: Parcel[] = [];
  for (let y = 0; y < GRID_SIZE; y++)
    for (let x = 0; x < GRID_SIZE; x++) {
      const tl = vid(x, y);
      const tr = vid(x + 1, y);
      const br = vid(x + 1, y + 1);
      const bl = vid(x, y + 1);
      const polygon = [...edgeBetween(tl, tr), ...edgeBetween(tr, br), ...edgeBetween(br, bl), ...edgeBetween(bl, tl)];
      parcels.push({ gridIndex: y * GRID_SIZE + x, x, y, polygon, center: centroid(polygon) });
    }
  return parcels;
};

const isOuterEdge = (a: number, b: number): boolean => {
  const [ai, aj] = [a % N, Math.floor(a / N)];
  const [bi, bj] = [b % N, Math.floor(b / N)];
  return (ai === bi && (ai === 0 || ai === N - 1)) || (aj === bj && (aj === 0 || aj === N - 1));
};
