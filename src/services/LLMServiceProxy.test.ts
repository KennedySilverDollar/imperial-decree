import { Duration, Effect, Either, Fiber, TestClock, TestContext } from "effect";
import { describe, expect, it } from "vitest";
import { makeLLMServiceProxy } from "./LLMServiceProxy";

const request = { text: "道を造れ", tags: [{ kind: "scale", value: "large" }] } as const;

const withFetch = (respond: (url: string, init: RequestInit) => Promise<Response>) => {
  const calls: { url: string; init: RequestInit }[] = [];
  const service = makeLLMServiceProxy({
    baseUrl: "http://localhost:8787/",
    token: "proxy-token",
    fetch: (input, init) => {
      calls.push({ url: String(input), init: init ?? {} });
      return respond(String(input), init ?? {});
    },
  });
  return { service, calls };
};

const run = (effect: Effect.Effect<unknown, { reason: string }>) => Effect.runPromise(Effect.either(effect));

describe("LLMService の Mistral 実装（プロキシ経由）", () => {
  it("本文とタグだけをトークン付きで送り、出力文字列を返す", async () => {
    const { service, calls } = withFetch(async () => new Response(JSON.stringify({ output: "{}", mode: "json_schema" })));
    const result = await run(service.parseDecree(request));
    expect(result).toEqual(Either.right("{}"));
    expect(calls[0]?.url).toBe("http://localhost:8787/v1/decree");
    expect(new Headers(calls[0]?.init.headers).get("Authorization")).toBe("Bearer proxy-token");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ text: request.text, tags: request.tags });
  });

  it.each([
    [504, "timeout"],
    [502, "network"],
    [429, "rateLimited"],
    [401, "rejected"],
    [400, "rejected"],
  ])("プロキシが %i を返したら %s", async (status, reason) => {
    const { service } = withFetch(async () => new Response("{}", { status }));
    const result = await run(service.parseDecree(request));
    expect(Either.isLeft(result) && result.left.reason).toBe(reason);
  });

  it("通信できなければ network、出力が無ければ invalidJson", async () => {
    const down = withFetch(() => Promise.reject(new TypeError("Failed to fetch")));
    const r1 = await run(down.service.parseDecree(request));
    expect(Either.isLeft(r1) && r1.left.reason).toBe("network");
    const empty = withFetch(async () => new Response(JSON.stringify({ mode: "json_schema" })));
    const r2 = await run(empty.service.parseDecree(request));
    expect(Either.isLeft(r2) && r2.left.reason).toBe("invalidJson");
  });

  it("タイムアウトで中断されたら fetch も中断する", async () => {
    let aborted = false;
    const { service } = withFetch(
      (_url, init) =>
        new Promise((_, reject) => {
          init.signal?.addEventListener("abort", () => {
            aborted = true;
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    );
    await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.fork(Effect.either(Effect.timeout(service.parseDecree(request), Duration.seconds(5))));
        yield* TestClock.adjust("6 seconds");
        yield* Fiber.join(fiber);
      }).pipe(Effect.provide(TestContext.TestContext)),
    );
    expect(aborted).toBe(true);
  });
});
