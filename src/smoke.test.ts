import { Effect } from "effect";
import { describe, expect, it } from "vitest";

describe("雛形", () => {
  it("Effect が実行できる", () => {
    expect(Effect.runSync(Effect.succeed(1))).toBe(1);
  });
});
