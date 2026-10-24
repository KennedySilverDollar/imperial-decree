import { Effect, Either, Layer, ManagedRuntime } from "effect";
import type { Decree } from "../domain/Decree";
import type { GameState } from "../domain/GameState";
import type { IntentDeclaration } from "../domain/IntentDeclaration";
import { LLMServiceTemplateMock } from "../engine/MockLLM";
import { logKpi, type KpiEvent } from "../engine/Telemetry";
import { appoint, appointmentCandidates, dismiss, newGame, playTurn, type TurnError } from "../engine/TurnMachine";
import { LLMServiceProxy } from "../services/LLMServiceProxy";
import { LogServiceLocalStorage, readStoredLog } from "../services/LogService";
import { RngLive } from "../services/Rng";
import { SaveService, SaveServiceLocalStorage } from "../services/SaveService";

// UI と TurnMachine の橋渡し（CLAUDE.md §4-5）。UI はゲームロジックを持たず、ここを呼ぶだけ。
// 参謀：VITE_LLM_PROXY_URL と VITE_LLM_PROXY_TOKEN があればプロキシ経由の Mistral、なければモック（テンプレート解釈）。

const storage = window.localStorage;

const proxyUrl = import.meta.env.VITE_LLM_PROXY_URL;
const proxyToken = import.meta.env.VITE_LLM_PROXY_TOKEN;
export const llmMode: "proxy" | "mock" = proxyUrl && proxyToken ? "proxy" : "mock";

const llmLayer =
  proxyUrl && proxyToken ? LLMServiceProxy({ baseUrl: proxyUrl, token: proxyToken }) : LLMServiceTemplateMock;

const layer = Layer.mergeAll(
  llmLayer,
  // Rng の状態は playTurn が GameState.rngState から毎ターン復元するので、ここの seed は使われない
  RngLive(0),
  SaveServiceLocalStorage(storage),
  LogServiceLocalStorage(storage),
);

const runtime = ManagedRuntime.make(layer);

export type Result<A> = Either.Either<A, TurnError>;

/** 新しいゲームの seed。ゲーム内の乱数ではないので Rng を通さない（CLAUDE.md §4-3 の対象外） */
const freshSeed = (): number => crypto.getRandomValues(new Uint32Array(1))[0] ?? Date.now();

export const freshId = (): string => crypto.randomUUID();

export const gameApi = {
  load: (): Promise<GameState | null> =>
    runtime.runPromise(Effect.flatMap(SaveService, (save) => save.load).pipe(Effect.orElseSucceed(() => null))),

  start: (): Promise<GameState> => {
    const state = newGame(freshSeed());
    return runtime.runPromise(
      Effect.flatMap(SaveService, (save) => save.save(state)).pipe(
        Effect.orElse(() => Effect.void),
        Effect.as(state),
      ),
    );
  },

  play: (state: GameState, decree: Decree, intent: IntentDeclaration | null): Promise<Result<GameState>> =>
    runtime.runPromise(Effect.either(playTurn(state, decree, intent))),

  candidates: (state: GameState): Promise<readonly string[]> => runtime.runPromise(appointmentCandidates(state)),

  appoint: (state: GameState, candidateId: string): Promise<Result<GameState>> =>
    runtime.runPromise(Effect.either(appoint(state, candidateId))),

  dismiss: (state: GameState, aideId: string): Promise<Result<GameState>> =>
    runtime.runPromise(Effect.either(dismiss(state, aideId))),

  log: (event: KpiEvent): void => {
    runtime.runFork(logKpi(event));
  },

  /** 計測ログを JSON で書き出す（テスター用） */
  exportLog: (): string => JSON.stringify(readStoredLog(storage), null, 2),
};
