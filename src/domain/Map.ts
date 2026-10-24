import { GRID_SIZE, INFRA_PER_ROAD_TILE, MIN_EMPTY_TILES } from "./constants";
import type { Facilities, Params } from "./GameState";

// 地図の自動導出（SPEC §8.2 / BALANCE §6 / DECISIONS N-01, D-25, D-26）。
// 地図は状態として保存せず、パラメータから毎回導出する。

export type TileKind = "office" | "road" | "residential" | "market" | "empty";

export interface Tile {
  readonly x: number;
  readonly y: number;
  readonly kind: TileKind;
  /** 見た目と実態の乖離が開示された区画（亀裂アイコン） */
  readonly cracked: boolean;
}

export interface MapState {
  readonly size: number;
  /** tiles[y][x] */
  readonly tiles: readonly (readonly Tile[])[];
  readonly counts: Readonly<Record<TileKind, number>>;
}

/** 中心から時計回りの螺旋順に全区画を並べる */
export const spiralOrder = (size: number): readonly (readonly [number, number])[] => {
  const result: (readonly [number, number])[] = [];
  const directions = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ] as const;
  let x = Math.floor((size - 1) / 2);
  let y = x;
  let step = 1;
  let dir = 0;
  const inBounds = (px: number, py: number) => px >= 0 && py >= 0 && px < size && py < size;
  result.push([x, y]);
  while (result.length < size * size) {
    for (let leg = 0; leg < 2; leg++) {
      const [dx, dy] = directions[dir % directions.length] ?? [0, 0];
      for (let i = 0; i < step; i++) {
        x += dx;
        y += dy;
        if (inBounds(x, y)) result.push([x, y]);
      }
      dir++;
    }
    step++;
  }
  return result;
};

const SPIRAL = spiralOrder(GRID_SIZE);

export const deriveMap = (params: Params, facilities: Facilities): MapState => {
  const capacity = GRID_SIZE * GRID_SIZE - MIN_EMPTY_TILES;
  const actualRoads = Math.floor(params.infrastructure / INFRA_PER_ROAD_TILE);
  const visualRoads = Math.floor((params.infrastructure + facilities.hollowInfrastructure) / INFRA_PER_ROAD_TILE);
  const crackedRoads = facilities.hollowDisclosed ? Math.max(0, visualRoads - actualRoads) : 0;

  // 優先順位：役所 → 道路 → 住宅 → 市場 → 空き地
  const queue: { kind: TileKind; cracked: boolean }[] = [];
  const push = (kind: TileKind, count: number, cracked = false) => {
    for (let i = 0; i < count && queue.length < capacity; i++) queue.push({ kind, cracked });
  };
  push("office", facilities.officeBuilt ? 1 : 0);
  push("road", visualRoads - crackedRoads);
  push("road", crackedRoads, true);
  push("residential", Math.floor(facilities.housingUnits));
  push("market", facilities.marketCount);

  const grid: Tile[][] = Array.from({ length: GRID_SIZE }, (_, y) =>
    Array.from({ length: GRID_SIZE }, (_, x) => ({ x, y, kind: "empty" as TileKind, cracked: false })),
  );
  const counts: Record<TileKind, number> = { office: 0, road: 0, residential: 0, market: 0, empty: 0 };
  SPIRAL.forEach(([x, y], index) => {
    const placed = queue[index] ?? { kind: "empty" as TileKind, cracked: false };
    const row = grid[y];
    if (row) row[x] = { x, y, kind: placed.kind, cracked: placed.cracked };
    counts[placed.kind]++;
  });
  return { size: GRID_SIZE, tiles: grid, counts };
};
