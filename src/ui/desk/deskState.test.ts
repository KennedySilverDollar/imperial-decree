import { describe, expect, it } from "vitest";
import { EMPTY_DRAFT } from "./decreeDraft";
import { deskReducer, initialDeskState, sheetKey, type DeskUiState } from "./deskState";

const start = (): DeskUiState => initialDeskState(sheetKey("save-a", 1));

describe("机の UI 状態", () => {
  it("手に取ると手元へ、重なりの一番上へ。置くと机へ戻る", () => {
    const held = deskReducer(start(), { type: "pickUp", id: "newspaper" });
    expect(held.focused).toBe("newspaper");
    expect(held.order.at(-1)).toBe("newspaper");
    expect(deskReducer(held, { type: "putDown" }).focused).toBeNull();
  });

  it("勅令用紙を取ると判子も一緒に上へ来る", () => {
    const held = deskReducer(start(), { type: "pickUp", id: "decree" });
    expect(held.order.slice(-2)).toEqual(["decree", "stamp"]);
  });

  it("並べ読みは新聞・書簡のときだけ。置くと解ける", () => {
    let s = deskReducer(start(), { type: "pickUp", id: "ledger" });
    expect(deskReducer(s, { type: "toggleSideBySide" }).sideBySide).toBe(false);
    s = deskReducer(s, { type: "pickUp", id: "letters" });
    s = deskReducer(s, { type: "toggleSideBySide" });
    expect(s.sideBySide).toBe(true);
    expect(deskReducer(s, { type: "pickUp", id: "decree" }).sideBySide).toBe(false);
    expect(deskReducer(s, { type: "putDown" }).sideBySide).toBe(false);
  });

  it("書きかけは同じ年の間は残り、年が替わる・始め直すと新しい紙になる", () => {
    const draft = { ...EMPTY_DRAFT, text: "道を造れ" };
    let s = deskReducer(start(), { type: "draft", draft });
    s = deskReducer(s, { type: "pickUp", id: "decree" });
    s = deskReducer(s, { type: "putDown" });
    s = deskReducer(s, { type: "newSheet", key: sheetKey("save-a", 1) });
    expect(s.draft.text).toBe("道を造れ");
    expect(deskReducer(s, { type: "newSheet", key: sheetKey("save-a", 2) }).draft).toEqual(EMPTY_DRAFT);
    expect(deskReducer(s, { type: "newSheet", key: sheetKey("save-b", 1) }).draft).toEqual(EMPTY_DRAFT);
  });

  it("結果の書類束が届くと、最初の紙から手元に来る", () => {
    let s = deskReducer(start(), { type: "pickUp", id: "letters" });
    s = deskReducer(s, { type: "toggleSideBySide" });
    s = deskReducer(s, { type: "resultArrived", turn: 1 });
    expect(s.focused).toBe("result");
    expect(s.sideBySide).toBe(false);
    expect(s.result).toEqual({ turn: 1, top: 0, flips: 0, deepest: 0 });
  });

  it("めくり：範囲内に収め、回数と一番深い紙を数える", () => {
    let s = deskReducer(start(), { type: "resultArrived", turn: 3 });
    s = deskReducer(s, { type: "flip", turn: 3, to: 1, sheetCount: 3 });
    s = deskReducer(s, { type: "flip", turn: 3, to: 2, sheetCount: 3 });
    s = deskReducer(s, { type: "flip", turn: 3, to: 5, sheetCount: 3 });
    s = deskReducer(s, { type: "flip", turn: 3, to: 0, sheetCount: 3 });
    expect(s.result).toEqual({ turn: 3, top: 0, flips: 3, deepest: 2 });
  });

  it("セーブから続けた年の束も、最初の紙から数えてめくれる", () => {
    const s = deskReducer(start(), { type: "flip", turn: 7, to: 1, sheetCount: 3 });
    expect(s.result).toEqual({ turn: 7, top: 1, flips: 1, deepest: 1 });
  });
});
