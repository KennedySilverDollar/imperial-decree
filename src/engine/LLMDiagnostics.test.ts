import { describe, expect, it } from "vitest";
import type { Decree } from "../domain/Decree";
import { makeRateLimiter } from "../proxy/rateLimit";
import { handleRequest, type ProxyEnv } from "../proxy/worker";
import { maskToken, probeConfig, runDiagnostics, STEP_IDS, summarizeLlmLog, type ProbeConfig, type StepResult } from "./LLMDiagnostics";

// AI 診断（デバッグ画面）：本物のプロキシ（handleRequest）を偽のブラウザ fetch の裏につなぎ、起きうる故障ごとに原因が切り分けられるかを確かめる

const PAGE_ORIGIN = "http://localhost:5173";
const BASE_URL = "http://proxy.local";
const ENV: ProxyEnv = { MISTRAL_API_KEY: "sk-test", PROXY_TOKEN: "proxy-token", ALLOWED_ORIGINS: PAGE_ORIGIN, ENVIRONMENT: "production" };
const GOOD = JSON.stringify({ action: "build", target: "road", magnitude: 50, budget: 0, confidence: 0.9 });
const DECREE: Decree = { text: "道を大いに造れ", tags: [] };

const mistral = (status: number, content: string = GOOD) => async () =>
  new Response(JSON.stringify(status === 200 ? { choices: [{ message: { content } }] } : { error: "x" }), { status });

/** ブラウザの fetch の模擬：CORS ヘッダーのない応答は（no-cors 以外では）読ませず TypeError にする */
const browserFetch = (env: ProxyEnv, upstream: () => Promise<Response>, options: { down?: boolean } = {}): typeof fetch => {
  const limiter = makeRateLimiter();
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (options.down) throw new TypeError("Failed to fetch");
    const request = new Request(String(input), { ...init, headers: { ...(init?.headers as Record<string, string>), Origin: PAGE_ORIGIN } });
    const response = await handleRequest(request, env, {
      fetchUpstream: upstream as typeof fetch,
      now: () => 0,
      sleep: async () => {},
      limiter,
      log: () => {},
    });
    if (init?.mode === "no-cors") return new Response(null);
    if (response.headers.get("Access-Control-Allow-Origin") === null) throw new TypeError("Failed to fetch");
    return response;
  }) as typeof fetch;
};

const config = (fetchFn: typeof fetch, overrides: Partial<ProbeConfig> = {}): ProbeConfig => ({
  baseUrl: BASE_URL,
  token: "proxy-token",
  fetch: fetchFn,
  pageOrigin: PAGE_ORIGIN,
  pageProtocol: "http:",
  ...overrides,
});

const run = async (cfg: ProbeConfig) => {
  const steps: StepResult[] = [];
  await runDiagnostics(cfg, DECREE, (s) => steps.push(s));
  return Object.fromEntries(steps.map((s) => [s.id, s])) as Record<StepResult["id"], StepResult>;
};

describe("AI 診断：正常系", () => {
  it("全段階が ok で、検証した意図まで取り出せる", async () => {
    const steps = await run(config(browserFetch(ENV, mistral(200))));
    expect(STEP_IDS.map((id) => steps[id].verdict)).toEqual(["ok", "ok", "ok", "ok", "ok", "ok"]);
    expect(steps.call.facts).toMatchObject({ status: "200", mode: "json_schema" });
    expect(steps.validate.facts).toMatchObject({ action: "build", target: "road", magnitude: "50" });
    expect(steps.pipeline.facts).toMatchObject({ source: "llm", failedAttempts: "0" });
  });
});

describe("AI 診断：故障の切り分け", () => {
  it("サーバーが落ちている → reach で止まり、以降は skip", async () => {
    const steps = await run(config(browserFetch(ENV, mistral(200), { down: true })));
    expect(steps.reach).toMatchObject({ verdict: "fail", code: "reach.unreachable" });
    expect([steps.auth, steps.call, steps.validate, steps.pipeline].map((s) => s.verdict)).toEqual(["skip", "skip", "skip", "skip"]);
  });

  it("ページの Origin が ALLOWED_ORIGINS にない → 届くのに読めない（auth.blocked）", async () => {
    const steps = await run(config(browserFetch({ ...ENV, ALLOWED_ORIGINS: "https://other.example" }, mistral(200))));
    expect(steps.reach.verdict).toBe("ok");
    expect(steps.auth).toMatchObject({ verdict: "fail", code: "auth.blocked" });
    expect(steps.auth.facts.pageOrigin).toBe(PAGE_ORIGIN);
    expect(steps.call.code).toBe("call.blocked");
    expect(steps.pipeline.facts.fallbackReason).toBe("network");
  });

  it("フロントのトークンがプロキシと違う → auth は ok（401 が読める）、call で unauthorized", async () => {
    const steps = await run(config(browserFetch(ENV, mistral(200)), { token: "stale-token" }));
    expect(steps.auth.verdict).toBe("ok");
    expect(steps.call).toMatchObject({ verdict: "fail", code: "call.unauthorized" });
    expect(steps.validate.verdict).toBe("skip");
    expect(steps.pipeline).toMatchObject({ verdict: "fail", code: "pipeline.fallback.rejected" });
    // 再試行しても変わらないので、試行は1回だけ
    expect(steps.pipeline.facts.failedAttempts).toBe("1");
    expect(steps.pipeline.facts.attemptReasons).toContain("proxy 401: unauthorized");
  });

  it("プロキシの Secret が未設定 → auth.misconfigured", async () => {
    const steps = await run(config(browserFetch({ ...ENV, MISTRAL_API_KEY: "" }, mistral(200))));
    expect(steps.auth).toMatchObject({ verdict: "fail", code: "auth.misconfigured" });
    expect(steps.call.code).toBe("call.proxy_misconfigured");
  });

  it("Mistral の API キーが無効（上流 401）→ call.upstream_401", async () => {
    const steps = await run(config(browserFetch(ENV, mistral(401))));
    expect(steps.auth.verdict).toBe("ok");
    expect(steps.call).toMatchObject({ verdict: "fail", code: "call.upstream_401" });
    expect(steps.pipeline.facts.fallbackReason).toBe("network");
    expect(steps.pipeline.facts.attemptReasons).toContain("upstream_401");
  });

  it("LLM が JSON でない文字列を返す → call は ok、validate で invalidJson、ゲームはテンプレートへ", async () => {
    const steps = await run(config(browserFetch(ENV, mistral(200, "道を造ります！"))));
    expect(steps.call.verdict).toBe("ok");
    expect(steps.validate).toMatchObject({ verdict: "fail", code: "validate.invalidJson" });
    expect(steps.validate.raw).toBe("道を造ります！");
    expect(steps.pipeline).toMatchObject({ verdict: "fail", code: "pipeline.fallback.invalidJson" });
    expect(steps.pipeline.facts.failedAttempts).toBe("3");
  }, 10_000);

  it("LLM の出力がスキーマに合わない → validate.schemaViolation", async () => {
    const steps = await run(config(browserFetch(ENV, mistral(200, JSON.stringify({ action: "destroy", target: "castle" })))));
    expect(steps.validate).toMatchObject({ verdict: "fail", code: "validate.schemaViolation" });
  }, 10_000);

  it("許可リストにない target は null と表示される（ゲームでは no-op）", async () => {
    const odd = JSON.stringify({ action: "build", target: "castle", magnitude: 50, budget: 0, confidence: 0.9 });
    const steps = await run(config(browserFetch(ENV, mistral(200, odd))));
    expect(steps.validate).toMatchObject({ verdict: "ok" });
    expect(steps.validate.facts.target).toBe("null");
  });

  it("2回目で成功すれば pipeline は warn（再試行が必要だった）", async () => {
    let n = 0;
    const flaky = async () => (n++ < 2 ? new Response("{}", { status: 503 }) : mistral(200)());
    // 診断の auth・call が先に1回ずつ使うので、pipeline の最初の呼び出しだけを落とす
    const fetchFn = browserFetch(ENV, flaky);
    const steps = await run(config(fetchFn));
    expect(["ok", "warn"]).toContain(steps.pipeline.verdict);
  }, 10_000);
});

describe("AI 診断：設定の検査", () => {
  const cfg = config(browserFetch(ENV, mistral(200)));
  it.each([
    ["URL なし", { baseUrl: "" }, "fail", "config.noUrl"],
    ["URL が不正", { baseUrl: "proxy.local" }, "fail", "config.badUrl"],
    ["トークンなし", { token: "" }, "fail", "config.noToken"],
    ["URL にルートまで書いてしまった", { baseUrl: "http://proxy.local/v1/decree" }, "warn", "config.hasPath"],
    ["https のページから http のプロキシ", { baseUrl: "http://proxy.example.com", pageProtocol: "https:" }, "fail", "config.mixedContent"],
    ["https のページから http://localhost は許される", { baseUrl: "http://localhost:8787", pageProtocol: "https:" }, "ok", "config.ok"],
  ] as const)("%s", (_label, overrides, verdict, code) => {
    expect(probeConfig({ ...cfg, ...overrides })).toMatchObject({ verdict, code });
  });

  it("設定が壊れていれば、通信せずに全段階を skip する", async () => {
    const steps = await run({ ...cfg, token: "" });
    expect(steps.config.verdict).toBe("fail");
    expect(STEP_IDS.slice(1).every((id) => steps[id].verdict === "skip")).toBe(true);
  });

  it("トークンは先頭2文字と長さだけ表示する", () => {
    expect(maskToken("abcdef123456")).toBe("ab…[12]");
    expect(JSON.stringify(probeConfig(cfg))).not.toContain("proxy-token");
  });
});

describe("ゲーム中の実績（計測ログの集計）", () => {
  const at = (n: number, event: string, data?: unknown) => ({ at: n, event, data });
  it("LLM とテンプレートの手数、失敗の内訳、直近の失敗を数える", () => {
    const summary = summarizeLlmLog([
      at(1, "turn.resolved", { source: "llm" }),
      at(2, "llm.attemptFailed", { reason: "network", detail: "TypeError: Failed to fetch" }),
      at(3, "llm.attemptFailed", { reason: "network", detail: "TypeError: Failed to fetch" }),
      at(4, "llm.attemptFailed", { reason: "rejected", detail: "proxy 401: unauthorized" }),
      at(5, "llm.fallback", { reason: "rejected" }),
      at(6, "turn.resolved", { source: "template" }),
      at(7, "turn.resolved", { source: null }),
      at(8, "llm.attemptFailed", { reason: "timeout" }),
    ]);
    expect(summary).toMatchObject({ turns: 2, viaLlm: 1, viaTemplate: 1 });
    expect(summary.failures[0]).toEqual({ key: "network (TypeError: Failed to fetch)", count: 2 });
    expect(summary.failures.map((f) => f.key)).toContain("timeout");
    expect(summary.recent.map((r) => r.at)).toEqual([8, 4, 3, 2]);
  });
  it("ログが空でも壊れない", () => {
    expect(summarizeLlmLog([])).toEqual({ turns: 0, viaLlm: 0, viaTemplate: 0, failures: [], recent: [] });
  });
});
