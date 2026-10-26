import { Effect, Layer } from "effect";
import { LLMError } from "./errors";
import { LLMService, type LLMServiceShape } from "./LLMService";

// LLMService の Mistral 実装（SPEC §11.2, §11.6）。Mistral へは直接行かず、必ずプロキシ（src/proxy）を通す。
// API キーはプロキシ側の Secret にあり、フロントが持つのは簡易トークンだけ（CLAUDE.md §4-9）。
// タイムアウト・リトライ・スキーマ検証・テンプレートへのフォールバックは DecreeParser が行う。
// Effect の中断（タイムアウト）で fetch も中断する。

export interface ProxyConfig {
  /** 例: http://localhost:8787 */
  readonly baseUrl: string;
  readonly token: string;
  readonly fetch?: typeof fetch;
}

const ROUTE = "/v1/decree";
const HTTP_GATEWAY_TIMEOUT = 504;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_CLIENT_ERROR_MIN = 400;
const HTTP_SERVER_ERROR_MIN = 500;

/** プロキシの HTTP ステータスを失敗理由に対応させる */
const reasonFor = (status: number): LLMError["reason"] =>
  status === HTTP_GATEWAY_TIMEOUT
    ? "timeout"
    : status === HTTP_TOO_MANY_REQUESTS
      ? "rateLimited"
      : status >= HTTP_CLIENT_ERROR_MIN && status < HTTP_SERVER_ERROR_MIN
        ? "rejected"
        : "network";

export const makeLLMServiceProxy = (config: ProxyConfig): LLMServiceShape => {
  const doFetch = config.fetch ?? ((input, init) => fetch(input, init));
  return {
    parseDecree: (request) =>
      Effect.tryPromise({
        try: (signal) =>
          doFetch(`${config.baseUrl.replace(/\/$/, "")}${ROUTE}`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.token}` },
            body: JSON.stringify({ text: request.text, tags: request.tags }),
            signal,
          }),
        catch: (error) => new LLMError({ reason: "network", detail: String(error) }),
      }).pipe(
        Effect.flatMap((response) =>
          response.ok
            ? Effect.tryPromise({
                try: () => response.json() as Promise<unknown>,
                catch: (error) => new LLMError({ reason: "invalidJson", detail: String(error) }),
              })
            : Effect.flatMap(
                // プロキシの { error: "upstream_401" } などを detail に残す（診断画面とログで原因を追えるように）
                Effect.promise(() => response.json().catch(() => null) as Promise<unknown>),
                (body) => {
                  const code = (body as { error?: unknown } | null)?.error;
                  const suffix = typeof code === "string" ? `: ${code}` : "";
                  return Effect.fail(new LLMError({ reason: reasonFor(response.status), detail: `proxy ${response.status}${suffix}` }));
                },
              ),
        ),
        Effect.flatMap((body) => {
          const output = (body as { output?: unknown } | null)?.output;
          return typeof output === "string"
            ? Effect.succeed(output)
            : Effect.fail(new LLMError({ reason: "invalidJson", detail: "proxy response without output" }));
        }),
      ),
  };
};

export const LLMServiceProxy = (config: ProxyConfig): Layer.Layer<LLMService> =>
  Layer.succeed(LLMService, makeLLMServiceProxy(config));
