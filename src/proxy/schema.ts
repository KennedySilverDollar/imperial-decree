import { BUDGET_MIN, CONFIDENCE_MAX, CONFIDENCE_MIN, MAGNITUDE_MAX, MAGNITUDE_MIN } from "../domain/constants";
import { ACTIONS, TARGETS } from "../domain/Vocabulary";

// Structured Outputs の JSON Schema（SPEC §11.2 / A-03）。プロキシ側で固定し、リクエストからは受け取らない。
// 語彙は domain/Vocabulary を唯一の出所にする。
// minimum/maximum は Mistral の対応が未確認（DECISIONS §4.1）のため既定では付けず、範囲はクライアントで clamp する（P-03）。

export const DECREE_INTENT_SCHEMA_NAME = "decree_intent";

export const buildDecreeIntentSchema = (includeRanges: boolean) => ({
  type: "object",
  properties: {
    action: { type: "string", enum: [...ACTIONS] },
    target: { type: "string", enum: [...TARGETS] },
    magnitude: includeRanges ? { type: "number", minimum: MAGNITUDE_MIN, maximum: MAGNITUDE_MAX } : { type: "number" },
    budget: includeRanges ? { type: "number", minimum: BUDGET_MIN } : { type: "number" },
    confidence: includeRanges ? { type: "number", minimum: CONFIDENCE_MIN, maximum: CONFIDENCE_MAX } : { type: "number" },
  },
  required: ["action", "target", "magnitude", "budget", "confidence"],
  additionalProperties: false,
});
