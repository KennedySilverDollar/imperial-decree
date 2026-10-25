import { BUILDINGS, CATEGORY_PLACEMENT_ORDER, type BuildingId, type Category } from "./Buildings";
import type { Project } from "./Construction";
import { GRID_SIZE, INFRA_PER_ROAD_TILE, ROAD_TILE_MAX } from "./constants";
import type { BuildingInstance } from "./DerivedStats";
import { hashString, unitFromSeed } from "./Prng";

// 地図（v3.2 §2.6 / DECISIONS X-03, W-09, Z-13）。
// 区画は発注時に決めて保存する（毎年再計算すると道路の増減で全体がずれるため）。
// 道路は中央の十字に、floor(インフラ/5) 本だけ描く（区画を占めない）。役所は中央の決まった区画。
// 同じカテゴリ内の位置はセーブ ID と通し番号から決まる乱数（本系列の Rng を消費しない）。
// 空洞は地図に出さない（v3.2 §1.8「亀裂は未表示」。D-25 の亀裂アイコンを置き換え：DECISIONS I-32）。

export type Coord = readonly [number, number];

const CENTER = (GRID_SIZE - 1) / 2;
const ROAD_LINE = Math.floor(CENTER);
const key = ([x, y]: Coord) => `${x},${y}`;
const distance = ([x, y]: Coord) => Math.hypot(x - CENTER, y - CENTER);
const byDistance = (a: Coord, b: Coord) => distance(a) - distance(b) || a[1] - b[1] || a[0] - b[0];

/** 道路の十字（中央から外へ伸びる順） */
export const ROAD_TILES: readonly Coord[] = (() => {
  const tiles: Coord[] = [];
  for (let i = 0; i < GRID_SIZE; i++) tiles.push([i, ROAD_LINE]);
  for (let i = 0; i < GRID_SIZE; i++) if (i !== ROAD_LINE) tiles.push([ROAD_LINE, i]);
  const roadCenter: Coord = [ROAD_LINE, ROAD_LINE];
  const d = ([x, y]: Coord) => Math.abs(x - roadCenter[0]) + Math.abs(y - roadCenter[1]);
  return tiles.sort((a, b) => d(a) - d(b) || a[1] - b[1] || a[0] - b[0]).slice(0, ROAD_TILE_MAX);
})();

const ROAD_KEYS = new Set(ROAD_TILES.map(key));
export const OFFICE_TILE: Coord = [ROAD_LINE + 1, ROAD_LINE + 1];

/** 建物を置ける区画（道路と役所の区画を除き、中央に近い順） */
export const BUILDING_TILES: readonly Coord[] = (() => {
  const tiles: Coord[] = [];
  for (let y = 0; y < GRID_SIZE; y++) for (let x = 0; x < GRID_SIZE; x++) if (!ROAD_KEYS.has(key([x, y]))) tiles.push([x, y]);
  return tiles.filter((t) => key(t) !== key(OFFICE_TILE)).sort(byDistance);
})();

/** 1つのカテゴリが選ぶ候補の数（中央に近い空き区画から数えて） */
const PLACEMENT_WINDOW = 6;
/** カテゴリの優先順位が1つ下がるごとに、候補の帯を外へずらす区画数 */
const RANK_STRIDE = 3;

/**
 * 区画を選ぶ（v3.2 §2.6 / CLAUDE.md §5「役所→道路→住宅→空き地」）。
 * 空き区画を中央に近い順に並べ、カテゴリの優先順位が高いほど内側の帯から、帯の中は u（[0,1)）で選ぶ。
 * 内側が埋まれば帯は自然に外へ移るので、町は中央から外へ育つ。役所は中央の決まった区画。空きがなければ null。
 */
export const chooseTile = (occupied: ReadonlySet<string>, building: BuildingId, u: number): Coord | null => {
  if (building === "office") return occupied.has(key(OFFICE_TILE)) ? null : OFFICE_TILE;
  const free = BUILDING_TILES.filter((t) => !occupied.has(key(t)));
  if (free.length === 0) return null;
  const rank = CATEGORY_PLACEMENT_ORDER.indexOf(BUILDINGS[building].category);
  const start = Math.min(free.length - 1, rank * RANK_STRIDE);
  const window = Math.min(free.length - start, PLACEMENT_WINDOW);
  return free[start + Math.floor(u * window)] ?? free[0] ?? null;
};

/** 置き場所を選ぶための乱数（セーブ ID と通し番号から決まる） */
export const placementUnit = (saveId: string, serial: number): number => unitFromSeed(hashString(saveId), serial);

export const occupiedTiles = (buildings: readonly BuildingInstance[], projects: readonly Project[]): Set<string> => {
  const set = new Set<string>();
  for (const b of buildings) if (b.tile) set.add(key(b.tile));
  for (const p of projects) for (const t of p.tiles) set.add(key(t));
  return set;
};

export const freeBuildingTiles = (buildings: readonly BuildingInstance[], projects: readonly Project[]): number => {
  const occupied = occupiedTiles(buildings, projects);
  return BUILDING_TILES.filter((t) => !occupied.has(key(t))).length + (occupied.has(key(OFFICE_TILE)) ? 0 : 1);
};

export type TileKind = "empty" | "road" | "building" | "construction";

export interface Tile {
  readonly x: number;
  readonly y: number;
  readonly kind: TileKind;
  readonly building: BuildingId | null;
  readonly category: Category | null;
}

export interface MapState {
  readonly size: number;
  /** tiles[y][x] */
  readonly tiles: readonly (readonly Tile[])[];
  readonly roads: number;
  readonly constructionTiles: number;
}

export const roadTileCount = (infrastructure: number): number =>
  Math.min(ROAD_TILE_MAX, Math.max(0, Math.floor(infrastructure / INFRA_PER_ROAD_TILE)));

export const deriveMap = (
  infrastructure: number,
  buildings: readonly BuildingInstance[],
  projects: readonly Project[],
): MapState => {
  const grid: Tile[][] = Array.from({ length: GRID_SIZE }, (_, y) =>
    Array.from({ length: GRID_SIZE }, (_, x) => ({ x, y, kind: "empty" as TileKind, building: null, category: null })),
  );
  const set = (t: Tile) => {
    const row = grid[t.y];
    if (row) row[t.x] = t;
  };
  const roads = roadTileCount(infrastructure);
  ROAD_TILES.slice(0, roads).forEach(([x, y]) => set({ x, y, kind: "road", building: null, category: null }));
  for (const b of buildings) {
    if (!b.tile) continue;
    const [x, y] = b.tile;
    set({ x, y, kind: "building", building: b.kind, category: BUILDINGS[b.kind].category });
  }
  let constructionTiles = 0;
  for (const p of projects) {
    if (p.repair) continue;
    for (const [x, y] of p.tiles) {
      set({ x, y, kind: "construction", building: p.kind, category: BUILDINGS[p.kind].category });
      constructionTiles++;
    }
  }
  return { size: GRID_SIZE, tiles: grid, roads, constructionTiles };
};

export const tileKey = key;
