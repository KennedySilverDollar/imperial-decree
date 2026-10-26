import { Effect, Either, Layer } from "effect";
import { LLM_TIMEOUT_MS } from "../domain/constants";
import type { Decree } from "../domain/Decree";
import { LLMService } from "../services/LLMService";
import { makeLLMServiceProxy } from "../services/LLMServiceProxy";
import { makeLogServiceMemory, LogService, type StoredLogEntry } from "../services/LogService";
import { decodeLLMOutput, parseDecree } from "./DecreeParser";

// AI（参謀）診断（デバッグ画面用）。フロント → プロキシ → Mistral の経路を段階ごとに切り分ける。
//   ① config   設定（URL・トークン・混在コンテンツ）
//   ② reach    サーバーに届くか（no-cors：CORS に関係なく「接続できるか」だけを見る）
//   ③ auth     わざと間違ったトークンで POST（401 が読めれば CORS・Origin 許可・トークン検査が働いている）
//   ④ call     本物のトークンで POST（プロキシ→Mistral の応答、所要時間、生の出力）
//   ⑤ validate ④の出力をゲームと同じスキーマ検証にかける
//   ⑥ pipeline ゲームと同じ経路（タイムアウト5秒・リトライ2回・テンプレートへのフォールバック）をそのまま走らせる
// 結果は「コード」と「事実（facts）」で返し、文言（原因の説明と対処）は i18n 側で付ける。

export type StepId = "config" | "reach" | "auth" | "call" | "validate" | "pipeline";
export const STEP_IDS: readonly StepId[] = ["config", "reach", "auth", "call", "validate", "pipeline"];

export type Verdict = "ok" | "warn" | "fail" | "skip";

export interface StepResult {
  readonly id: StepId;
  readonly verdict: Verdict;
  /** 原因の分類（i18n の hints を引く）。例: "reach.unreachable" */
  readonly code: string;
  readonly ms: number | null;
  /** 観測した事実。キーは i18n の facts を引く */
  readonly facts: Readonly<Record<string, string>>;
  /** 生の応答（あれば） */
  readonly raw: string | null;
}

export interface ProbeConfig {
  readonly baseUrl: string;
  readonly token: string;
  readonly fetch: typeof fetch;
  /** 画面を開いているページの Origin（例: http://localhost:5173） */
  readonly pageOrigin: string;
  readonly pageProtocol: string;
}

export const DIAGNOSTIC_ROUTE = "/v1/decree";
/** 診断1回の通信の上限。ゲームのタイムアウトより長く待ち、本当の所要時間を見せる */
export const PROBE_TIMEOUT_MS = LLM_TIMEOUT_MS * 3;
/** 認証の検査に使う、わざと間違ったトークン */
const WRONG_TOKEN = "debug-wrong-token";
const TOKEN_PREVIEW_CHARS = 2;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_TOO_MANY = 429;
const HTTP_SERVER_ERROR = 500;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

const endpoint = (baseUrl: string): string => `${baseUrl.replace(/\/$/, "")}${DIAGNOSTIC_ROUTE}`;

const result = (
  id: StepId,
  verdict: Verdict,
  code: string,
  ms: number | null,
  facts: Record<string, string> = {},
  raw: string | null = null,
): StepResult => ({ id, verdict, code, ms, facts, raw });

export const skipped = (id: StepId, because: StepId): StepResult => result(id, "skip", `${id}.skipped`, null, { because });

/** トークンは先頭の数文字と長さだけ（診断結果を共有しても漏れないように）。例: "ab…[24]" */
export const maskToken = (token: string): string =>
  token === "" ? "" : `${token.slice(0, TOKEN_PREVIEW_CHARS)}…[${token.length}]`;

const errorText = (error: unknown): string => (error instanceof Error ? `${error.name}: ${error.message}` : String(error));

const timed = async <A>(run: () => Promise<A>, now: () => number): Promise<{ value: A; ms: number }> => {
  const start = now();
  const value = await run();
  return { value, ms: Math.round(now() - start) };
};

const defaultNow = (): number => performance.now();

// --- ① 設定 ---

export const probeConfig = (cfg: ProbeConfig): StepResult => {
  const facts: Record<string, string> = {
    url: cfg.baseUrl,
    token: maskToken(cfg.token),
    pageOrigin: cfg.pageOrigin,
  };
  if (cfg.baseUrl.trim() === "") return result("config", "fail", "config.noUrl", null, facts);
  let parsed: URL;
  try {
    parsed = new URL(cfg.baseUrl);
  } catch {
    return result("config", "fail", "config.badUrl", null, facts);
  }
  if (cfg.token.trim() === "") return result("config", "fail", "config.noToken", null, facts);
  if (parsed.pathname.replace(/\/$/, "") !== "") {
    // ルート（/v1/decree）は自動で付くので、URL にパスを含めると二重になる
    return result("config", "warn", "config.hasPath", null, { ...facts, requestUrl: endpoint(cfg.baseUrl) });
  }
  if (cfg.pageProtocol === "https:" && parsed.protocol === "http:" && !LOCAL_HOSTS.has(parsed.hostname)) {
    return result("config", "fail", "config.mixedContent", null, facts);
  }
  return result("config", "ok", "config.ok", null, { ...facts, requestUrl: endpoint(cfg.baseUrl) });
};

// --- ② 到達 ---

export const probeReach = async (cfg: ProbeConfig, now = defaultNow): Promise<StepResult> => {
  try {
    // no-cors：応答は読めない（opaque）が、サーバーに接続できたかどうかは分かる
    const { ms } = await timed(
      () => cfg.fetch(endpoint(cfg.baseUrl), { method: "GET", mode: "no-cors", signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) }),
      now,
    );
    return result("reach", "ok", "reach.ok", ms);
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "TimeoutError";
    return result("reach", "fail", timedOut ? "reach.timeout" : "reach.unreachable", null, { error: errorText(error) });
  }
};

// --- ③ 認証・CORS ---

interface ProxyResponse {
  readonly status: number;
  readonly error: string | null;
  readonly output: string | null;
  readonly mode: string | null;
  readonly raw: string;
}

const post = async (cfg: ProbeConfig, token: string, body: unknown): Promise<ProxyResponse> => {
  const response = await cfg.fetch(endpoint(cfg.baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  const raw = await response.text();
  const json = ((): { error?: unknown; output?: unknown; mode?: unknown } | null => {
    try {
      return JSON.parse(raw) as { error?: unknown; output?: unknown; mode?: unknown } | null;
    } catch {
      return null;
    }
  })();
  return {
    status: response.status,
    error: typeof json?.error === "string" ? json.error : null,
    output: typeof json?.output === "string" ? json.output : null,
    mode: typeof json?.mode === "string" ? json.mode : null,
    raw,
  };
};

export const probeAuth = async (cfg: ProbeConfig, now = defaultNow): Promise<StepResult> => {
  try {
    const { value, ms } = await timed(() => post(cfg, WRONG_TOKEN, { text: "x", tags: [] }), now);
    const facts = { status: String(value.status), error: value.error ?? "" };
    if (value.status === HTTP_UNAUTHORIZED) return result("auth", "ok", "auth.ok", ms, facts, value.raw);
    if (value.status === HTTP_SERVER_ERROR && value.error === "proxy_misconfigured") {
      return result("auth", "fail", "auth.misconfigured", ms, facts, value.raw);
    }
    if (value.status === HTTP_FORBIDDEN) return result("auth", "fail", "auth.forbiddenOrigin", ms, facts, value.raw);
    if (value.status === HTTP_TOO_MANY) return result("auth", "warn", "auth.rateLimited", ms, facts, value.raw);
    // 間違ったトークンで通る＝トークン検査が働いていない
    if (value.status >= 200 && value.status < 300) return result("auth", "warn", "auth.open", ms, facts, value.raw);
    return result("auth", "warn", "auth.unexpected", ms, facts, value.raw);
  } catch (error) {
    // ②で届いているのにここで落ちる＝ブラウザが応答を読ませなかった（CORS）
    return result("auth", "fail", "auth.blocked", null, { error: errorText(error), pageOrigin: cfg.pageOrigin });
  }
};

// --- ④ 呼び出し ---

export interface CallOutcome {
  readonly step: StepResult;
  /** プロキシが返した LLM の生の出力（④が成功したときだけ） */
  readonly output: string | null;
}

export const probeCall = async (cfg: ProbeConfig, decree: Decree, now = defaultNow): Promise<CallOutcome> => {
  try {
    const { value, ms } = await timed(() => post(cfg, cfg.token, { text: decree.text, tags: decree.tags }), now);
    const facts: Record<string, string> = { status: String(value.status), mode: value.mode ?? "", error: value.error ?? "" };
    if (value.status === 200 && value.output !== null) {
      const slow = ms > LLM_TIMEOUT_MS;
      return {
        step: result("call", slow ? "warn" : "ok", slow ? "call.slow" : "call.ok", ms, { ...facts, timeoutMs: String(LLM_TIMEOUT_MS) }, value.raw),
        output: value.output,
      };
    }
    return { step: result("call", "fail", value.error === null ? "call.http" : `call.${value.error}`, ms, facts, value.raw), output: null };
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "TimeoutError";
    return {
      step: result("call", "fail", timedOut ? "call.timeout" : "call.blocked", null, { error: errorText(error) }),
      output: null,
    };
  }
};

// --- ⑤ 検証 ---

export const probeValidate = (output: string): StepResult => {
  const decoded = decodeLLMOutput(output);
  if (Either.isLeft(decoded)) {
    return result("validate", "fail", `validate.${decoded.left.reason}`, null, { detail: decoded.left.detail ?? "" }, output);
  }
  const { intent, clampedFields } = decoded.right;
  return result(
    "validate",
    "ok",
    "validate.ok",
    null,
    {
      action: intent.action,
      // 許可リストにない target は null（ゲームでは「意味が取れなかった」扱いの no-op になる）
      target: intent.target ?? "null",
      magnitude: String(intent.magnitude),
      budget: String(intent.budget),
      confidence: String(intent.confidence),
      clamped: clampedFields.join(", "),
    },
    output,
  );
};

// --- ⑥ ゲームと同じ経路 ---

export const probePipeline = async (cfg: ProbeConfig, decree: Decree, now = defaultNow): Promise<StepResult> => {
  const program = Effect.gen(function* () {
    const memory = yield* makeLogServiceMemory;
    const layer = Layer.merge(
      Layer.succeed(LLMService, makeLLMServiceProxy({ baseUrl: cfg.baseUrl, token: cfg.token, fetch: cfg.fetch })),
      Layer.succeed(LogService, memory.service),
    );
    const start = now();
    const interpretation = yield* parseDecree(decree).pipe(Effect.provide(layer));
    return { interpretation, entries: yield* memory.entries, ms: Math.round(now() - start) };
  });
  const { interpretation, entries, ms } = await Effect.runPromise(program);
  const attempts = entries.filter((e) => e.event === "llm.attemptFailed");
  const reasons = attempts.map((e) => {
    const data = e.data as { reason?: string; detail?: string | null } | undefined;
    return `${data?.reason ?? "?"}${data?.detail ? ` (${data.detail})` : ""}`;
  });
  const { intent } = interpretation;
  const facts = {
    source: interpretation.source,
    failedAttempts: String(attempts.length),
    attemptReasons: reasons.join(" / "),
    fallbackReason: interpretation.fallbackReason ?? "",
    action: intent.action,
    target: intent.target ?? "",
    magnitude: String(intent.magnitude),
    confidence: String(intent.confidence),
  };
  return interpretation.source === "llm"
    ? result("pipeline", attempts.length > 0 ? "warn" : "ok", attempts.length > 0 ? "pipeline.retried" : "pipeline.ok", ms, facts)
    : result("pipeline", "fail", `pipeline.fallback.${interpretation.fallbackReason ?? "unknown"}`, ms, facts);
};

// --- 一括実行 ---

/**
 * 全段階を順に実行する。前の段階が失敗したら、先へ進んでも意味のない段階は skip にする。
 *   config が fail → 以降すべて skip ／ reach が fail → auth 以降 skip ／ call が fail → validate は skip（pipeline は走らせる）
 */
export const runDiagnostics = async (
  cfg: ProbeConfig,
  decree: Decree,
  onStep: (step: StepResult) => void,
  now = defaultNow,
): Promise<readonly StepResult[]> => {
  const results: StepResult[] = [];
  const emit = (step: StepResult) => {
    results.push(step);
    onStep(step);
  };

  const config = probeConfig(cfg);
  emit(config);
  if (config.verdict === "fail") {
    for (const id of STEP_IDS.slice(1)) emit(skipped(id, "config"));
    return results;
  }
  const reach = await probeReach(cfg, now);
  emit(reach);
  if (reach.verdict === "fail") {
    for (const id of STEP_IDS.slice(2)) emit(skipped(id, "reach"));
    return results;
  }
  emit(await probeAuth(cfg, now));
  const call = await probeCall(cfg, decree, now);
  emit(call.step);
  emit(call.output === null ? skipped("validate", "call") : probeValidate(call.output));
  emit(await probePipeline(cfg, decree, now));
  return results;
};

// --- ゲーム中の実績（localStorage の計測ログから） ---

export interface LogSummary {
  /** 解決した勅令の数 */
  readonly turns: number;
  readonly viaLlm: number;
  readonly viaTemplate: number;
  /** 失敗した試行の内訳（理由と detail ごとの回数。多い順） */
  readonly failures: readonly { readonly key: string; readonly count: number }[];
  /** 直近の失敗（新しい順） */
  readonly recent: readonly { readonly at: number; readonly reason: string; readonly detail: string }[];
}

const RECENT_FAILURES = 5;

export const summarizeLlmLog = (entries: readonly StoredLogEntry[]): LogSummary => {
  let viaLlm = 0;
  let viaTemplate = 0;
  const counts = new Map<string, number>();
  const failures: { at: number; reason: string; detail: string }[] = [];
  for (const entry of entries) {
    const data = entry.data as { source?: string | null; reason?: string; detail?: string | null } | undefined;
    if (entry.event === "turn.resolved") {
      if (data?.source === "llm") viaLlm++;
      else if (data?.source === "template") viaTemplate++;
    } else if (entry.event === "llm.attemptFailed") {
      const reason = data?.reason ?? "unknown";
      const detail = data?.detail ?? "";
      const key = detail === "" ? reason : `${reason} (${detail})`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      failures.push({ at: entry.at, reason, detail });
    }
  }
  return {
    turns: viaLlm + viaTemplate,
    viaLlm,
    viaTemplate,
    failures: [...counts].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count),
    recent: failures.slice(-RECENT_FAILURES).reverse(),
  };
};
