import { describe, expect, it } from "vitest";
import { DECREE_CHAR_LIMIT, TAG_CHAR_COST } from "./constants";
import { countTextChars, remainingChars, usedChars, validateDecree, type Decree } from "./Decree";

const text = (n: number) => "道".repeat(n);

describe("勅令の文字数検証（I-30：本文＋タグ×5 ≦ 40）", () => {
  it("本文は前後空白を除いたコードポイント数で数える", () => {
    expect(countTextChars("  道を造れ  ")).toBe(4);
    expect(countTextChars("𠮷野家")).toBe(3); // サロゲートペアも1文字
  });

  it("タグ1つにつき5文字消費する", () => {
    const decree: Decree = { text: text(10), tags: [{ kind: "target", value: "road" }] };
    expect(usedChars(decree)).toBe(10 + TAG_CHAR_COST);
    expect(TAG_CHAR_COST).toBe(5);
    expect(remainingChars(decree)).toBe(DECREE_CHAR_LIMIT - 15);
  });

  it.each([
    [0, 40],
    [1, 35],
    [2, 30],
    [3, 25],
    [4, 20],
  ] as const)("タグ%i個なら本文%i文字までちょうど通り、1文字超えると不可", (tagCount, maxText) => {
    const tags: Decree["tags"] = (
      [
        { kind: "target", value: "road" },
        { kind: "scale", value: "large" },
        { kind: "deadline", value: "thisYear" },
        { kind: "priority", value: "high" },
      ] as const
    ).slice(0, tagCount);
    expect(validateDecree({ text: text(maxText), tags })).toBeNull();
    expect(validateDecree({ text: text(maxText + 1), tags })).toEqual({
      kind: "tooLong",
      used: DECREE_CHAR_LIMIT + 1,
      limit: DECREE_CHAR_LIMIT,
    });
  });

  it("空の本文は不可", () => {
    expect(validateDecree({ text: "   ", tags: [] })).toEqual({ kind: "empty" });
  });

  it("同じ種類のタグは1つまで、タグは4つまで", () => {
    expect(
      validateDecree({
        text: "道",
        tags: [
          { kind: "scale", value: "small" },
          { kind: "scale", value: "large" },
        ],
      }),
    ).toEqual({ kind: "duplicateTag", tagKind: "scale" });
    expect(
      validateDecree({
        text: "道",
        tags: [
          { kind: "scale", value: "small" },
          { kind: "target", value: "road" },
          { kind: "deadline", value: "noRush" },
          { kind: "priority", value: "low" },
          { kind: "target", value: "well" },
        ],
      }),
    ).toEqual({ kind: "tooManyTags", count: 5 });
  });
});
