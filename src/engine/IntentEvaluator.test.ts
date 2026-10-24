import { describe, expect, it } from "vitest";
import { INTENT_BONUS_HAPPINESS } from "../domain/constants";
import { INITIAL_PARAMS } from "../domain/GameState";
import { evaluateIntent } from "./IntentEvaluator";

const before = INITIAL_PARAMS;

describe("意図判定（D-03）とボーナス（A-01）", () => {
  it("宣言なしなら判定もボーナスもない", () => {
    expect(evaluateIntent(null, before, before)).toEqual({ evaluation: null, bonusHappiness: 0, params: before });
  });
  it("increase：変化量が目標以上で達成し、幸福度+5", () => {
    const after = { ...before, population: before.population + 20 };
    const outcome = evaluateIntent({ targetParam: "population", targetValue: 20, direction: "increase" }, before, after);
    expect(outcome.evaluation?.achieved).toBe(true);
    expect(outcome.evaluation?.measured).toBe(20);
    expect(outcome.bonusHappiness).toBe(INTENT_BONUS_HAPPINESS);
    expect(outcome.params.happiness).toBe(after.happiness + INTENT_BONUS_HAPPINESS);
  });
  it("increase：目標に届かなければ未達、ペナルティなし", () => {
    const after = { ...before, population: before.population + 8 };
    const outcome = evaluateIntent({ targetParam: "population", targetValue: 20, direction: "increase" }, before, after);
    expect(outcome.evaluation?.achieved).toBe(false);
    expect(outcome.params).toEqual(after);
  });
  it("decrease：減少量で判定", () => {
    const after = { ...before, corruption: before.corruption - 3 };
    expect(evaluateIntent({ targetParam: "corruption", targetValue: 3, direction: "decrease" }, before, after).evaluation?.achieved).toBe(true);
    expect(evaluateIntent({ targetParam: "corruption", targetValue: 4, direction: "decrease" }, before, after).evaluation?.achieved).toBe(false);
  });
  it("absolute：到達値で判定", () => {
    const after = { ...before, treasury: 600 };
    expect(evaluateIntent({ targetParam: "treasury", targetValue: 600, direction: "absolute" }, before, after).evaluation?.achieved).toBe(true);
    expect(evaluateIntent({ targetParam: "treasury", targetValue: 601, direction: "absolute" }, before, after).evaluation?.achieved).toBe(false);
  });
  it("ボーナスは幸福度100で頭打ち", () => {
    const after = { ...before, happiness: 98, population: 200 };
    const outcome = evaluateIntent({ targetParam: "population", targetValue: 1, direction: "increase" }, before, after);
    expect(outcome.params.happiness).toBe(100);
    expect(outcome.bonusHappiness).toBe(2);
  });
});
