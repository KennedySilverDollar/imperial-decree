import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  AIDE_SALARY,
  CORRUPTION_DRIFT_PER_TURN,
  CROWDING_HAPPINESS_PENALTY,
  INFRA_UPKEEP_PER_POINT,
  MARKET_COST,
  MARKET_MAX,
  OFFICE_COST,
  POPULATION_GROWTH_BASE,
  TAX_PER_CAPITA,
} from "../domain/constants";
import { INITIAL_FACILITIES, INITIAL_PARAMS } from "../domain/GameState";
import { RngScripted } from "../services/Rng";
import { intentOf } from "../test/fixtures";
import { clampParams, executeDecree, housingCapacity, naturalUpdate, type CityState } from "./RuleEngine";

const city: CityState = { params: INITIAL_PARAMS, facilities: INITIAL_FACILITIES };
const withParams = (params: Partial<CityState["params"]>): CityState => ({ ...city, params: { ...city.params, ...params } });

describe("勅令の効果（BALANCE §3）", () => {
  it("道路：規模50でインフラ+6、国庫-200", () => {
    const r = executeDecree(city, intentOf({ target: "road", magnitude: 50 }), 1);
    expect(r.params.infrastructure).toBeCloseTo(16);
    expect(r.params.treasury).toBeCloseTo(300);
    expect(r.execution.notes).toEqual([{ kind: "applied" }]);
  });

  it("井戸・住宅・福祉・治安", () => {
    expect(executeDecree(city, intentOf({ target: "well", magnitude: 50 }), 1).params).toMatchObject({ infrastructure: 13, happiness: 52.5, treasury: 350 });
    expect(executeDecree(city, intentOf({ target: "residential", magnitude: 50 }), 1).facilities.housingUnits).toBeCloseTo(11);
    expect(executeDecree(city, intentOf({ action: "invest", target: "welfare", magnitude: 50 }), 1).params.happiness).toBeCloseTo(57.5);
    const sec = executeDecree(city, intentOf({ action: "reform", target: "security", magnitude: 50 }), 1).params;
    expect(sec.corruption).toBeCloseTo(0);
    expect(sec.treasury).toBeCloseTo(400);
  });

  it("増税：国庫+、幸福度は magnitude に比例して減る（A-08）", () => {
    const r = executeDecree(city, intentOf({ action: "tax", target: "tax", magnitude: 50 }), 1);
    expect(r.params.treasury).toBeCloseTo(500 + 120 * 0.03 * 50);
    expect(r.params.happiness).toBeCloseTo(50 - 12.5);
  });

  it("減税：国庫-、幸福度+", () => {
    const r = executeDecree(city, intentOf({ action: "tax", target: "tax", magnitude: -50 }), 1);
    expect(r.params.treasury).toBeCloseTo(500 - 180);
    expect(r.params.happiness).toBeCloseTo(55);
  });

  it("action=tax は target を問わず税として扱う", () => {
    const r = executeDecree(city, intentOf({ action: "tax", target: "road", magnitude: 10 }), 1);
    expect(r.params.infrastructure).toBe(10);
    expect(r.params.treasury).toBeGreaterThan(500);
  });

  it("予算不足：国庫に合わせて規模を縮小（A-07）", () => {
    const r = executeDecree(withParams({ treasury: 100 }), intentOf({ target: "road", magnitude: 50 }), 1);
    expect(r.execution.scale).toBeCloseTo(0.5);
    expect(r.params.infrastructure).toBeCloseTo(13);
    expect(r.params.treasury).toBeCloseTo(0);
    expect(r.execution.notes).toContainEqual({ kind: "budgetScaled", ratio: 0.5, cause: "treasury" });
  });

  it("LLM の budget は上限として縮小に使う（D-08）", () => {
    const r = executeDecree(city, intentOf({ target: "road", magnitude: 50, budget: 50 }), 1);
    expect(r.execution.notes).toContainEqual({ kind: "budgetScaled", ratio: 0.25, cause: "budget" });
    expect(r.params.treasury).toBeCloseTo(450);
  });

  it("国庫が空なら何もできない", () => {
    const r = executeDecree(withParams({ treasury: 0 }), intentOf({ target: "road" }), 1);
    expect(r.execution.notes).toEqual([{ kind: "nothingAffordable" }]);
    expect(r.params).toEqual(withParams({ treasury: 0 }).params);
  });

  it("骨抜き：効果は半分、コストは全額、失われたインフラは空洞になる", () => {
    const r = executeDecree(city, intentOf({ target: "road", magnitude: 50 }), 0.5);
    expect(r.params.infrastructure).toBeCloseTo(13);
    expect(r.params.treasury).toBeCloseTo(300);
    expect(r.facilities.hollowInfrastructure).toBeCloseTo(3);
  });

  it("役所：条件（人口200・インフラ15・国庫400）を満たせば建つ。縮小はしない", () => {
    const ready = withParams({ population: 200, infrastructure: 15, treasury: 400 });
    const built = executeDecree(ready, intentOf({ target: "office" }), 1);
    expect(built.facilities.officeBuilt).toBe(true);
    expect(built.params.treasury).toBe(0);
    expect(executeDecree(city, intentOf({ target: "office" }), 1).execution.notes).toEqual([{ kind: "officeFailed", reason: "population" }]);
    expect(executeDecree(withParams({ population: 200 }), intentOf({ target: "office" }), 1).execution.notes).toEqual([{ kind: "officeFailed", reason: "infrastructure" }]);
    expect(executeDecree({ ...ready, params: { ...ready.params, treasury: OFFICE_COST - 1 } }, intentOf({ target: "office" }), 1).execution.notes).toEqual([{ kind: "officeFailed", reason: "treasury" }]);
    expect(executeDecree({ ...ready, facilities: { ...ready.facilities, officeBuilt: true } }, intentOf({ target: "office" }), 1).execution.notes).toEqual([{ kind: "officeFailed", reason: "alreadyBuilt" }]);
  });

  it("市場：固定コストで上限あり", () => {
    const r = executeDecree(city, intentOf({ target: "market" }), 1);
    expect(r.facilities.marketCount).toBe(1);
    expect(r.params.treasury).toBe(500 - MARKET_COST);
    const full = { ...city, facilities: { ...city.facilities, marketCount: MARKET_MAX } };
    expect(executeDecree(full, intentOf({ target: "market" }), 1).execution.notes).toEqual([{ kind: "marketFailed", reason: "max" }]);
  });

  it.each([
    [intentOf({ action: "appoint" }), "appointDismiss"],
    [intentOf({ target: null }), "unknownTarget"],
    [intentOf({ confidence: 0.29 }), "lowConfidence"],
    [intentOf({ action: "reform", target: "road" }), "invalidCombination"],
    [intentOf({ magnitude: -30 }), "nonPositive"],
  ] as const)("no-op：%o → %s", (intent, reason) => {
    const r = executeDecree(city, intent, 1);
    expect(r.execution.notes).toEqual([{ kind: "noop", reason }]);
    expect(r.params).toEqual(city.params);
  });
});

describe("自然変化（BALANCE §2）", () => {
  const step = (c: CityState, rolls: readonly number[] = [0.99]) =>
    Effect.runSync(naturalUpdate(c, 2).pipe(Effect.provide(RngScripted(rolls))));

  it("初期状態：人口は基本成長率で増え、国庫は税収-維持費、汚職は自然上昇", () => {
    const next = step(city);
    const population = Math.floor(120 * (1 + POPULATION_GROWTH_BASE) + 1e-9);
    expect(next.params.population).toBe(population);
    expect(next.params.treasury).toBeCloseTo(500 + population * TAX_PER_CAPITA * 0.95 - (10 * INFRA_UPKEEP_PER_POINT + 2 * AIDE_SALARY));
    expect(next.params.corruption).toBeCloseTo(5 + CORRUPTION_DRIFT_PER_TURN);
    expect(next.params.infrastructure).toBe(10);
  });

  it("インフラは確率で劣化する", () => {
    expect(step(city, [0.1]).params.infrastructure).toBe(9);
  });

  it("幸福度50未満で人口流出", () => {
    expect(step(withParams({ happiness: 30 })).params.population).toBe(Math.floor(120 * (1 - 0.08)));
  });

  it("住宅不足（人口>区画数×20）で増えず、流出し、幸福度が下がる（A-08）", () => {
    const crowded = withParams({ population: housingCapacity(INITIAL_FACILITIES) + 40 });
    const next = step(crowded);
    expect(next.params.population).toBe(160 + 40 - 6);
    expect(next.params.happiness).toBeLessThan(step(city).params.happiness - CROWDING_HAPPINESS_PENALTY + 0.5);
  });

  it("汚職>50 で毎ターン幸福度ペナルティ（A-08）", () => {
    const at50 = step(withParams({ corruption: 50 })).params.happiness;
    const over50 = step(withParams({ corruption: 51 })).params.happiness;
    expect(at50 - over50).toBeCloseTo(3 + 0.1 * 0.2, 5);
  });

  it("空洞は毎ターン1ずつ消え、0になると開示も解ける", () => {
    const next = step({ ...city, facilities: { ...INITIAL_FACILITIES, hollowInfrastructure: 1, hollowDisclosed: true } });
    expect(next.facilities).toMatchObject({ hollowInfrastructure: 0, hollowDisclosed: false });
  });

  it("clamp：幸福度・インフラ・汚職は0〜100、人口は0以上の整数、国庫はそのまま", () => {
    expect(clampParams({ population: -3.5, treasury: -20, happiness: 120, infrastructure: -1, corruption: 101 })).toEqual({
      population: 0,
      treasury: -20,
      happiness: 100,
      infrastructure: 0,
      corruption: 100,
    });
  });
});
