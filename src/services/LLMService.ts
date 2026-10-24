import { Context, Effect, Layer } from "effect";
import type { DecreeTag } from "../domain/Decree";
import { LLMError } from "./errors";

// 参謀(LLM)サービス（SPEC §11.2 / A-09）。渡すのは勅令本文とタグのみで、GameState は渡さない。
// 返り値は未検証の生データ（JSON 文字列またはオブジェクト）。検証は DecreeParser が行う。
// 本番実装（プロキシ経由の fetch）は P3 で追加する。

export interface LLMRequest {
  readonly text: string;
  readonly tags: readonly DecreeTag[];
}

export interface LLMServiceShape {
  readonly parseDecree: (request: LLMRequest) => Effect.Effect<unknown, LLMError>;
}

export class LLMService extends Context.Tag("LLMService")<LLMService, LLMServiceShape>() {}

/** 任意の応答関数からモックを作る */
export const LLMServiceMock = (respond: (request: LLMRequest) => Effect.Effect<unknown, LLMError>): Layer.Layer<LLMService> =>
  Layer.succeed(LLMService, { parseDecree: respond });

/** 常に使えない参謀（オフライン時・テンプレートパーサーのみで遊ぶ場合） */
export const LLMServiceUnavailable: Layer.Layer<LLMService> = LLMServiceMock(() =>
  Effect.fail(new LLMError({ reason: "network", detail: "unavailable" })),
);
