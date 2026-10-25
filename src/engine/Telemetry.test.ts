import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { DecreeIntent } from "../domain/DecreeIntent";
import { fixedLLMLayer } from "../test/fixtures";
import { targetUsageOf } from "./Telemetry";
import { newGame, playTurn } from "./TurnMachine";

// 建物種別の使用（v3.2 §3.2）は TurnRecord から取り出す

/** 側近の歪みが起きなかった年の記録（歪みがあると target が変わるため、seed を変えて探す） */
const recordOf = async (intent: Partial<DecreeIntent>) => {
  for (let seed = 1; seed < 50; seed++) {
    const state = await Effect.runPromise(
      playTurn(newGame(seed), { text: "勅", tags: [] }, null).pipe(Effect.provide(fixedLLMLayer(intent, seed))),
    );
    const record = state.history.at(-1);
    if (record && (record.aideAdjustment?.distortions.length ?? 0) === 0) return record;
  }
  throw new Error("歪みのない年が見つからない");
};

describe("target.used の材料", () => {
  it("歪み後の target で数える", async () => {
    const swapped = await (async () => {
      for (let seed = 1; seed < 50; seed++) {
        const state = await Effect.runPromise(
          playTurn(newGame(seed), { text: "勅", tags: [] }, null).pipe(Effect.provide(fixedLLMLayer({ target: "courthouse" }, seed))),
        );
        const record = state.history.at(-1);
        if (record?.aideAdjustment?.distortions.some((d) => d.kind === "targetSwap")) return record;
      }
      return null;
    })();
    if (!swapped) throw new Error("取り違えの年が見つからない");
    expect(targetUsageOf(swapped)[0]?.target).toBe(swapped.aideAdjustment?.adjustedIntent.target);
  });

  it("発注・前提未達・政策・無効を区別する", async () => {
    expect(targetUsageOf(await recordOf({ target: "well", magnitude: 10 }))).toEqual([{ target: "well", outcome: "ordered", count: 1 }]);
    expect(targetUsageOf(await recordOf({ target: "courthouse", magnitude: 10 }))).toEqual([{ target: "courthouse", outcome: "failed", count: 0 }]);
    expect(targetUsageOf(await recordOf({ action: "tax", target: "tax_rate", magnitude: 30 }))).toEqual([{ target: "tax_rate", outcome: "policy", count: 0 }]);
    expect(targetUsageOf(await recordOf({ action: "reform", target: "market", magnitude: 30 }))).toEqual([{ target: "market", outcome: "noop", count: 0 }]);
    expect(targetUsageOf(await recordOf({ target: null }))).toEqual([]);
  });
});
