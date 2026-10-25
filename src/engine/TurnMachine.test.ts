import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { BUILDINGS } from "../domain/Buildings";
import {
  DECREE_BASE_COST,
  INITIAL_POLITICAL_CAPITAL,
  MAX_TURNS,
  NEWSPAPER_MAX_ARTICLES as MAX_ARTICLES,
  NEWSPAPER_MIN_ARTICLES as MIN_ARTICLES,
  POLITICAL_CAPITAL_MAX,
} from "../domain/constants";
import type { Decree } from "../domain/Decree";
import type { DecreeIntent } from "../domain/DecreeIntent";
import type { GameState } from "../domain/GameState";
import { GameOverError, ValidationError } from "../services/errors";
import { LLMServiceMock, LLMServiceUnavailable } from "../services/LLMService";
import { makeSaveServiceInMemory, SaveService } from "../services/SaveService";
import { baseLayer, fixedLLMLayer, intentOf } from "../test/fixtures";
import { renderNewspaper } from "./Newspaper";
import { buildThreeTierView, renderThreeTier } from "./ResultView";
import { buildCountFor } from "./RuleEngine";
import { appoint, appointmentCandidates, dismiss, newGame, playTurn } from "./TurnMachine";

const decree: Decree = { text: "道を造れ", tags: [] };

const runTurns = (seed: number, turns: number, intents: readonly Partial<DecreeIntent>[] = [{}]) => {
  let i = 0;
  const llm = LLMServiceMock(() => Effect.sync(() => intentOf(intents[i++ % intents.length])));
  const layer = Layer.merge(llm, baseLayer(seed));
  return Effect.runPromise(
    Effect.gen(function* () {
      let state = newGame(seed);
      for (let t = 0; t < turns && state.ending === null; t++) state = yield* playTurn(state, decree, null);
      return state;
    }).pipe(Effect.provide(layer)),
  );
};

const playOnce = (state: GameState, input: Decree = decree, intent: Partial<DecreeIntent> = {}) =>
  Effect.runPromise(Effect.either(playTurn(state, input, null)).pipe(Effect.provide(fixedLLMLayer(intent))));

const mixed: Partial<DecreeIntent>[] = [
  { target: "road", magnitude: 40 },
  { action: "tax", target: "tax_rate", magnitude: 30 },
  { action: "invest", target: "welfare_policy", magnitude: 30 },
  { target: "residential", magnitude: 40 },
];

describe("seed 再現性（CLAUDE.md §4-3）", () => {
  it("同じ seed・同じ入力・同じ LLM 出力なら完全に同じ結果", async () => {
    const a = await runTurns(42, 20, mixed);
    const b = await runTurns(42, 20, mixed);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("seed が違えば結果が変わる", async () => {
    const a = await runTurns(1, 20, mixed);
    const b = await runTurns(2, 20, mixed);
    expect(JSON.stringify(a.params)).not.toBe(JSON.stringify(b.params));
  });

  it("途中で保存・復元しても続きは同じになる", async () => {
    const full = await runTurns(7, 10, mixed);
    const half = await runTurns(7, 5, mixed);
    const restored = JSON.parse(JSON.stringify(half)) as GameState;
    let i = 5;
    const llm = LLMServiceMock(() => Effect.sync(() => intentOf(mixed[i++ % mixed.length])));
    const resumed = await Effect.runPromise(
      Effect.gen(function* () {
        let state = restored;
        for (let t = 0; t < 5; t++) state = yield* playTurn(state, decree, null);
        return state;
      }).pipe(Effect.provide(Layer.merge(llm, baseLayer(999)))),
    );
    expect(JSON.stringify(resumed)).toBe(JSON.stringify(full));
  });
});

describe("playTurn", () => {
  it("政治資本：勅令で-1、収入+1、上限5（A-01）", async () => {
    const one = await runTurns(1, 1);
    expect(one.politicalCapital).toBe(INITIAL_POLITICAL_CAPITAL);
    const capped = await playOnce({ ...newGame(1), politicalCapital: POLITICAL_CAPITAL_MAX });
    expect(capped._tag === "Right" && capped.right.politicalCapital).toBe(POLITICAL_CAPITAL_MAX);
  });

  it("政治資本が足りなければ発行できない", async () => {
    const result = await playOnce({ ...newGame(1), politicalCapital: 0 });
    expect(result._tag === "Left" && result.left).toEqual(new ValidationError({ issue: { kind: "noPoliticalCapital" } }));
  });

  it("文字数超過・不正な意図は ValidationError", async () => {
    const tooLong = await playOnce(newGame(1), { text: "道".repeat(41), tags: [] });
    expect(tooLong._tag === "Left" && tooLong.left._tag).toBe("ValidationError");
    const invalidIntent = await Effect.runPromise(
      Effect.either(playTurn(newGame(1), decree, { targetParam: "population", targetValue: 0, direction: "increase" })).pipe(
        Effect.provide(fixedLLMLayer()),
      ),
    );
    expect(invalidIntent._tag === "Left" && invalidIntent.left).toEqual(new ValidationError({ issue: { kind: "invalidIntent" } }));
  });

  it("終了後は GameOverError", async () => {
    const result = await playOnce({ ...newGame(1), ending: { kind: "timeout" } });
    expect(result._tag === "Left" && result.left).toEqual(new GameOverError());
  });

  it("勅令の基本コストが国庫から引かれ、記録に3段表示＋意図比較の材料が揃う", async () => {
    const state = await Effect.runPromise(
      playTurn(newGame(3), decree, { targetParam: "infrastructure", targetValue: 3, direction: "increase" }).pipe(Effect.provide(fixedLLMLayer())),
    );
    const record = state.history[0];
    if (!record) throw new Error("記録がない");
    expect(record.execution.cost).toBe(BUILDINGS.road.cost * buildCountFor(50));
    expect(record.execution.notes[0]).toMatchObject({ kind: "ordered", building: "road" });
    expect(record.interpretation?.source).toBe("llm");
    expect(record.aideAdjustment?.aideId).toBe("elderSteward");
    expect(record.aideAdjustment?.reason).toBe("specialty");
    expect(record.actualResult.infrastructure).toBeCloseTo(record.after.infrastructure - record.before.infrastructure);
    expect(record.before.treasury - DECREE_BASE_COST - record.execution.cost).toBeLessThan(record.after.treasury);

    const view = buildThreeTierView(record);
    expect(view.interpretation).toBe(record.interpretation);
    expect(view.correction.adjustment).toBe(record.aideAdjustment);
    expect(view.intentComparison?.evaluation.declaration.targetParam).toBe("infrastructure");

    const text = renderThreeTier(view);
    expect(text.interpretation.length).toBeGreaterThan(0);
    expect(text.correction.join()).toContain("老練な代官");
    expect(text.result.length).toBeGreaterThan(0);
    expect(text.intentComparison).not.toBeNull();
  });

  it("LLM が使えなくてもテンプレートで進む（CLAUDE.md §4-8）", async () => {
    const layer = Layer.merge(LLMServiceUnavailable, baseLayer());
    const state = await Effect.runPromise(playTurn(newGame(1), decree, null).pipe(Effect.provide(layer)));
    expect(state.history[0]?.interpretation).toMatchObject({ source: "template", fallbackReason: "network" });
    expect(state.params.infrastructure).toBeGreaterThan(newGame(1).params.infrastructure);
  });

  it("側近不在なら勅令は執行されず、政治資本も国庫も消費しない", async () => {
    const empty: GameState = { ...newGame(1), aides: [] };
    const result = await playOnce(empty);
    if (result._tag !== "Right") throw new Error("失敗した");
    const record = result.right.history[0];
    expect(record?.interpretation).toBeNull();
    expect(record?.execution.notes).toEqual([{ kind: "noAide" }]);
    expect(result.right.politicalCapital).toBe(Math.min(POLITICAL_CAPITAL_MAX, INITIAL_POLITICAL_CAPITAL + 1));
  });

  it("毎ターン保存される", async () => {
    const program = Effect.gen(function* () {
      const memory = yield* makeSaveServiceInMemory;
      const layer = Layer.mergeAll(fixedLLMLayer(), Layer.succeed(SaveService, memory.service));
      const state = yield* playTurn(newGame(1), decree, null).pipe(Effect.provide(layer));
      return { state, saved: yield* memory.service.load };
    });
    const { state, saved } = await Effect.runPromise(program);
    expect(saved).toEqual(state);
  });

  it("50ターンで必ず終わる", async () => {
    const state = await runTurns(5, MAX_TURNS + 5, [{ action: "invest", target: "welfare_policy", magnitude: 10 }]);
    expect(state.ending).not.toBeNull();
    expect(state.turn - 1).toBeLessThanOrEqual(MAX_TURNS);
  });

  it("新聞は毎年5〜7本、本文は空でなく、TurnRecord から真実度を取り出せる", async () => {
    const state = await runTurns(11, 15, mixed);
    for (const record of state.history) {
      const articles = record.newspaper.articles;
      expect(articles.length).toBeGreaterThanOrEqual(MIN_ARTICLES);
      expect(articles.length).toBeLessThanOrEqual(MAX_ARTICLES);
      for (const article of articles) {
        expect(article.body.join("").length).toBeGreaterThan(0);
        expect(article.truthfulness).toBeGreaterThanOrEqual(0);
        expect(article.truthfulness).toBeLessThanOrEqual(1);
      }
      expect(renderNewspaper(record.newspaper).articles).toHaveLength(articles.length);
      expect(record.derived.housingCapacity).toBeGreaterThanOrEqual(0);
    }
  });

  it("新聞の連載状態と直近テンプレートは GameState に保存される", async () => {
    const state = await runTurns(11, 6, mixed);
    expect(state.newspaperState.recentTemplates.length).toBeGreaterThan(0);
    for (const entry of state.newspaperState.recentTemplates) expect(entry.turn).toBeGreaterThanOrEqual(state.turn - 1 - 3);
  });
});

describe("任命/解任（SPEC §5.4 / A-01）", () => {
  const save = fixedLLMLayer();

  it("候補は2人で、現職を含まず、同じ状態なら同じ", async () => {
    const state = newGame(1);
    const a = await Effect.runPromise(appointmentCandidates(state));
    const b = await Effect.runPromise(appointmentCandidates(state));
    expect(a).toHaveLength(2);
    expect(a).toEqual(b);
    expect(a).not.toContain("elderSteward");
    expect(new Set(a).size).toBe(2);
  });

  it("候補の生成はゲームの乱数系列を消費しない", async () => {
    const state = newGame(1);
    await Effect.runPromise(appointmentCandidates(state));
    expect(state.rngState).toBe(newGame(1).rngState);
  });

  it("解任は無料、任命は政治資本1", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const dismissed = yield* dismiss(newGame(1), "youngMerchant");
        const [candidate] = yield* appointmentCandidates(dismissed);
        if (candidate === undefined) throw new Error("候補がいない");
        const appointed = yield* appoint(dismissed, candidate);
        return { dismissed, appointed, candidate };
      }).pipe(Effect.provide(save)),
    );
    expect(result.dismissed.politicalCapital).toBe(INITIAL_POLITICAL_CAPITAL);
    expect(result.dismissed.aides.map((a) => a.id)).toEqual(["elderSteward"]);
    expect(result.appointed.politicalCapital).toBe(INITIAL_POLITICAL_CAPITAL - 1);
    expect(result.appointed.aides.map((a) => a.id)).toEqual(["elderSteward", result.candidate]);
    expect(result.appointed.aides[1]?.appointedTurn).toBe(1);
  });

  it("定員超過・候補外・政治資本不足・不在の解任は ValidationError", async () => {
    const run = <A, E>(effect: Effect.Effect<A, E, SaveService>) => Effect.runPromise(Effect.either(effect).pipe(Effect.provide(save)));
    const state = newGame(1);
    const [candidate = ""] = await Effect.runPromise(appointmentCandidates(state));
    const full = await run(appoint(state, candidate));
    expect(full._tag === "Left" && full.left).toEqual(new ValidationError({ issue: { kind: "aidesFull" } }));
    const one: GameState = { ...state, aides: state.aides.slice(0, 1) };
    const outsider = await run(appoint(one, "youngMerchant"));
    expect(outsider._tag === "Left" && outsider.left).toEqual(new ValidationError({ issue: { kind: "unknownCandidate" } }));
    const [c = ""] = await Effect.runPromise(appointmentCandidates(one));
    const broke = await run(appoint({ ...one, politicalCapital: 0 }, c));
    expect(broke._tag === "Left" && broke.left).toEqual(new ValidationError({ issue: { kind: "noPoliticalCapital" } }));
    const ghost = await run(dismiss(state, "nobody"));
    expect(ghost._tag === "Left" && ghost.left).toEqual(new ValidationError({ issue: { kind: "unknownAide" } }));
  });
});
