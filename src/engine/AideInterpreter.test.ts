import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { INITIAL_PARAMS, diffParams } from "../domain/GameState";
import { RngScripted } from "../services/Rng";
import { intentOf, merchant, steward } from "../test/fixtures";
import { buildAideReports, interpret } from "./AideInterpreter";

const run = <A>(effect: Effect.Effect<A, never, import("../services/Rng").Rng>, values: readonly number[]) =>
  Effect.runSync(effect.pipe(Effect.provide(RngScripted(values))));

describe("歪み（SPEC §6.4 / BALANCE §4.4）", () => {
  it("乱数が全て外れれば歪みなし", () => {
    const result = run(interpret([steward, merchant], intentOf()), []);
    expect(result).toMatchObject({ aideId: steward.id, reason: "specialty", distortions: [], effectFactor: 1 });
    expect(result?.accuracy).toBeCloseTo(0.9);
  });

  it("規模の誤読：確率 (1-accuracy) で ±30〜50%", () => {
    // 0.05 < 0.1 で発生、0.2 < 0.5 で過大側、randRange(0.3,0.5) に 0.5 → 0.4
    const result = run(interpret([steward], intentOf({ magnitude: 50 })), [0.05, 0.2, 0.5]);
    expect(result?.distortions).toEqual([{ kind: "misread", factor: 1.4, from: 50, to: 70 }]);
    expect(result?.adjustedIntent.magnitude).toBeCloseTo(70);
    const under = run(interpret([steward], intentOf({ magnitude: 50 })), [0.05, 0.7, 0]);
    expect(under?.adjustedIntent.magnitude).toBeCloseTo(35);
  });

  it("誤読の境界：乱数がちょうど確率と等しければ発生しない", () => {
    const result = run(interpret([steward], intentOf()), [0.1]);
    expect(result?.distortions).toEqual([]);
  });

  it("対象の取り違え：専門外のときだけ、同じ action の別 target へ", () => {
    // 代官が福祉投資（専門外、accuracy 0.7）：誤読なし(0.9) → 取り違え 0.1 < 0.15 → 先頭の road
    const result = run(interpret([steward], intentOf({ action: "invest", target: "welfare" })), [0.9, 0.1, 0]);
    expect(result?.distortions).toEqual([{ kind: "targetSwap", from: "welfare", to: "road" }]);
    expect(result?.adjustedIntent.target).toBe("road");
    // 専門一致なら取り違えの乱数を引かない
    const matched = run(interpret([steward], intentOf()), [0.9, 0]);
    expect(matched?.distortions).toEqual([]);
  });

  it("骨抜き：派閥対立のときだけ、効果半減", () => {
    // 商人が増税（商業派と対立）：誤読なし(0.9) → 骨抜き 0.5 < 0.6
    const result = run(interpret([merchant], intentOf({ action: "tax", target: "tax", magnitude: 30 })), [0.9, 0.5]);
    expect(result?.factionConflict).toBe(true);
    expect(result?.accuracy).toBeCloseTo(0.675);
    expect(result?.distortions).toEqual([{ kind: "waterDown", factor: 0.5 }]);
    expect(result?.effectFactor).toBe(0.5);
    const lucky = run(interpret([merchant], intentOf({ action: "tax", target: "tax", magnitude: 30 })), [0.9, 0.61]);
    expect(lucky?.effectFactor).toBe(1);
  });

  it("意味の取れない指示・任免は歪めない", () => {
    expect(run(interpret([steward], intentOf({ target: null })), [0])?.distortions).toEqual([]);
    expect(run(interpret([steward], intentOf({ action: "appoint" })), [0])?.distortions).toEqual([]);
  });

  it("側近がいなければ null", () => {
    expect(run(interpret([], intentOf()), [])).toBeNull();
  });
});

describe("側近報告（隠蔽・欠落・信頼）", () => {
  const delta = diffParams({ ...INITIAL_PARAMS, population: 115, treasury: 510, happiness: 47 }, INITIAL_PARAMS);
  const context = { delta, actingAideId: steward.id, executionNotes: [{ kind: "applied" } as const], metaRemoved: false, hollowInfrastructure: 0 };

  it("隠蔽：野心高・忠誠低の側近は悪化項目を報告から消す", () => {
    // 代官（隠蔽条件外）：3項目とも欠落なし。商人：隠蔽 0.1 < 0.4 → 改善項目（国庫）だけ欠落判定
    const { reports } = run(buildAideReports([steward, merchant], context), [0.99, 0.99, 0.99, 0.1, 0.99]);
    const [a, b] = reports;
    expect(a?.items.map((i) => i.param)).toEqual(["population", "treasury", "happiness"]);
    expect(a?.concealed).toBe(false);
    expect(b?.concealed).toBe(true);
    expect(b?.items.map((i) => i.param)).toEqual(["treasury"]);
    expect(b?.hiddenItems.map((i) => i.param)).toEqual(["population", "happiness"]);
  });

  it("欠落：能力が低いほど項目を落とす", () => {
    const { reports } = run(buildAideReports([steward], context), [0.99, 0.05, 0.99]);
    expect(reports[0]?.items.map((i) => i.param)).toEqual(["population", "happiness"]);
  });

  it("信頼が低いと報告は2項目まで", () => {
    const { reports } = run(buildAideReports([{ ...steward, trust: 30 }], context), []);
    expect(reports[0]?.items).toHaveLength(2);
  });

  it("担当側近の報告に執行メモ、能力70以上は空洞を開示する", () => {
    const { reports, hollowDisclosed } = run(
      buildAideReports([steward, merchant], { ...context, metaRemoved: true, hollowInfrastructure: 3 }),
      [],
    );
    expect(reports[0]?.notes).toEqual([{ kind: "metaIgnored" }, { kind: "execution", note: { kind: "applied" } }]);
    expect(reports[1]?.notes).toEqual([{ kind: "hollowDisclosed", amount: 3 }]);
    expect(hollowDisclosed).toBe(true);
  });
});
