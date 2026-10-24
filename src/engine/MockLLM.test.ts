import { Effect, Either, Fiber, TestClock, TestContext } from "effect";
import { describe, expect, it } from "vitest";
import { LLMService } from "../services/LLMService";
import { decodeLLMOutput } from "./DecreeParser";
import { LLMServiceTemplateMock } from "./MockLLM";

const ask = (text: string) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.fork(Effect.flatMap(LLMService, (llm) => llm.parseDecree({ text, tags: [] })));
      yield* TestClock.adjust("1 second");
      return yield* Fiber.join(fiber);
    }).pipe(Effect.provide(LLMServiceTemplateMock), Effect.provide(TestContext.TestContext)),
  );

describe("モック参謀（P2）", () => {
  it("出力は本番と同じスキーマ検証を通る", async () => {
    const decoded = decodeLLMOutput(await ask("道を造れ"));
    expect(Either.isRight(decoded) && decoded.right.intent).toMatchObject({ action: "build", target: "road" });
  });

  it("意味が取れない勅令は許可リスト外の target になり、no-op 扱いになる", async () => {
    const decoded = decodeLLMOutput(await ask("よきにはからえ"));
    expect(Either.isRight(decoded) && decoded.right.intent.target).toBeNull();
  });
});
