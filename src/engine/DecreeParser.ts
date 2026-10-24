import { Duration, Effect, Either, Schedule, Schema } from "effect";
import {
  BUDGET_MIN,
  CONFIDENCE_MAX,
  CONFIDENCE_MIN,
  DEFAULT_TEMPLATE_MAGNITUDE,
  LLM_BACKOFF_BASE_MS,
  LLM_MAX_RETRIES,
  LLM_TIMEOUT_MS,
  MAGNITUDE_MAX,
  MAGNITUDE_MIN,
  SCALE_TAG_MAGNITUDE,
  TEMPLATE_MATCH_CONFIDENCE,
} from "../domain/constants";
import { findTag, type Decree } from "../domain/Decree";
import type { DecreeIntent } from "../domain/DecreeIntent";
import { clamp } from "../domain/math";
import type { Interpretation, LLMFailureReason } from "../domain/TurnRecord";
import { ACTIONS, DEFAULT_ACTION_FOR_TARGET, isTarget, type Action, type Target } from "../domain/Vocabulary";
import { messages } from "../i18n/messages";
import { LLMError } from "../services/errors";
import { LLMService } from "../services/LLMService";
import { LogService } from "../services/LogService";

// 勅令 → DecreeIntent（SPEC §6.3 / §11.2 / CLAUDE.md §4-8, §4-10）。
// LLM（タイムアウト5秒・リトライ2回・指数バックオフ）→ 失敗時はテンプレートパーサー。

// --- メタ命令のサニタイズ（DECISIONS D-34） ---

const META_PATTERNS = messages.metaCommandPatterns.map((pattern) => new RegExp(pattern, "giu"));

export const sanitizeDecreeText = (text: string): { readonly text: string; readonly removed: boolean } => {
  let result = text;
  for (const pattern of META_PATTERNS) result = result.replace(pattern, "");
  return { text: result.trim(), removed: result !== text };
};

// --- LLM 出力の検証 ---

/** プロキシの固定スキーマ（P3）と同じ形。範囲は clamp で保証する（P-03） */
export const RawDecreeIntentSchema = Schema.Struct({
  action: Schema.Literal(...ACTIONS),
  target: Schema.String,
  magnitude: Schema.Finite,
  budget: Schema.Finite,
  confidence: Schema.Finite,
});

const decodeRaw = Schema.decodeUnknownEither(RawDecreeIntentSchema, { onExcessProperty: "error" });

export interface NormalizedIntent {
  readonly intent: DecreeIntent;
  readonly clampedFields: readonly string[];
}

export const normalizeRawIntent = (raw: typeof RawDecreeIntentSchema.Type): NormalizedIntent => {
  const clampedFields: string[] = [];
  const bounded = (field: string, value: number, min: number, max: number) => {
    const result = clamp(value, min, max);
    if (result !== value) clampedFields.push(field);
    return result;
  };
  return {
    intent: {
      action: raw.action,
      target: isTarget(raw.target) ? raw.target : null,
      magnitude: bounded("magnitude", raw.magnitude, MAGNITUDE_MIN, MAGNITUDE_MAX),
      budget: bounded("budget", raw.budget, BUDGET_MIN, Number.POSITIVE_INFINITY),
      confidence: bounded("confidence", raw.confidence, CONFIDENCE_MIN, CONFIDENCE_MAX),
    },
    clampedFields,
  };
};

/** LLM の生出力（JSON 文字列またはオブジェクト）を検証する */
export const decodeLLMOutput = (output: unknown): Either.Either<NormalizedIntent, LLMError> => {
  let value = output;
  if (typeof output === "string") {
    try {
      value = JSON.parse(output);
    } catch (error) {
      return Either.left(new LLMError({ reason: "invalidJson", detail: String(error) }));
    }
  }
  return decodeRaw(value).pipe(
    Either.mapLeft((error) => new LLMError({ reason: "schemaViolation", detail: String(error) })),
    Either.map(normalizeRawIntent),
  );
};

// --- テンプレートパーサー（DECISIONS D-35） ---

const findKeyword = <A>(text: string, table: readonly (readonly [string, A])[]): A | null =>
  table.find(([keyword]) => text.includes(keyword))?.[1] ?? null;

const includesAny = (text: string, words: readonly string[]): boolean => words.some((word) => text.includes(word));

const DIGITS = /\d+/u;

export const templateParse = (decree: Decree, text: string): DecreeIntent => {
  const { parser } = messages;
  const target: Target | null = findTag(decree, "target")?.value ?? findKeyword(text, parser.targetKeywords);
  if (target === null) {
    return { action: "build", target: null, magnitude: 0, budget: 0, confidence: 0 };
  }
  const action: Action = findKeyword(text, parser.actionKeywords) ?? DEFAULT_ACTION_FOR_TARGET[target];
  const scaleTag = findTag(decree, "scale");
  const digits = DIGITS.exec(text);
  const base = scaleTag
    ? SCALE_TAG_MAGNITUDE[scaleTag.value]
    : digits
      ? Number(digits[0])
      : includesAny(text, parser.largeKeywords)
        ? SCALE_TAG_MAGNITUDE.large
        : includesAny(text, parser.smallKeywords)
          ? SCALE_TAG_MAGNITUDE.small
          : DEFAULT_TEMPLATE_MAGNITUDE;
  const sign = includesAny(text, parser.negativeKeywords) ? -1 : 1;
  return {
    action,
    target,
    magnitude: clamp(sign * base, MAGNITUDE_MIN, MAGNITUDE_MAX),
    budget: 0,
    confidence: TEMPLATE_MATCH_CONFIDENCE,
  };
};

// --- 本体 ---

const retrySchedule = Schedule.exponential(Duration.millis(LLM_BACKOFF_BASE_MS)).pipe(
  Schedule.intersect(Schedule.recurs(LLM_MAX_RETRIES)),
);

export const parseDecree = (decree: Decree): Effect.Effect<Interpretation, never, LLMService | LogService> =>
  Effect.gen(function* () {
    const llm = yield* LLMService;
    const logger = yield* LogService;
    const sanitized = sanitizeDecreeText(decree.text);

    // 試行ごとにサービスを呼び直す（Effect の再実行だけでは、先に作った結果が使い回されうる）
    const attempt = Effect.suspend(() => llm.parseDecree({ text: sanitized.text, tags: decree.tags })).pipe(
      Effect.timeoutFail({
        duration: Duration.millis(LLM_TIMEOUT_MS),
        onTimeout: () => new LLMError({ reason: "timeout" }),
      }),
      Effect.flatMap((output) => Either.match(decodeLLMOutput(output), { onLeft: Effect.fail, onRight: Effect.succeed })),
      Effect.tapError((error) => logger.log({ event: "llm.attemptFailed", data: { reason: error.reason } })),
    );

    const result = yield* Effect.either(Effect.retry(attempt, retrySchedule));
    if (Either.isRight(result)) {
      return {
        intent: result.right.intent,
        source: "llm",
        metaRemoved: sanitized.removed,
        clampedFields: result.right.clampedFields,
        fallbackReason: null,
      } satisfies Interpretation;
    }
    const reason: LLMFailureReason = result.left.reason;
    yield* logger.log({ event: "llm.fallback", data: { reason } });
    return {
      intent: templateParse(decree, sanitized.text),
      source: "template",
      metaRemoved: sanitized.removed,
      clampedFields: [],
      fallbackReason: reason,
    } satisfies Interpretation;
  });
