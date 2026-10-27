import { GRID_SIZE } from "../../domain/constants";
import { ROAD_TILES, type Coord } from "../../domain/Map";
import type { Point } from "./geometry2d";
import { OTHER_EDGE_COST, PARCEL_EDGE_SEGMENTS, ROAD_CURVE_STEPS, ROAD_EDGE_COST } from "./mapConstants";
import type { Parcel } from "./ParcelMapper";

// 道路（SPEC_v3.3 §5.3）。論理の道路区画（domain/Map の ROAD_TILES のうち先頭 n 本）は変えず、描き方だけを決める。
// 区画の境界（辺の折れ点を結ぶ線）だけを道にしたグラフの上で、A* で経路を引く。道路区画に接する辺は安く、それ以外は高い。
// 道は区画の境界の上だけを通るので、区画の内部を横切らない。描くときは Catmull-Rom で滑らかにして二重線にする。

export interface RoadGraph {
  readonly nodes: readonly Point[];
  /** 隣接リスト：[相手の点, 辺に接する区画（1〜2個）] */
  readonly adjacent: readonly (readonly { readonly to: number; readonly parcels: readonly number[] }[])[];
  /** 格子点 (i, j)（0..10）にあたる点の番号 */
  readonly vertexAt: (i: number, j: number) => number;
}

const keyOf = (p: Point) => `${p.x.toFixed(4)},${p.y.toFixed(4)}`;

export const buildRoadGraph = (parcels: readonly Parcel[]): RoadGraph => {
  const index = new Map<string, number>();
  const nodes: Point[] = [];
  const edges = new Map<string, { a: number; b: number; parcels: number[] }>();
  const node = (p: Point) => {
    const k = keyOf(p);
    let i = index.get(k);
    if (i === undefined) {
      i = nodes.length;
      nodes.push(p);
      index.set(k, i);
    }
    return i;
  };
  for (const parcel of parcels) {
    const ids = parcel.polygon.map(node);
    for (let i = 0; i < ids.length; i++) {
      const a = ids[i] as number;
      const b = ids[(i + 1) % ids.length] as number;
      const k = a < b ? `${a}-${b}` : `${b}-${a}`;
      const edge = edges.get(k) ?? { a: Math.min(a, b), b: Math.max(a, b), parcels: [] };
      edge.parcels.push(parcel.gridIndex);
      edges.set(k, edge);
    }
  }
  const adjacent: { to: number; parcels: number[] }[][] = nodes.map(() => []);
  for (const e of edges.values()) {
    adjacent[e.a]?.push({ to: e.b, parcels: e.parcels });
    adjacent[e.b]?.push({ to: e.a, parcels: e.parcels });
  }
  // 格子点 (i, j)：区画 (x, y) の多角形は 上辺→右辺→下辺→左辺 の順で、各辺の最初の点が角
  const corner = (x: number, y: number, which: 0 | 1 | 2 | 3) => {
    const parcel = parcels[y * GRID_SIZE + x] as Parcel;
    return node(parcel.polygon[which * PARCEL_EDGE_SEGMENTS] as Point);
  };
  const vertexAt = (i: number, j: number): number => {
    const x = Math.min(i, GRID_SIZE - 1);
    const y = Math.min(j, GRID_SIZE - 1);
    const which = i > x ? (j > y ? 2 : 1) : j > y ? 3 : 0;
    return corner(x, y, which);
  };
  return { nodes, adjacent, vertexAt };
};

/** 二分ヒープ（A* の開いた集合） */
class MinHeap {
  private items: { id: number; f: number }[] = [];
  get size() {
    return this.items.length;
  }
  push(id: number, f: number) {
    const items = this.items;
    items.push({ id, f });
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if ((items[parent] as { f: number }).f <= f) break;
      [items[i], items[parent]] = [items[parent] as { id: number; f: number }, items[i] as { id: number; f: number }];
      i = parent;
    }
  }
  pop(): number {
    const items = this.items;
    const top = items[0] as { id: number };
    const last = items.pop() as { id: number; f: number };
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < items.length && (items[l] as { f: number }).f < (items[m] as { f: number }).f) m = l;
        if (r < items.length && (items[r] as { f: number }).f < (items[m] as { f: number }).f) m = r;
        if (m === i) break;
        [items[i], items[m]] = [items[m] as { id: number; f: number }, items[i] as { id: number; f: number }];
        i = m;
      }
    }
    return top.id;
  }
}

/**
 * A*：start から goals（すでに道のある点）のどれかまで。辺の重みは 長さ × (道路区画に接するなら ROAD_EDGE_COST、それ以外は OTHER_EDGE_COST)。
 * 推定値は「最も近いゴールまでの直線距離 × ROAD_EDGE_COST」（どの辺もそれ以上の重みなので過大評価しない）。
 */
export const aStar = (graph: RoadGraph, start: number, goals: ReadonlySet<number>, roadParcels: ReadonlySet<number>): number[] => {
  if (goals.has(start)) return [start];
  const goalPoints = [...goals].map((g) => graph.nodes[g] as Point);
  const h = (id: number) => {
    const p = graph.nodes[id] as Point;
    let best = Infinity;
    for (const g of goalPoints) best = Math.min(best, Math.hypot(g.x - p.x, g.y - p.y));
    return best * ROAD_EDGE_COST;
  };
  const g = new Map<number, number>([[start, 0]]);
  const from = new Map<number, number>();
  const open = new MinHeap();
  open.push(start, h(start));
  const closed = new Set<number>();
  while (open.size > 0) {
    const current = open.pop();
    if (closed.has(current)) continue;
    if (goals.has(current)) {
      const path = [current];
      let at = current;
      while (from.has(at)) {
        at = from.get(at) as number;
        path.push(at);
      }
      return path.reverse();
    }
    closed.add(current);
    const here = graph.nodes[current] as Point;
    for (const { to, parcels } of graph.adjacent[current] ?? []) {
      if (closed.has(to)) continue;
      const there = graph.nodes[to] as Point;
      const weight = parcels.some((p) => roadParcels.has(p)) ? ROAD_EDGE_COST : OTHER_EDGE_COST;
      const tentative = (g.get(current) as number) + Math.hypot(there.x - here.x, there.y - here.y) * weight;
      if (tentative < (g.get(to) ?? Infinity)) {
        g.set(to, tentative);
        from.set(to, current);
        open.push(to, tentative + h(to));
      }
    }
  }
  return [];
};

const ROAD_LINE = ROAD_TILES[0]?.[1] ?? 0;

/**
 * 道路区画1つにつき、伸ばす先の点：横の道（ROAD_LINE の行）は区画の下辺の、中央から遠い端。
 * 縦の道（ROAD_LINE の列）は区画の右辺の、中央から遠い端。どちらも役所の区画の角（中心点）を通る直線上にある。
 */
const targetOf = (graph: RoadGraph, [x, y]: Coord): number => {
  if (y === ROAD_LINE && x !== ROAD_LINE) return x < ROAD_LINE ? graph.vertexAt(x, y + 1) : graph.vertexAt(x + 1, y + 1);
  if (x === ROAD_LINE && y !== ROAD_LINE) return y < ROAD_LINE ? graph.vertexAt(x + 1, y) : graph.vertexAt(x + 1, y + 1);
  return graph.vertexAt(ROAD_LINE + 1, ROAD_LINE + 1);
};

export interface RoadNetwork {
  /** A* の経路（点の番号の列）。道路区画の順に1本ずつ */
  readonly paths: readonly (readonly number[])[];
  /** 各経路が、論理の道路区画（ROAD_TILES）の何番目から伸ばしたものか */
  readonly pathTiles: readonly number[];
  /** 各経路を滑らかにした曲線（新しく伸びた道だけ色を変えて描くため） */
  readonly pathCurves: readonly (readonly Point[])[];
  /** 描く単位：分かれ道で切った折れ線（点の座標）と、それを滑らかにした曲線 */
  readonly chains: readonly (readonly Point[])[];
  readonly curves: readonly (readonly Point[])[];
}

export const routeRoads = (graph: RoadGraph, roadCount: number): RoadNetwork => {
  const tiles = ROAD_TILES.slice(0, roadCount);
  const roadParcels = new Set(tiles.map(([x, y]) => y * GRID_SIZE + x));
  const hub = graph.vertexAt(ROAD_LINE + 1, ROAD_LINE + 1);
  const network = new Set<number>([hub]);
  const paths: number[][] = [];
  const pathTiles: number[] = [];
  tiles.forEach((tile, index) => {
    const path = aStar(graph, targetOf(graph, tile), network, roadParcels);
    if (path.length < 2) return;
    paths.push(path);
    pathTiles.push(index);
    for (const id of path) network.add(id);
  });
  const chains = toChains(graph, paths);
  return {
    paths,
    pathTiles,
    pathCurves: paths.map((path) => catmullRom(path.map((id) => graph.nodes[id] as Point), ROAD_CURVE_STEPS)),
    chains,
    curves: chains.map((c) => catmullRom(c, ROAD_CURVE_STEPS)),
  };
};

/** 経路の辺を集め、分かれ道（次数が2でない点）で切った折れ線にする */
const toChains = (graph: RoadGraph, paths: readonly (readonly number[])[]): Point[][] => {
  const links = new Map<number, Set<number>>();
  const link = (a: number, b: number) => {
    if (!links.has(a)) links.set(a, new Set());
    links.get(a)?.add(b);
  };
  for (const path of paths)
    for (let i = 0; i + 1 < path.length; i++) {
      link(path[i] as number, path[i + 1] as number);
      link(path[i + 1] as number, path[i] as number);
    }
  const used = new Set<string>();
  const edgeKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);
  const chains: Point[][] = [];
  const ends = [...links.keys()].filter((n) => (links.get(n)?.size ?? 0) !== 2).sort((a, b) => a - b);
  const walk = (start: number, next: number) => {
    const chain = [start, next];
    used.add(edgeKey(start, next));
    let prev = start;
    let at = next;
    while ((links.get(at)?.size ?? 0) === 2) {
      const following = [...(links.get(at) ?? [])].find((n) => n !== prev);
      if (following === undefined || used.has(edgeKey(at, following))) break;
      used.add(edgeKey(at, following));
      chain.push(following);
      prev = at;
      at = following;
    }
    chains.push(chain.map((id) => graph.nodes[id] as Point));
  };
  for (const end of ends) for (const next of [...(links.get(end) ?? [])].sort((a, b) => a - b)) if (!used.has(edgeKey(end, next))) walk(end, next);
  return chains;
};

/** 中心型の Catmull-Rom（alpha 0.5）。端点は折れ線の端を延長した仮の点で補う */
export const catmullRom = (points: readonly Point[], steps: number): Point[] => {
  if (points.length < 3) return [...points];
  const first = points[0] as Point;
  const second = points[1] as Point;
  const last = points[points.length - 1] as Point;
  const beforeLast = points[points.length - 2] as Point;
  const ext = [
    { x: 2 * first.x - second.x, y: 2 * first.y - second.y },
    ...points,
    { x: 2 * last.x - beforeLast.x, y: 2 * last.y - beforeLast.y },
  ];
  const out: Point[] = [first];
  const tj = (ti: number, a: Point, b: Point) => ti + Math.sqrt(Math.max(1e-9, Math.hypot(b.x - a.x, b.y - a.y)));
  for (let i = 1; i + 2 < ext.length; i++) {
    const p0 = ext[i - 1] as Point;
    const p1 = ext[i] as Point;
    const p2 = ext[i + 1] as Point;
    const p3 = ext[i + 2] as Point;
    const t0 = 0;
    const t1 = tj(t0, p0, p1);
    const t2 = tj(t1, p1, p2);
    const t3 = tj(t2, p2, p3);
    for (let s = 1; s <= steps; s++) {
      const t = t1 + ((t2 - t1) * s) / steps;
      const mix = (a: Point, b: Point, ta: number, tb: number) => ({
        x: ((tb - t) / (tb - ta)) * a.x + ((t - ta) / (tb - ta)) * b.x,
        y: ((tb - t) / (tb - ta)) * a.y + ((t - ta) / (tb - ta)) * b.y,
      });
      const a1 = mix(p0, p1, t0, t1);
      const a2 = mix(p1, p2, t1, t2);
      const a3 = mix(p2, p3, t2, t3);
      const b1 = mix(a1, a2, t0, t2);
      const b2 = mix(a2, a3, t1, t3);
      out.push(mix(b1, b2, t1, t2));
    }
  }
  return out;
};
