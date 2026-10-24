import {
  LLM_MODEL,
  LLM_TEMPERATURE,
  LLM_TIMEOUT_MS,
  MAX_TAGS,
  PROXY_MAX_BODY_BYTES,
  PROXY_MAX_OUTPUT_TOKENS,
  PROXY_MAX_TEXT_CHARS,
  PROXY_RATE_LIMIT_PER_MINUTE,
  PROXY_RATE_LIMIT_WINDOW_MS,
  PROXY_UPSTREAM_TIMEOUT_MS,
  SCALE_TAG_MAGNITUDE,
} from "../domain/constants";
import type { DecreeTag } from "../domain/Decree";
import { isTarget } from "../domain/Vocabulary";
import { SYSTEM_PROMPT } from "./prompt";
import { makeRateLimiter, type RateLimiter } from "./rateLimit";
import { buildDecreeIntentSchema, DECREE_INTENT_SCHEMA_NAME } from "./schema";

// Mistral プロキシ（Cloudflare Workers。SPEC §11.6 / CLAUDE.md §4-9, §4-10）
//  - API キーは Secrets（MISTRAL_API_KEY）からのみ読む。フロントには置かない
//  - JSON Schema はここで固定。リクエストボディは { text, tags } だけを受け付け、スキーマ等は受け取らない
//  - 勅令本文はユーザーメッセージとして渡し、システムプロンプトには連結しない
//  - 簡易トークン検証・レート制限・呼び出しログ
//
// API: POST /v1/decree  Authorization: Bearer <PROXY_TOKEN>
//   body    { "text": string, "tags": DecreeTag[] }
//   200     { "output": string, "mode": "json_schema" | "json_object" | "fault" }   output は LLM の生の文字列（検証はクライアント）
//   4xx/5xx { "error": string }

export interface ProxyEnv {
  /** Secret */
  readonly MISTRAL_API_KEY?: string;
  /** Secret。フロントのビルドに埋め込まれるため「簡易」トークン（DECISIONS D-39） */
  readonly PROXY_TOKEN?: string;
  /** カンマ区切り。空なら Origin ヘッダー付きのリクエストは全て拒否 */
  readonly ALLOWED_ORIGINS?: string;
  readonly MISTRAL_BASE_URL?: string;
  readonly MISTRAL_MODEL?: string;
  readonly RATE_LIMIT_PER_MINUTE?: string;
  /** "true" で JSON Schema に minimum/maximum を付ける（Mistral の対応確認後に切替） */
  readonly SCHEMA_INCLUDE_RANGES?: string;
  /** "development" のときだけ FAULT_MODE が有効 */
  readonly ENVIRONMENT?: string;
  /** 障害の模擬：timeout | invalid_json | schema_violation | upstream_error */
  readonly FAULT_MODE?: string;
}

export interface ProxyDeps {
  readonly fetchUpstream: typeof fetch;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly limiter: RateLimiter;
  readonly log: (entry: Record<string, unknown>) => void;
}

const DEFAULT_BASE_URL = "https://api.mistral.ai";
const ROUTE = "/v1/decree";
const SCALES = Object.keys(SCALE_TAG_MAGNITUDE);
const ALLOWED_BODY_KEYS = new Set(["text", "tags"]);
const FAULT_MODES = new Set(["timeout", "invalid_json", "schema_violation", "upstream_error"]);
const HTTP_UNPROCESSABLE = 422;

type Mode = "json_schema" | "json_object";

const json = (status: number, body: unknown, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

/** タイミング攻撃を避けるための定数時間比較 */
const safeEqual = (a: string, b: string): boolean => {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
};

const parseOrigins = (value: string | undefined): readonly string[] =>
  (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

const corsHeaders = (origin: string | null): HeadersInit =>
  origin === null
    ? {}
    : {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Max-Age": "600",
        Vary: "Origin",
      };

const isDecreeTag = (value: unknown): value is DecreeTag => {
  if (typeof value !== "object" || value === null) return false;
  const tag = value as Record<string, unknown>;
  if (Object.keys(tag).some((k) => k !== "kind" && k !== "value")) return false;
  if (tag.kind === "target") return typeof tag.value === "string" && isTarget(tag.value);
  if (tag.kind === "scale") return typeof tag.value === "string" && SCALES.includes(tag.value);
  return false;
};

/** ボディは { text, tags } のみ。schema / model / messages など他のキーは拒否する */
export const parseBody = (raw: string): { text: string; tags: readonly DecreeTag[] } | string => {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return "invalid_json";
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return "invalid_body";
  const record = body as Record<string, unknown>;
  if (Object.keys(record).some((key) => !ALLOWED_BODY_KEYS.has(key))) return "unexpected_field";
  const { text, tags } = record;
  if (typeof text !== "string" || text.trim().length === 0) return "invalid_text";
  if ([...text].length > PROXY_MAX_TEXT_CHARS) return "text_too_long";
  const tagList = tags ?? [];
  if (!Array.isArray(tagList) || tagList.length > MAX_TAGS || !tagList.every(isDecreeTag)) return "invalid_tags";
  return { text, tags: tagList };
};

/** Mistral の chat/completions リクエスト。勅令はユーザーメッセージに JSON として入れる */
export const buildUpstreamBody = (env: ProxyEnv, text: string, tags: readonly DecreeTag[], mode: Mode) => ({
  model: env.MISTRAL_MODEL ?? LLM_MODEL,
  temperature: LLM_TEMPERATURE,
  max_tokens: PROXY_MAX_OUTPUT_TOKENS,
  messages: [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: JSON.stringify({ decree: text, tags }) },
  ],
  response_format:
    mode === "json_schema"
      ? {
          type: "json_schema",
          json_schema: {
            name: DECREE_INTENT_SCHEMA_NAME,
            strict: true,
            schema: buildDecreeIntentSchema(env.SCHEMA_INCLUDE_RANGES === "true"),
          },
        }
      : { type: "json_object" },
});

const extractContent = (payload: unknown): string | null => {
  const content = (payload as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]?.message?.content;
  return typeof content === "string" ? content : null;
};

type UpstreamResult =
  | { readonly kind: "ok"; readonly output: string; readonly mode: Mode }
  | { readonly kind: "error"; readonly status: number; readonly error: string };

const callUpstream = async (env: ProxyEnv, deps: ProxyDeps, text: string, tags: readonly DecreeTag[]): Promise<UpstreamResult> => {
  const signal = AbortSignal.timeout(PROXY_UPSTREAM_TIMEOUT_MS);
  const url = `${env.MISTRAL_BASE_URL ?? DEFAULT_BASE_URL}/v1/chat/completions`;
  for (const mode of ["json_schema", "json_object"] as const) {
    let response: Response;
    try {
      response = await deps.fetchUpstream(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.MISTRAL_API_KEY ?? ""}` },
        body: JSON.stringify(buildUpstreamBody(env, text, tags, mode)),
        signal,
      });
    } catch (error) {
      const timedOut = error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError");
      return { kind: "error", status: timedOut ? 504 : 502, error: timedOut ? "upstream_timeout" : "upstream_unreachable" };
    }
    // Structured Outputs が受け付けられなければ（400/422）JSON モードで再試行する（SPEC §11.2 フォールバック①）
    if (mode === "json_schema" && (response.status === 400 || response.status === HTTP_UNPROCESSABLE)) continue;
    if (response.status === 429) return { kind: "error", status: 429, error: "upstream_rate_limited" };
    if (!response.ok) return { kind: "error", status: 502, error: `upstream_${response.status}` };
    const content = extractContent(await response.json().catch(() => null));
    if (content === null) return { kind: "error", status: 502, error: "upstream_no_content" };
    return { kind: "ok", output: content, mode };
  }
  return { kind: "error", status: 502, error: "upstream_rejected_both_modes" };
};

const faultResponse = async (fault: string, deps: ProxyDeps, cors: HeadersInit): Promise<Response> => {
  switch (fault) {
    case "timeout":
      // クライアントのタイムアウトより長く黙る
      await deps.sleep(LLM_TIMEOUT_MS * 2);
      return json(504, { error: "fault_timeout" }, cors);
    case "invalid_json":
      return json(200, { output: "{not json", mode: "fault" }, cors);
    case "schema_violation":
      return json(200, { output: JSON.stringify({ action: "destroy", target: "castle" }), mode: "fault" }, cors);
    default:
      return json(502, { error: "fault_upstream_error" }, cors);
  }
};

export const handleRequest = async (request: Request, env: ProxyEnv, deps: ProxyDeps): Promise<Response> => {
  const started = deps.now();
  const origin = request.headers.get("Origin");
  const allowedOrigins = parseOrigins(env.ALLOWED_ORIGINS);
  if (origin !== null && !allowedOrigins.includes(origin)) return json(403, { error: "forbidden_origin" });
  const cors = corsHeaders(origin);

  const url = new URL(request.url);
  if (url.pathname !== ROUTE) return json(404, { error: "not_found" }, cors);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return json(405, { error: "method_not_allowed" }, cors);

  const finish = (response: Response, extra: Record<string, unknown> = {}) => {
    deps.log({ event: "decree", status: response.status, latencyMs: deps.now() - started, ...extra });
    return response;
  };

  if (!env.PROXY_TOKEN || !env.MISTRAL_API_KEY) return finish(json(500, { error: "proxy_misconfigured" }, cors));
  const auth = request.headers.get("Authorization") ?? "";
  if (!safeEqual(auth, `Bearer ${env.PROXY_TOKEN}`)) return finish(json(401, { error: "unauthorized" }, cors));

  const limit = Number(env.RATE_LIMIT_PER_MINUTE ?? PROXY_RATE_LIMIT_PER_MINUTE);
  const clientKey = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const retryAfter = deps.limiter.hit(clientKey, deps.now(), limit, PROXY_RATE_LIMIT_WINDOW_MS);
  if (retryAfter !== null) {
    return finish(json(429, { error: "rate_limited" }, { ...cors, "Retry-After": String(Math.ceil(retryAfter / 1000)) }));
  }

  const declaredLength = Number(request.headers.get("Content-Length") ?? 0);
  if (declaredLength > PROXY_MAX_BODY_BYTES) return finish(json(413, { error: "body_too_large" }, cors));
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > PROXY_MAX_BODY_BYTES) return finish(json(413, { error: "body_too_large" }, cors));
  const parsed = parseBody(raw);
  if (typeof parsed === "string") return finish(json(400, { error: parsed }, cors));

  // 勅令本文はログに残さない（長さとタグ数のみ）
  const meta = { textChars: [...parsed.text].length, tagCount: parsed.tags.length };

  if (env.ENVIRONMENT === "development" && env.FAULT_MODE && FAULT_MODES.has(env.FAULT_MODE)) {
    return finish(await faultResponse(env.FAULT_MODE, deps, cors), { ...meta, fault: env.FAULT_MODE });
  }

  const result = await callUpstream(env, deps, parsed.text, parsed.tags);
  if (result.kind === "error") return finish(json(result.status, { error: result.error }, cors), meta);
  return finish(json(200, { output: result.output, mode: result.mode }, cors), { ...meta, mode: result.mode });
};

const limiter = makeRateLimiter();

export default {
  fetch: (request: Request, env: ProxyEnv): Promise<Response> =>
    handleRequest(request, env, {
      fetchUpstream: (input, init) => fetch(input, init),
      now: () => Date.now(),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      limiter,
      log: (entry) => console.log(JSON.stringify(entry)),
    }),
};
