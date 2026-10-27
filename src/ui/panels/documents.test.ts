import { describe, expect, it } from "vitest";
import { createInitialState } from "../../domain/GameState";
import type { Section } from "../../domain/News";
import { playedState } from "../../test/gameApi";
import { inkDensity, inkGlyphs } from "../desk/ink";
import { deskReducer, initialDeskState, letterKey, pageKey, sheetKey } from "../desk/deskState";
import { LEDGER_TREND_YEARS, ledgerPages, trendOf } from "./LedgerPanel";
import { newspaperPages } from "./NewspaperPanel";

const art = (sectionId: Section) => ({ sectionId });

describe("新聞の面", () => {
  it("第一面・社会・経済・行政は第一面、治安・投書・広告・天候は二面", () => {
    const pages = newspaperPages([art("front"), art("letters"), art("social"), art("weather"), art("economy"), art("security")]);
    expect(pages.map((p) => p.map((a) => a.sectionId))).toEqual([
      ["front", "social", "economy"],
      ["letters", "weather", "security"],
    ]);
  });

  it("二面に載る欄が無ければ1面だけ", () => {
    expect(newspaperPages([art("front"), art("social")])).toHaveLength(1);
  });
});

describe("台帳（1ページ＝1年）", () => {
  it("着任時のページと、各年の暮れのページ。値と前年比は記録をそのまま読む", async () => {
    const state = await playedState(3, ["道を造れ", "家を建てよ"]);
    const pages = ledgerPages(state.history, state.params);
    expect(pages.map((p) => p.year)).toEqual([0, 1, 2]);
    expect(pages[0]?.delta).toBeNull();
    expect(pages[0]?.params).toEqual(state.history[0]?.before);
    expect(pages[2]?.params).toEqual(state.params);
    expect(pages[1]?.delta).toEqual(state.history[0]?.actualResult);
  });

  it("まだ一年も経っていなければ着任時のページだけ", () => {
    const state = createInitialState(1);
    expect(ledgerPages([], state.params)).toEqual([{ year: 0, params: state.params, delta: null }]);
  });

  it("折れ線は直近10年（＋起点）まで", () => {
    const pages = Array.from({ length: 15 }, (_, year) => ({
      year,
      params: { population: year * 10, treasury: 0, happiness: 0, infrastructure: 0, corruption: 0 },
      delta: null,
    }));
    const trend = trendOf(pages, 14, "population");
    expect(trend).toHaveLength(LEDGER_TREND_YEARS + 1);
    expect(trend.at(-1)).toBe(140);
    expect(trendOf(pages, 2, "population")).toEqual([0, 10, 20]);
  });
});

describe("筆の墨の濃淡", () => {
  it("位置だけで決まり（同じ文面なら同じ濃さ）、0.74〜1 に収まる", () => {
    for (let i = 0; i < 200; i++) {
      expect(inkDensity(i)).toBe(inkDensity(i));
      expect(inkDensity(i)).toBeGreaterThanOrEqual(0.74);
      expect(inkDensity(i)).toBeLessThanOrEqual(1);
    }
    expect(inkGlyphs("𠮷野家").map((g) => g.ch)).toEqual(["𠮷", "野", "家"]);
  });
});

describe("机の UI 状態（U2 の分）", () => {
  const start = () => initialDeskState(sheetKey("save-a", 3));

  it("めくり位置は範囲に収め、キーごとに持つ", () => {
    let s = deskReducer(start(), { type: "page", key: pageKey.newspaper(2), to: 5, count: 2 });
    expect(s.pages[pageKey.newspaper(2)]).toBe(1);
    s = deskReducer(s, { type: "page", key: pageKey.ledger, to: -3, count: 4 });
    expect(s.pages[pageKey.ledger]).toBe(0);
  });

  it("新しい年になると台帳は最新の年に戻り、新聞の面は号ごとに残る", () => {
    let s = deskReducer(start(), { type: "page", key: pageKey.ledger, to: 0, count: 4 });
    s = deskReducer(s, { type: "page", key: pageKey.newspaper(2), to: 1, count: 2 });
    s = deskReducer(s, { type: "noteDraft", draft: { text: "書きかけ", target: "article:2:N-01" } });
    s = deskReducer(s, { type: "newSheet", key: sheetKey("save-a", 4) });
    expect(s.pages[pageKey.ledger]).toBeUndefined();
    expect(s.pages[pageKey.newspaper(2)]).toBe(1);
    // メモの書きかけは残し、去年の記事への留め先だけ外す
    expect(s.noteDraft).toEqual({ text: "書きかけ", target: "none" });
  });

  it("封を切った書簡は年と側近で覚える", () => {
    let s = deskReducer(start(), { type: "openLetter", key: letterKey(2, "elderSteward") });
    s = deskReducer(s, { type: "openLetter", key: letterKey(2, "elderSteward") });
    expect(s.opened).toEqual(["2:elderSteward"]);
  });

  it("既決箱から取り出す年と書類", () => {
    expect(deskReducer(start(), { type: "archive", turn: 1, doc: "result" }).archive).toEqual({ turn: 1, doc: "result" });
  });
});
