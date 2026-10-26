import { describe, expect, it } from "vitest";
import { DECREE_CHAR_LIMIT, TAG_CHAR_COST } from "../../domain/constants";
import { checkDraft, EMPTY_DRAFT, toDecree, toIntent } from "./decreeDraft";
import { motionTimings } from "./motion";

describe("勅令用紙の書きかけ", () => {
  it("選んだタグだけを、対象・規模・期限・優先度の順に付ける", () => {
    const decree = toDecree({ ...EMPTY_DRAFT, text: "道を造れ", tags: { target: "road", scale: "", deadline: "thisYear", priority: "high" } });
    expect(decree.tags.map((t) => t.kind)).toEqual(["target", "deadline", "priority"]);
  });

  it("意図は書き添えなければ null、数がなければ不正", () => {
    expect(toIntent(EMPTY_DRAFT.intent)).toBeNull();
    expect(toIntent({ param: "population", direction: "increase", value: "" })).toBe("invalid");
    expect(toIntent({ param: "population", direction: "increase", value: "10" })).toEqual({
      targetParam: "population",
      direction: "increase",
      targetValue: 10,
    });
  });

  it("判を押せるのは、文字数が範囲内・意図が正しい・政治資本がある・受付中のとき", () => {
    const ok = { ...EMPTY_DRAFT, text: "道を造れ" };
    expect(checkDraft(ok, { canIssue: true, locked: false }).ready).toBe(true);
    expect(checkDraft(ok, { canIssue: false, locked: false }).ready).toBe(false);
    expect(checkDraft(ok, { canIssue: true, locked: true }).ready).toBe(false);
    const tooLong = { ...EMPTY_DRAFT, text: "あ".repeat(DECREE_CHAR_LIMIT + 1) };
    expect(checkDraft(tooLong, { canIssue: true, locked: false }).ready).toBe(false);
    const badIntent = { ...ok, intent: { param: "population" as const, direction: "increase" as const, value: "" } };
    expect(checkDraft(badIntent, { canIssue: true, locked: false }).ready).toBe(false);
  });

  it("残り文字数はタグ1つで5字減る", () => {
    const plain = checkDraft({ ...EMPTY_DRAFT, text: "道" }, { canIssue: true, locked: false });
    const tagged = checkDraft({ ...EMPTY_DRAFT, text: "道", tags: { ...EMPTY_DRAFT.tags, target: "road" } }, { canIssue: true, locked: false });
    expect(plain.remaining - tagged.remaining).toBe(TAG_CHAR_COST);
  });
});

describe("動きの長さ（prefers-reduced-motion）", () => {
  it("動きを減らすと、手に取る動きは即時になり、押印の待ちも短くなる", () => {
    const full = motionTimings(false);
    const reduced = motionTimings(true);
    expect(full.focusMs).toBe(350);
    expect(reduced.focusMs).toBe(0);
    expect(reduced.fadeMs).toBeGreaterThan(0);
    expect(reduced.stampMs).toBeLessThan(full.stampMs);
  });
});
