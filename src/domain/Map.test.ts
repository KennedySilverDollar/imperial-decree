import { describe, expect, it } from "vitest";
import { BUILDINGS, CATEGORY_PLACEMENT_ORDER, INITIAL_BUILDINGS, type BuildingId } from "./Buildings";
import { newProject } from "./Construction";
import { GRID_SIZE, ROAD_TILE_MAX } from "./constants";
import { createInitialState, placeInitialBuildings } from "./GameState";
import { BUILDING_TILES, chooseTile, deriveMap, OFFICE_TILE, ROAD_TILES, roadTileCount, tileKey } from "./Map";

const countKind = (map: ReturnType<typeof deriveMap>, kind: string) =>
  map.tiles.flat().filter((t) => t.kind === kind).length;
const distanceFromCenter = ([x, y]: readonly [number, number]) => Math.hypot(x - (GRID_SIZE - 1) / 2, y - (GRID_SIZE - 1) / 2);

describe("地図の自動導出（v3.2 §2.6 / X-03, W-09, Z-13）", () => {
  it("道路は中央の十字で、建物の区画と重ならない", () => {
    expect(ROAD_TILES).toHaveLength(ROAD_TILE_MAX);
    const roads = new Set(ROAD_TILES.map(tileKey));
    expect(BUILDING_TILES.some((t) => roads.has(tileKey(t)))).toBe(false);
    expect(BUILDING_TILES.some((t) => tileKey(t) === tileKey(OFFICE_TILE))).toBe(false);
    expect(BUILDING_TILES.length + ROAD_TILES.length + 1).toBe(GRID_SIZE * GRID_SIZE);
  });

  it("道路の本数は floor(インフラ/5)、上限は十字の長さ", () => {
    expect(roadTileCount(10)).toBe(2);
    expect(roadTileCount(24.9)).toBe(4);
    expect(roadTileCount(1000)).toBe(ROAD_TILE_MAX);
    expect(roadTileCount(-5)).toBe(0);
  });

  it("初期状態：区画を占める初期建物がすべて置かれ、道路2本", () => {
    const state = createInitialState(1);
    const map = deriveMap(state.params.infrastructure, state.buildings, state.projects);
    const expected = (Object.entries(INITIAL_BUILDINGS) as [BuildingId, number][])
      .filter(([kind]) => BUILDINGS[kind].occupiesTile)
      .reduce((sum, [, n]) => sum + n, 0);
    expect(countKind(map, "building")).toBe(expected);
    expect(countKind(map, "road")).toBe(2);
    expect(map.roads).toBe(2);
  });

  it("配置は決定論：同じセーブ ID なら同じ区画、違えば別の配置になりうる", () => {
    const a = placeInitialBuildings("save-a");
    expect(placeInitialBuildings("save-a")).toEqual(a);
    const b = placeInitialBuildings("save-b");
    expect(b.buildings.map((x) => x.tile)).not.toEqual(a.buildings.map((x) => x.tile));
  });

  it("役所は中央の決まった区画、埋まっていれば null", () => {
    expect(chooseTile(new Set(), "office", 0.5)).toEqual(OFFICE_TILE);
    expect(chooseTile(new Set([tileKey(OFFICE_TILE)]), "office", 0.5)).toBeNull();
  });

  it("優先順位の高いカテゴリほど中央寄りの帯から選ぶ", () => {
    const first = CATEGORY_PLACEMENT_ORDER[0];
    const last = CATEGORY_PLACEMENT_ORDER.at(-1);
    const byCategory = (category: typeof first) =>
      (Object.keys(BUILDINGS) as BuildingId[]).find((id) => BUILDINGS[id].category === category && id !== "office" && BUILDINGS[id].occupiesTile);
    const near = byCategory(first);
    const far = byCategory(last);
    if (!near || !far) throw new Error("カテゴリの建物がない");
    for (const u of [0, 0.5, 0.99]) {
      const a = chooseTile(new Set(), near, u);
      const b = chooseTile(new Set(), far, u);
      if (!a || !b) throw new Error("区画が選べない");
      expect(distanceFromCenter(a)).toBeLessThanOrEqual(distanceFromCenter(b));
    }
  });

  it("空きがなければ null", () => {
    const all = new Set(BUILDING_TILES.map(tileKey));
    expect(chooseTile(all, "residential", 0.3)).toBeNull();
  });

  it("工事中の区画は普請中として描き、修繕は描き替えない", () => {
    const state = createInitialState(1);
    const tile = BUILDING_TILES.find((t) => !state.buildings.some((b) => b.tile && tileKey(b.tile) === tileKey(t)));
    if (!tile) throw new Error("空き区画がない");
    const project = newProject(1, "market", 1, 1, { repair: false, repairSerials: [], tiles: [tile], waterDown: false, costRatio: 1 });
    const map = deriveMap(state.params.infrastructure, state.buildings, [project]);
    expect(map.tiles[tile[1]]?.[tile[0]]).toMatchObject({ kind: "construction", building: "market", category: "economy" });
    expect(map.constructionTiles).toBe(1);
    const repair = { ...project, repair: true };
    expect(deriveMap(state.params.infrastructure, state.buildings, [repair]).constructionTiles).toBe(0);
  });

  it("空洞は地図に出ない（開示されても同じ見た目。v3.2 §1.8 / I-32）", () => {
    const state = createInitialState(1);
    const hollowed = state.buildings.map((b) => ({ ...b, hollow: true, disclosed: true }));
    expect(deriveMap(state.params.infrastructure, hollowed, [])).toEqual(deriveMap(state.params.infrastructure, state.buildings, []));
  });
});
