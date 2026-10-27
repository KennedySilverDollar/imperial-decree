// UI のテスト用の GameApi：本物の TurnMachine を、モックの参謀とメモリのセーブで動かす（ロジックは変えない）。
import { Effect, Layer } from "effect";
import type { Decree } from "../domain/Decree";
import type { GameState } from "../domain/GameState";
import type { IntentDeclaration } from "../domain/IntentDeclaration";
import { LLMServiceTemplateMock } from "../engine/MockLLM";
import type { KpiEvent } from "../engine/Telemetry";
import { appoint, appointmentCandidates, dismiss, newGame, playTurn } from "../engine/TurnMachine";
import type { GameApi } from "../ui/game/GameApi";
import { baseLayer } from "./fixtures";

const layer = Layer.merge(LLMServiceTemplateMock, baseLayer());

/** 勅令を n 年分出した状態（UI を通さず、TurnMachine で直接進める） */
export const playedState = async (seed: number, decrees: readonly string[]): Promise<GameState> => {
  let state = newGame(seed);
  for (const text of decrees) {
    const next = await Effect.runPromise(Effect.either(playTurn(state, { text, tags: [] }, null)).pipe(Effect.provide(layer)));
    if (next._tag === "Left") throw new Error(`勅令「${text}」が通らない: ${next.left._tag}`);
    state = next.right;
  }
  return state;
};

export interface TestGameApi extends GameApi {
  readonly logged: KpiEvent[];
}

export const makeTestGameApi = (opts: { readonly seed?: number; readonly saved?: GameState | null } = {}): TestGameApi => {
  const logged: KpiEvent[] = [];
  const run = <A, E>(effect: Effect.Effect<A, E, never>) => Effect.runPromise(Effect.either(effect));
  return {
    llmMode: "mock",
    logged,
    load: async () => opts.saved ?? null,
    start: async () => newGame(opts.seed ?? 1),
    play: (state: GameState, decree: Decree, intent: IntentDeclaration | null) => run(playTurn(state, decree, intent).pipe(Effect.provide(layer))),
    candidates: (state: GameState) => Effect.runPromise(appointmentCandidates(state)),
    appoint: (state: GameState, id: string) => run(appoint(state, id).pipe(Effect.provide(layer))),
    dismiss: (state: GameState, id: string) => run(dismiss(state, id).pipe(Effect.provide(layer))),
    log: (event: KpiEvent) => void logged.push(event),
    exportLog: () => JSON.stringify(logged),
  };
};
