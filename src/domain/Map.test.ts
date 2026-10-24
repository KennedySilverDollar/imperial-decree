import { describe, expect, it } from "vitest";
import { GRID_SIZE, MIN_EMPTY_TILES } from "./constants";
import { INITIAL_FACILITIES, INITIAL_PARAMS } from "./GameState";
import { deriveMap, spiralOrder } from "./Map";

describe("地図の自動導出（SPEC §8.2 / BALANCE §6）", () => {
  it("螺旋順は全区画を重複なく1回ずつ通る", () => {
    const order = spiralOrder(GRID_SIZE);
    expect(order).toHaveLength(GRID_SIZE * GRID_SIZE);
    expect(new Set(order.map(([x, y]) => `${x},${y}`)).size).toBe(GRID_SIZE * GRID_SIZE);
  });

  it("初期状態：道路 floor(10/5)=2、住宅8区画、役所なし", () => {
    const map = deriveMap(INITIAL_PARAMS, INITIAL_FACILITIES);
    expect(map.counts).toEqual({ office: 0, road: 2, residential: 8, market: 0, empty: 90 });
  });

  it("役所は中心に置かれ、道路→住宅→市場の順に外へ広がる", () => {
    const map = deriveMap({ ...INITIAL_PARAMS, infrastructure: 10 }, { ...INITIAL_FACILITIES, officeBuilt: true, housingUnits: 1, marketCount: 1 });
    const [[cx, cy] = [0, 0], second = [0, 0], , fourth = [0, 0], fifth = [0, 0]] = spiralOrder(GRID_SIZE);
    expect(map.tiles[cy]?.[cx]?.kind).toBe("office");
    expect(map.tiles[second[1]]?.[second[0]]?.kind).toBe("road");
    expect(map.tiles[fourth[1]]?.[fourth[0]]?.kind).toBe("residential");
    expect(map.tiles[fifth[1]]?.[fifth[0]]?.kind).toBe("market");
  });

  it("住宅区画数は端数を切り捨てる", () => {
    expect(deriveMap(INITIAL_PARAMS, { ...INITIAL_FACILITIES, housingUnits: 9.9 }).counts.residential).toBe(9);
  });

  it("空き地は常に MIN_EMPTY_TILES 以上残る", () => {
    const map = deriveMap({ ...INITIAL_PARAMS, infrastructure: 100 }, { ...INITIAL_FACILITIES, housingUnits: 200, officeBuilt: true, marketCount: 3 });
    expect(map.counts.empty).toBe(MIN_EMPTY_TILES);
    expect(map.counts.road).toBe(20);
    expect(map.counts.residential).toBe(GRID_SIZE * GRID_SIZE - MIN_EMPTY_TILES - 1 - 20);
  });

  it("空洞は見た目の道路を増やし、開示されると亀裂が付く", () => {
    const facilities = { ...INITIAL_FACILITIES, hollowInfrastructure: 6 };
    const hidden = deriveMap(INITIAL_PARAMS, facilities);
    expect(hidden.counts.road).toBe(3); // floor((10+6)/5)
    expect(hidden.tiles.flat().filter((t) => t.cracked)).toHaveLength(0);
    const disclosed = deriveMap(INITIAL_PARAMS, { ...facilities, hollowDisclosed: true });
    expect(disclosed.tiles.flat().filter((t) => t.cracked)).toHaveLength(1);
  });
});
