// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NOTES_STORAGE_KEY } from "../../domain/constants";
import type { GameState } from "../../domain/GameState";
import { memoryStorage, object, press, renderDesk } from "../../test/deskHarness";
import { playedState } from "../../test/gameApi";

// U2（書類の作り込み、SPEC_v3.3 §3.2・§4.2〜§4.4・§6・§7）のコンポーネントテスト。
vi.mock("phaser", () => {
  class Scene {}
  class Game {
    events = { on: () => {} };
    loop = { sleep: () => {}, wake: () => {} };
    destroy() {}
  }
  return { default: { Scene, Game, CANVAS: 1, Core: { Events: { POST_RENDER: "postrender" } } } };
});

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});

afterEach(() => cleanup());

let fourYears: GameState | null = null;
const played = async () => (fourYears ??= await playedState(13, ["道を造れ", "家を建てよ", "井戸を掘れ", "市場を開け"]));

const decreeField = () => document.querySelector<HTMLTextAreaElement>("textarea.decree-text")!;
const remainingText = () => screen.getByTestId("remaining").textContent ?? "";
const stampButton = () => screen.getByTestId("stamp") as HTMLButtonElement;

describe("勅令用紙（§4.2）", () => {
  it("付箋を1枚貼るごとに残り字数が5減り、超えると「超過」と書かれて判が押せない", async () => {
    await renderDesk({ flat: true });
    fireEvent.change(decreeField(), { target: { value: "道を造れ" } });
    expect(remainingText()).toContain("残り 36 字");
    fireEvent.change(document.querySelector(".tags label:nth-of-type(1) select")!, { target: { value: "road" } });
    expect(remainingText()).toContain("残り 31 字");
    expect(document.querySelector(".sticky-target")!.className).toContain("is-stuck");
    expect(stampButton().disabled).toBe(false);
    fireEvent.change(decreeField(), { target: { value: "あ".repeat(36) } });
    expect(remainingText()).toContain("残り -1 字");
    expect(remainingText()).toContain("超過");
    expect(stampButton().disabled).toBe(true);
  });

  it("本文は墨の写しで描かれ（文字ごとの濃さ）、入力そのものは textarea が受ける", async () => {
    await renderDesk({ flat: true });
    fireEvent.change(decreeField(), { target: { value: "道を造れ" } });
    const glyphs = document.querySelectorAll<HTMLElement>(".ink-mirror .ink-glyph");
    expect([...glyphs].map((g) => g.textContent).join("")).toBe("道を造れ");
    expect(glyphs[0]!.style.getPropertyValue("--ink-density")).not.toBe("");
    expect(decreeField().value).toBe("道を造れ");
  });
});

describe("側近書簡（§3.2）", () => {
  it.each([true, false])("平面=%s：届いた書簡は封蝋で閉じていて、割ると読める（割ったことを記録）", async (flat) => {
    const { api } = await renderDesk({ flat }, await played());
    const steward = object("letters").querySelector("[data-testid=envelope-elderSteward]");
    expect(steward).not.toBeNull();
    expect(object("letters").querySelector("[data-testid=report-elderSteward]")).toBeNull();
    const seal = screen.getByTestId("open-letter-elderSteward") as HTMLButtonElement;
    if (!flat) {
      // 俯瞰では割れない（手に取ってから）
      expect(seal.disabled).toBe(true);
      press("3");
    }
    fireEvent.click(screen.getByTestId("open-letter-elderSteward"));
    expect(object("letters").querySelector("[data-testid=report-elderSteward]")).not.toBeNull();
    expect(object("letters").querySelector("[data-testid=envelope-elderSteward]")).toBeNull();
    // もう一人はまだ封のまま
    expect(object("letters").querySelector("[data-testid=envelope-youngMerchant]")).not.toBeNull();
    expect(api.logged.filter((e) => e.event === "letter.opened")).toHaveLength(1);
  });
});

describe("新聞（§3.2）", () => {
  it("第一面に二面の欄を書き出し、手元で ← → でめくれる", async () => {
    await renderDesk({ flat: false }, await played());
    const paper = () => object("newspaper").querySelector<HTMLElement>("[data-testid=newspaper]")!;
    expect(paper().dataset.page).toBe("0");
    expect(paper().querySelector(".newspaper-continued")?.textContent).toContain("二面へ続く");
    press("ArrowRight"); // 俯瞰では効かない
    expect(paper().dataset.page).toBe("0");
    press("2");
    press("ArrowRight");
    expect(paper().dataset.page).toBe("1");
    press("ArrowLeft");
    expect(paper().dataset.page).toBe("0");
  });
});

describe("台帳（§6）", () => {
  it("1ページ＝1年。前の年へめくると政治資本は「記録なし」、最初は着任の年", async () => {
    await renderDesk({ flat: false }, await played());
    const ledger = () => object("ledger");
    expect(ledger().textContent).toContain("第4年の暮れ");
    expect(within(ledger()).getByTestId("capital")).toBeTruthy();
    expect(ledger().querySelectorAll(".sparkline")).toHaveLength(5);
    press("5");
    press("ArrowLeft");
    expect(ledger().textContent).toContain("第3年の暮れ");
    expect(ledger().textContent).toContain("記録なし");
    for (let i = 0; i < 5; i++) press("ArrowLeft");
    expect(ledger().textContent).toContain("着任の年");
    // 派生指標は載らない
    for (const hidden of ["住宅容量", "食料", "衛生", "治安", "行政能力", "労働人口"]) expect(ledger().textContent).not.toContain(hidden);
  });
});

describe("既決箱（§3.2）", () => {
  it("過ぎた年の新聞・書簡・結果の束を取り出して読める", async () => {
    const state = await played();
    await renderDesk({ flat: true }, state);
    const archive = () => object("archive");
    fireEvent.click(screen.getByTestId("archive-year-1"));
    expect(archive().textContent).toContain(state.history[0]!.newspaper.articles[0]!.headline);
    fireEvent.click(screen.getByTestId("archive-doc-letters"));
    expect(archive().querySelector("[data-testid=report-elderSteward]")).not.toBeNull();
    fireEvent.click(screen.getByTestId("archive-doc-result"));
    expect(archive().textContent).toContain("第1年の顛末");
    // 既決箱の束には「届いた束」の目印が付かない
    expect(archive().querySelector("[data-testid=result-sheets]")).toBeNull();
  });
});

describe("メモ（§7）", () => {
  it("書いて記事に留めると紙片が記事に付き、別のキーに保存され、読み直しても残る", async () => {
    const state = await played();
    const notesStorage = memoryStorage();
    const { api } = await renderDesk({ flat: true }, state, notesStorage);
    const front = state.history.at(-1)!.newspaper.articles[0]!;
    const notepad = object("notepad");
    fireEvent.change(notepad.querySelector("textarea")!, { target: { value: "倉庫の話は眉唾" } });
    fireEvent.change(screen.getByTestId("note-target"), { target: { value: `article:${state.history.at(-1)!.newspaper.turn}:${front.id}` } });
    fireEvent.click(screen.getByTestId("tear-note"));

    const pinned = within(object("newspaper")).getAllByTestId("pinned-note");
    expect(pinned).toHaveLength(1);
    expect(pinned[0]!.textContent).toContain("倉庫の話は眉唾");
    expect(notesStorage.getItem(NOTES_STORAGE_KEY)).toContain("倉庫の話は眉唾");
    expect(api.logged.find((e) => e.event === "note.created")?.data).toMatchObject({ chars: 7, attachedTo: "article" });

    cleanup();
    await renderDesk({ flat: false }, state, notesStorage);
    expect(within(object("newspaper")).getAllByTestId("pinned-note")[0]!.textContent).toContain("倉庫の話は眉唾");
    expect(within(object("notepad")).getAllByTestId("torn-note")).toHaveLength(1);
  });

  it("60字を超えるとちぎれない", async () => {
    await renderDesk({ flat: true });
    fireEvent.change(object("notepad").querySelector("textarea")!, { target: { value: "あ".repeat(61) } });
    expect(screen.getByTestId("note-count").textContent).toContain("残り -1 字");
    expect((screen.getByTestId("tear-note") as HTMLButtonElement).disabled).toBe(true);
  });

  it("メモは参謀にもゲームの状態にも渡らない", async () => {
    const { api } = await renderDesk({ flat: true, motion: "reduce" });
    const seen: string[] = [];
    const play = api.play;
    (api as { play: typeof play }).play = async (...args) => {
      seen.push(JSON.stringify(args));
      const result = await play(...args);
      seen.push(JSON.stringify(result));
      return result;
    };
    fireEvent.change(object("notepad").querySelector("textarea")!, { target: { value: "ひそかな覚え書き" } });
    fireEvent.click(screen.getByTestId("tear-note"));
    fireEvent.change(decreeField(), { target: { value: "道を造れ" } });
    fireEvent.click(stampButton());
    await screen.findByTestId("result-sheets", {}, { timeout: 3000 });
    expect(seen.length).toBe(2);
    for (const json of seen) expect(json).not.toContain("ひそかな覚え書き");
  });
});

describe("計測ログ（§13.2）", () => {
  it("手に取った物と手元にあった時間を、置いたときに記録する", async () => {
    const { api } = await renderDesk({ flat: false });
    press("5");
    press("Escape");
    press("7");
    press("2");
    const handled = api.logged.filter((e) => e.event === "desk.handled").map((e) => e.data);
    expect(handled).toEqual([
      expect.objectContaining({ object: "ledger", mode: "3d" }),
      expect.objectContaining({ object: "notepad", mode: "3d" }),
    ]);
    for (const h of handled) expect((h as { dwellMs: number }).dwellMs).toBeGreaterThanOrEqual(0);
  });
});

describe("一連の流れ（完了条件）", () => {
  it.each([true, false])(
    "平面=%s：勅令を書いて判を押し、結果束をめくって読み、台帳と既決箱で過去を確かめ、メモを書簡に留める",
    async (flat) => {
      const { api } = await renderDesk({ flat, motion: "reduce" }, await played());
      // 勅令を書いて判を押す
      if (!flat) press("4");
      fireEvent.change(decreeField(), { target: { value: "見張り塔を建てよ" } });
      fireEvent.change(document.querySelector(".tags label:nth-of-type(2) select")!, { target: { value: "small" } });
      fireEvent.click(stampButton());
      // 結果束をめくって読む（いちばん上の紙をクリック → 次の紙）
      await screen.findByTestId("result-sheets", {}, { timeout: 3000 });
      const current = () => screen.getByTestId("result-sheets").querySelector<HTMLElement>(".sheet-current")!;
      const firstTitle = current().querySelector(".sheet-title")!.textContent;
      fireEvent.pointerDown(current(), { button: 0, pointerId: 1, clientX: 300 });
      fireEvent.pointerUp(current(), { button: 0, pointerId: 1, clientX: 300 });
      expect(current().querySelector(".sheet-title")!.textContent).not.toBe(firstTitle);
      fireEvent.click(screen.getByTestId("close-result"));
      await waitFor(() => expect(screen.getByTestId("year").textContent).toBe("第6年"));
      expect(api.logged.find((e) => e.event === "result.closed")?.data).toMatchObject({ flips: 1 });

      // 台帳で過去の年を見る
      if (!flat) press("5");
      fireEvent.click(within(object("ledger")).getByText("前の年"));
      expect(object("ledger").textContent).toContain("第4年の暮れ");
      if (!flat) press("Escape");

      // 既決箱から去年の新聞を取り出す
      if (!flat) press("8");
      fireEvent.click(screen.getByTestId("archive-year-2"));
      expect(object("archive").querySelector("[data-testid=newspaper]")?.textContent).toContain("第2年");
      if (!flat) press("Escape");

      // 今年の書簡にメモを留める
      if (!flat) press("7");
      fireEvent.change(object("notepad").querySelector("textarea")!, { target: { value: "見張り塔の見積りを疑え" } });
      fireEvent.change(screen.getByTestId("note-target"), { target: { value: "aide:5:elderSteward" } });
      fireEvent.click(screen.getByTestId("tear-note"));
      if (!flat) {
        press("3");
      }
      fireEvent.click(screen.getByTestId("open-letter-elderSteward"));
      expect(within(object("letters")).getAllByTestId("pinned-note")[0]!.textContent).toContain("見張り塔の見積りを疑え");
    },
  );
});
