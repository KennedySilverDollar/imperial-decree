import { describe, expect, it } from "vitest";
import { MAX_TURNS } from "./constants";
import { determineEnding } from "./Ending";
import { INITIAL_FACILITIES, INITIAL_PARAMS, type Params } from "./GameState";

const built = { ...INITIAL_FACILITIES, officeBuilt: true };
const successParams: Params = { ...INITIAL_PARAMS, population: 300, infrastructure: 25 };

describe("エンディング判定（SPEC §7.2 / D-05, D-16, D-17）", () => {
  it("通常は null", () => {
    expect(determineEnding(INITIAL_PARAMS, INITIAL_FACILITIES, 1)).toBeNull();
  });
  it("人口0・国庫マイナス・幸福度0でゲームオーバー", () => {
    expect(determineEnding({ ...INITIAL_PARAMS, population: 0 }, INITIAL_FACILITIES, 1)).toEqual({ kind: "gameover", reason: "population" });
    expect(determineEnding({ ...INITIAL_PARAMS, treasury: -0.01 }, INITIAL_FACILITIES, 1)).toEqual({ kind: "gameover", reason: "treasury" });
    expect(determineEnding({ ...INITIAL_PARAMS, happiness: 0 }, INITIAL_FACILITIES, 1)).toEqual({ kind: "gameover", reason: "happiness" });
  });
  it("国庫ちょうど0は存続", () => {
    expect(determineEnding({ ...INITIAL_PARAMS, treasury: 0 }, INITIAL_FACILITIES, 1)).toBeNull();
  });
  it("ゲームオーバー同士は 人口 → 国庫 → 幸福度 の順", () => {
    expect(determineEnding({ ...INITIAL_PARAMS, population: 0, treasury: -1, happiness: 0 }, INITIAL_FACILITIES, 1)).toEqual({ kind: "gameover", reason: "population" });
    expect(determineEnding({ ...INITIAL_PARAMS, treasury: -1, happiness: 0 }, INITIAL_FACILITIES, 1)).toEqual({ kind: "gameover", reason: "treasury" });
  });
  it("成功条件：人口300・インフラ25・役所がすべて必要", () => {
    expect(determineEnding(successParams, built, 10)).toEqual({ kind: "success", stage: "town" });
    expect(determineEnding(successParams, INITIAL_FACILITIES, 10)).toBeNull();
    expect(determineEnding({ ...successParams, population: 299 }, built, 10)).toBeNull();
    expect(determineEnding({ ...successParams, infrastructure: 24.9 }, built, 10)).toBeNull();
  });
  it("勝敗が同時に成立したらゲームオーバー優先", () => {
    expect(determineEnding({ ...successParams, treasury: -1 }, built, 10)).toEqual({ kind: "gameover", reason: "treasury" });
  });
  it("50ターン目の処理後に未達なら時間切れ、成功が優先", () => {
    expect(determineEnding(INITIAL_PARAMS, INITIAL_FACILITIES, MAX_TURNS - 1)).toBeNull();
    expect(determineEnding(INITIAL_PARAMS, INITIAL_FACILITIES, MAX_TURNS)).toEqual({ kind: "timeout" });
    expect(determineEnding(successParams, built, MAX_TURNS)).toEqual({ kind: "success", stage: "town" });
  });
});
