import type { Either } from "effect";
import type { Decree } from "../../domain/Decree";
import type { GameState } from "../../domain/GameState";
import type { IntentDeclaration } from "../../domain/IntentDeclaration";
import type { KpiEvent } from "../../engine/Telemetry";
import type { TurnError } from "../../engine/TurnMachine";

// 表現層からゲームロジック（TurnMachine）へ届く唯一の口。実装は runtime.ts（本番）とテスト用のもの。

export type Result<A> = Either.Either<A, TurnError>;

export interface GameApi {
  /** 参謀がプロキシ経由の LLM か、モック（テンプレート解釈）か */
  readonly llmMode: "proxy" | "mock";
  readonly load: () => Promise<GameState | null>;
  readonly start: () => Promise<GameState>;
  readonly play: (state: GameState, decree: Decree, intent: IntentDeclaration | null) => Promise<Result<GameState>>;
  readonly candidates: (state: GameState) => Promise<readonly string[]>;
  readonly appoint: (state: GameState, candidateId: string) => Promise<Result<GameState>>;
  readonly dismiss: (state: GameState, aideId: string) => Promise<Result<GameState>>;
  readonly log: (event: KpiEvent) => void;
  readonly exportLog: () => string;
}
