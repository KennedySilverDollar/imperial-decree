import { Duration, Effect, Layer } from "effect";
import { LLM_MOCK_DELAY_MS } from "../domain/constants";
import { LLMService } from "../services/LLMService";
import { templateParse } from "./DecreeParser";

// P2 用のモック参謀：テンプレートパーサーの解釈を「LLM の出力」として返す（P3 でプロキシ経由の本番に置き換える）。
// 本番と同じくスキーマ検証を通るよう、プレーンな JSON 形のオブジェクトを返す。
export const LLMServiceTemplateMock: Layer.Layer<LLMService> = Layer.succeed(LLMService, {
  parseDecree: (request) =>
    Effect.sleep(Duration.millis(LLM_MOCK_DELAY_MS)).pipe(
      Effect.as(templateParse({ text: request.text, tags: request.tags }, request.text)),
      Effect.map((intent) => ({ ...intent, target: intent.target ?? "unknown" })),
    ),
});
