import { Effect } from "effect";
import { ALL_AIDE_PROFILES, makeAide } from "../domain/Aide";
import {
  APPOINT_CANDIDATE_COUNT,
  APPOINT_POLITICAL_COST,
  DECREE_BASE_COST,
  DECREE_POLITICAL_COST,
  DISMISS_POLITICAL_COST,
  MAX_AIDES,
  POLITICAL_CAPITAL_INCOME,
  POLITICAL_CAPITAL_MAX,
} from "../domain/constants";
import { projectDemand, remainingTurns } from "../domain/Construction";
import { validateDecree, type Decree } from "../domain/Decree";
import { laborForce } from "../domain/DerivedStats";
import { determineEnding } from "../domain/Ending";
import { createInitialState, diffParams, type GameState } from "../domain/GameState";
import { isValidIntentDeclaration, type IntentDeclaration } from "../domain/IntentDeclaration";
import { deriveSeed } from "../domain/Prng";
import type { AideAdjustment, EventNote, Execution, Interpretation, TurnRecord } from "../domain/TurnRecord";
import type { BuildingId } from "../domain/Vocabulary";
import { GameOverError, SaveError, ValidationError } from "../services/errors";
import type { LLMService } from "../services/LLMService";
import type { LogService } from "../services/LogService";
import { makeRng, random, Rng } from "../services/Rng";
import { SaveService } from "../services/SaveService";
import { buildAideReports, interpret, type ProjectEstimate } from "./AideInterpreter";
import { parseDecree } from "./DecreeParser";
import { adminBonusOf, derivedOf } from "./DerivedCalculator";
import { evaluateIntent } from "./IntentEvaluator";
import { generateNewspaper } from "./NewspaperGenerator";
import { clampParams, executeDecree, naturalUpdate } from "./RuleEngine";

// ターン状態機械（SPEC §11.5 / DECISIONS D-15 ＋ v3.2/v3.3）。UI はここだけを呼ぶ（CLAUDE.md §4-5）。

export const newGame = (seed: number): GameState => createInitialState(seed);

export type TurnError = ValidationError | GameOverError | SaveError;
export type TurnServices = LLMService | LogService | Rng | SaveService;

const NO_EXECUTION: Execution = { notes: [{ kind: "noAide" }], cost: 0, baseCostCharged: false };

const ensureNotEnded = (state: GameState): Effect.Effect<void, GameOverError> =>
  state.ending === null ? Effect.void : Effect.fail(new GameOverError());

/** 工事中の案件の、今の割り振りが続いたときの残り年数（側近の見積りの元。Z-03） */
const projectEstimates = (state: GameState): ProjectEstimate[] => {
  const labor = laborForce(state.params.population);
  const total = state.projects.reduce((sum, p) => sum + projectDemand(p), 0);
  return state.projects.map((p) => {
    const share = total <= labor ? projectDemand(p) : (labor * projectDemand(p)) / Math.max(1, total);
    return { building: p.kind, count: p.count, trueTurns: remainingTurns(p, share) };
  });
};

export const playTurn = (
  state: GameState,
  decree: Decree,
  intentDeclaration: IntentDeclaration | null,
): Effect.Effect<GameState, TurnError, TurnServices> =>
  Effect.gen(function* () {
    // ① エンディング確認 ② 検証
    yield* ensureNotEnded(state);
    const issue = validateDecree(decree);
    if (issue !== null) return yield* Effect.fail(new ValidationError({ issue }));
    if (intentDeclaration !== null && !isValidIntentDeclaration(intentDeclaration)) {
      return yield* Effect.fail(new ValidationError({ issue: { kind: "invalidIntent" } }));
    }
    const hasAide = state.aides.length > 0;
    if (hasAide && state.politicalCapital < DECREE_POLITICAL_COST) {
      return yield* Effect.fail(new ValidationError({ issue: { kind: "noPoliticalCapital" } }));
    }

    const rng = yield* Rng;
    yield* rng.setState(state.rngState);

    const before = state.params;
    let current: GameState = state;
    let politicalCapital = state.politicalCapital;
    let interpretation: Interpretation | null = null;
    let adjustment: AideAdjustment | null = null;
    let execution = NO_EXECUTION;
    const events: EventNote[] = [];

    // 側近不在なら勅令は執行されず、政治資本・国庫も消費しない（DECISIONS D-21）
    if (hasAide) {
      // ③ 政治資本 ④⑤ 解釈 ⑥ 側近選択・歪み（行政能力で精度が上がる。X-06） ⑦ 発注・政策
      politicalCapital -= DECREE_POLITICAL_COST;
      interpretation = yield* parseDecree(decree);
      adjustment = yield* interpret(state.aides, interpretation.intent, adminBonusOf(state));
      if (adjustment !== null) {
        const outcome = executeDecree(current, adjustment.adjustedIntent, adjustment.effectFactor);
        current = outcome.state;
        execution = outcome.execution;
        if (outcome.eventNote) events.push(outcome.eventNote);
        // 勅令の基本コストは、執行されたときだけ取る（W-11）
        if (execution.baseCostCharged) {
          current = { ...current, params: { ...current.params, treasury: current.params.treasury - DECREE_BASE_COST } };
        }
      }
    }

    // ⑧ 自然変化（工事・人口・税・幸福・資材・政策・イベント） ⑨ clamp ⑩ 意図判定・ボーナス
    const natural = yield* naturalUpdate(current, state.aides.length);
    events.push(...natural.events);
    const settled = clampParams(natural.state.params);
    const intentOutcome = evaluateIntent(intentDeclaration, before, settled);
    const after = intentOutcome.params;
    const actualResult = diffParams(after, before);
    let next: GameState = { ...natural.state, params: after };

    // ⑪ 側近報告（工期の見積り・資材・空洞の開示を含む）
    const undisclosedHollow: Partial<Record<BuildingId, number>> = {};
    for (const b of next.buildings) if (b.hollow && !b.disclosed) undisclosedHollow[b.kind] = (undisclosedHollow[b.kind] ?? 0) + 1;
    const reports = yield* buildAideReports(state.aides, {
      delta: actualResult,
      actingAideId: adjustment?.aideId ?? null,
      executionNotes: execution.notes,
      metaRemoved: interpretation?.metaRemoved ?? false,
      undisclosedHollow,
      projects: projectEstimates(next),
      completions: natural.construction.completions,
      materialShortage: natural.construction.materialShortage,
      overload: natural.construction.overload,
      events,
    });
    // 新聞は開示前の建物で作る（同じ年に「投書が匂わせ、能力の高い側近が言及する」三角測量。v3.2 §1.8）
    const buildingsBeforeDisclosure = next.buildings;
    const disclosed = new Set(reports.disclosedKinds);
    next = { ...next, buildings: next.buildings.map((b) => (b.hollow && disclosed.has(b.kind) ? { ...b, disclosed: true } : b)) };

    // ⑫ エンディング判定 ⑬ 新聞（決定論、本系列の Rng を使わない）
    const derived = derivedOf(next);
    const ending = determineEnding(after, next.buildings.some((b) => b.kind === "office"), state.turn);
    const previousRevenue = state.history.at(-1)?.finance.taxRevenue ?? null;
    const news = yield* generateNewspaper({
      turn: state.turn,
      saveId: state.saveId,
      before,
      after,
      derived,
      buildings: buildingsBeforeDisclosure,
      projects: next.projects,
      completed: natural.construction.completions.filter((c) => !c.repair).map((c) => c.building),
      aides: next.aides,
      event: next.event,
      materialShortage: natural.construction.materialShortage,
      overload: natural.construction.overload,
      taxRevenue: natural.taxRevenue,
      previousTaxRevenue: previousRevenue,
      state: state.newspaperState,
    });

    const record: TurnRecord = {
      turn: state.turn,
      decree,
      intentDeclaration,
      interpretation,
      aideAdjustment: adjustment,
      execution,
      before,
      after,
      actualResult,
      construction: natural.construction,
      events,
      derived,
      finance: { taxRevenue: natural.taxRevenue, upkeep: natural.upkeep },
      intentEvaluation: intentOutcome.evaluation,
      bonusHappiness: intentOutcome.bonusHappiness,
      newspaper: news.newspaper,
      aideReports: reports.reports,
      ending,
    };

    // ⑭ 政治資本収入 ⑮ ターン送り・保存
    const final: GameState = {
      ...next,
      rngState: yield* rng.getState,
      turn: state.turn + 1,
      stage: ending?.kind === "success" ? "town" : state.stage,
      newspaperState: news.state,
      politicalCapital: Math.min(POLITICAL_CAPITAL_MAX, politicalCapital + POLITICAL_CAPITAL_INCOME),
      history: [...state.history, record],
      ending,
    };
    const saver = yield* SaveService;
    yield* saver.save(final);
    return final;
  });

// --- 任命/解任（SPEC §5.4 / A-01 / DECISIONS D-22） ---

/**
 * そのターンの任命候補（2人）。本系列の乱数を消費しないよう、seed とターンから派生した Rng で選ぶ。
 * 同じ状態なら何度呼んでも同じ候補になる。
 */
export const appointmentCandidates = (state: GameState): Effect.Effect<readonly string[]> =>
  Effect.gen(function* () {
    const current = new Set(state.aides.map((aide) => aide.id));
    const pool = ALL_AIDE_PROFILES.filter((profile) => !current.has(profile.id)).map((profile) => profile.id);
    const chosen: string[] = [];
    while (chosen.length < APPOINT_CANDIDATE_COUNT && pool.length > 0) {
      const index = Math.floor((yield* random) * pool.length);
      const [id] = pool.splice(index, 1);
      if (id !== undefined) chosen.push(id);
    }
    return chosen;
  }).pipe(Effect.provideServiceEffect(Rng, makeRng(deriveSeed(state.seed, state.turn))));

export const appoint = (
  state: GameState,
  candidateId: string,
): Effect.Effect<GameState, ValidationError | GameOverError | SaveError, SaveService> =>
  Effect.gen(function* () {
    yield* ensureNotEnded(state);
    if (state.aides.length >= MAX_AIDES) return yield* Effect.fail(new ValidationError({ issue: { kind: "aidesFull" } }));
    if (state.politicalCapital < APPOINT_POLITICAL_COST) {
      return yield* Effect.fail(new ValidationError({ issue: { kind: "noPoliticalCapital" } }));
    }
    const candidates = yield* appointmentCandidates(state);
    const profile = ALL_AIDE_PROFILES.find((p) => p.id === candidateId);
    if (!candidates.includes(candidateId) || profile === undefined) {
      return yield* Effect.fail(new ValidationError({ issue: { kind: "unknownCandidate" } }));
    }
    const next: GameState = {
      ...state,
      aides: [...state.aides, makeAide(profile, state.turn)],
      politicalCapital: state.politicalCapital - APPOINT_POLITICAL_COST,
    };
    yield* (yield* SaveService).save(next);
    return next;
  });

export const dismiss = (
  state: GameState,
  aideId: string,
): Effect.Effect<GameState, ValidationError | GameOverError | SaveError, SaveService> =>
  Effect.gen(function* () {
    yield* ensureNotEnded(state);
    if (!state.aides.some((aide) => aide.id === aideId)) {
      return yield* Effect.fail(new ValidationError({ issue: { kind: "unknownAide" } }));
    }
    const next: GameState = {
      ...state,
      aides: state.aides.filter((aide) => aide.id !== aideId),
      politicalCapital: state.politicalCapital - DISMISS_POLITICAL_COST,
    };
    yield* (yield* SaveService).save(next);
    return next;
  });
