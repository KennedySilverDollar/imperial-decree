import { describe, expect, it } from "vitest";
import { commandForKey, type KeyContext, type KeyInput } from "./keyboard";

const key = (k: string, partial: Partial<KeyInput> = {}): KeyInput => ({ key: k, isComposing: false, target: "other", modifiers: false, ...partial });
const ctx = (partial: Partial<KeyContext> = {}): KeyContext => ({ mode: "3d", focused: null, animating: false, ...partial });

describe("キーボード操作（SPEC_v3.3 §4.7）", () => {
  it("1〜6 で地図・新聞・書簡・勅令用紙・台帳・結果束を手に取る（7 のメモ帳は U4）", () => {
    expect(["1", "2", "3", "4", "5", "6"].map((k) => commandForKey(key(k), ctx()))).toEqual([
      { kind: "pickUp", id: "map" },
      { kind: "pickUp", id: "newspaper" },
      { kind: "pickUp", id: "letters" },
      { kind: "pickUp", id: "decree" },
      { kind: "pickUp", id: "ledger" },
      { kind: "pickUp", id: "result" },
    ]);
    expect(commandForKey(key("7"), ctx())).toBeNull();
  });

  it("8 で地形模型を手に取る。模型は立体の机にだけあるので、平面モードでは何もしない（SPEC_v3.4 §10.3）", () => {
    expect(commandForKey(key("8"), ctx())).toEqual({ kind: "pickUp", id: "relief" });
    expect(commandForKey(key("8"), ctx({ mode: "flat" }))).toBeNull();
  });

  it("文字の入力中は横取りしない（Esc を除く）。IME 変換中は Esc も", () => {
    expect(commandForKey(key("2", { target: "text" }), ctx())).toBeNull();
    expect(commandForKey(key("Enter", { target: "text" }), ctx({ focused: "decree" }))).toBeNull();
    expect(commandForKey(key("Escape", { target: "text" }), ctx({ focused: "decree" }))).toEqual({ kind: "putDown" });
    expect(commandForKey(key("Escape", { isComposing: true }), ctx({ focused: "decree" }))).toBeNull();
    expect(commandForKey(key("2", { modifiers: true }), ctx())).toBeNull();
  });

  it("ボタンの上でも数字で手に取れるが、Tab・矢印・Enter は部品に任せる", () => {
    expect(commandForKey(key("2", { target: "control" }), ctx())).toEqual({ kind: "pickUp", id: "newspaper" });
    expect(commandForKey(key("Tab", { target: "control" }), ctx({ focused: "newspaper" }))).toBeNull();
    expect(commandForKey(key("ArrowRight", { target: "control" }), ctx({ focused: "result" }))).toBeNull();
    expect(commandForKey(key("Enter", { target: "control" }), ctx({ focused: "decree" }))).toBeNull();
  });

  it("Esc は手元に何かあるときだけ置く", () => {
    expect(commandForKey(key("Escape"), ctx())).toBeNull();
    expect(commandForKey(key("Escape"), ctx({ focused: "map" }))).toEqual({ kind: "putDown" });
  });

  it("Tab の並べ読みは立体の机で新聞・書簡を持っているときだけ", () => {
    expect(commandForKey(key("Tab"), ctx({ focused: "newspaper" }))).toEqual({ kind: "toggleSideBySide" });
    expect(commandForKey(key("Tab"), ctx({ focused: "letters" }))).toEqual({ kind: "toggleSideBySide" });
    expect(commandForKey(key("Tab"), ctx({ focused: "ledger" }))).toBeNull();
    expect(commandForKey(key("Tab"), ctx({ mode: "flat", focused: "newspaper" }))).toBeNull();
  });

  it("← → は結果の書類束をめくる", () => {
    expect(commandForKey(key("ArrowLeft"), ctx({ focused: "result" }))).toEqual({ kind: "page", delta: -1 });
    expect(commandForKey(key("ArrowRight"), ctx({ focused: "result" }))).toEqual({ kind: "page", delta: 1 });
    expect(commandForKey(key("ArrowRight"), ctx({ focused: "newspaper" }))).toBeNull();
  });

  it("Enter は勅令用紙が手元にあるときに判を押す", () => {
    expect(commandForKey(key("Enter"), ctx({ focused: "decree" }))).toEqual({ kind: "stamp" });
    expect(commandForKey(key("Enter"), ctx({ focused: "map" }))).toBeNull();
  });

  it("Space は動きの最中だけ飛ばす（入力欄では空白を打つ）", () => {
    expect(commandForKey(key(" "), ctx({ animating: true }))).toEqual({ kind: "skip" });
    expect(commandForKey(key(" "), ctx())).toBeNull();
    expect(commandForKey(key(" ", { target: "text" }), ctx({ animating: true }))).toBeNull();
  });
});
