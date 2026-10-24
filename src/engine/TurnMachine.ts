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
import { validateDecree, type Decree } from "../domain/Decree";
import { determineEnding } from "../domain/Ending";
import { createInitialState, diffParams, type GameState } from "../domain/GameState";
import { isValidIntentDeclaration, type IntentDeclaration } from "../domain/IntentDeclaration";
import { deriveSeed } from "../domain/Prng";
import type { AideAdjustment, Execution, Interpretation, TurnRecord } from "../domain/TurnRecord";
import { GameOverError, SaveError, ValidationError } from "../services/errors";
import type { LLMService } from "../services/LLMService";
import type { LogService } from "../services/LogService";
import { makeRng, random, Rng } from "../services/Rng";
import { SaveService } from "../services/SaveService";
import { buildAideReports, interpret } from "./AideInterpreter";
import { parseDecree } from "./DecreeParser";
import { evaluateIntent } from "./IntentEvaluator";
import { generateNewspaper } from "./Newspaper";
import { clampParams, executeDecree, naturalUpdate, type CityState } from "./RuleEngine";

// ターン状態機械（SPEC §11.5 / DECISIONS D-15）。UI はここだけを呼ぶ（CLAUDE.md §4-5）。

export const newGame = (seed: number): GameState => createInitialState(seed);

export type TurnError = ValidationError | GameOverError | SaveError;
export type TurnServices = LLMService | LogService | Rng | SaveService;

const NO_EXECUTION: Execution = { notes: [{ kind: "noAide" }], cost: 0, scale: 1, hollowAdded: 0 };

const ensureNotEnded = (state: GameState): Effect.Effect<void, GameOverError> =>
  state.ending === null ? Effect.void : Effect.fail(new GameOverError());

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
    let city: CityState = { params: state.params, facilities: state.facilities };
    let politicalCapital = state.politicalCapital;
    let interpretation: Interpretation | null = null;
    let adjustment: AideAdjustment | null = null;
    let execution = NO_EXECUTION;

    // 側近不在なら勅令は執行されず、政治資本・国庫も消費しない（DECISIONS D-21）
    if (hasAide) {
      // ③ コスト ④⑤ 解釈 ⑥ 側近選択・歪み ⑦ 執行
      politicalCapital -= DECREE_POLITICAL_COST;
      city = { ...city, params: { ...city.params, treasury: city.params.treasury - DECREE_BASE_COST } };
      interpretation = yield* parseDecree(decree);
      adjustment = yield* interpret(state.aides, interpretation.intent);
      if (adjustment !== null) {
        const result = executeDecree(city, adjustment.adjustedIntent, adjustment.effectFactor);
        city = { params: result.params, facilities: result.facilities };
        execution = result.execution;
      }
    }

    // ⑧ 自然変化 ⑨ clamp ⑩ 意図判定・ボーナス
    city = yield* naturalUpdate(city, state.aides.length);
    const settled = clampParams(city.params);
    const intentOutcome = evaluateIntent(intentDeclaration, before, settled);
    const after = intentOutcome.params;
    const actualResult = diffParams(after, before);

    // ⑫ 側近報告（空洞の開示を含む）
    const reports = yield* buildAideReports(state.aides, {
      delta: actualResult,
      actingAideId: adjustment?.aideId ?? null,
      executionNotes: execution.notes,
      metaRemoved: interpretation?.metaRemoved ?? false,
      hollowInfrastructure: city.facilities.hollowInfrastructure,
    });
    const facilities = {
      ...city.facilities,
      hollowDisclosed: city.facilities.hollowDisclosed || reports.hollowDisclosed,
    };

    // ⑬ エンディング判定 ⑫ 新聞
    const ending = determineEnding(after, facilities, state.turn);
    const newspaper = yield* generateNewspaper(state.turn, before, after, ending);

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
      facilitiesBefore: state.facilities,
      facilitiesAfter: facilities,
      intentEvaluation: intentOutcome.evaluation,
      bonusHappiness: intentOutcome.bonusHappiness,
      newspaper,
      aideReports: reports.reports,
      ending,
    };

    // ⑭ 政治資本収入 ⑮ ターン送り・保存
    const next: GameState = {
      ...state,
      rngState: yield* rng.getState,
      turn: state.turn + 1,
      stage: ending?.kind === "success" ? "town" : state.stage,
      params: after,
      facilities,
      politicalCapital: Math.min(POLITICAL_CAPITAL_MAX, politicalCapital + POLITICAL_CAPITAL_INCOME),
      history: [...state.history, record],
      ending,
    };
    const saver = yield* SaveService;
    yield* saver.save(next);
    return next;
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
