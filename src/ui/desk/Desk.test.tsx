// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { INFO_OBJECTS, object, press, readable, readAll, renderDesk, underPerspective, WRITABLE } from "../../test/deskHarness";
import { playedState } from "../../test/gameApi";
import { DESK_PERSPECTIVE_PX } from "./deskConstants";

// 地図は Phaser（canvas）で描くが、jsdom には canvas が無いので Phaser だけ差し替える。地図の文字情報（凡例・普請中）は DOM なので比べられる。
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
  // jsdom に無いものを足す（ブラウザには必ずある）
  Element.prototype.scrollIntoView = () => {};
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("表示される情報は、平面モードと立体の机で同じ", () => {
  it("俯瞰の机と平面の机で、各書類の中身が一致する（勅令用紙は手元で比べる）", async () => {
    const saved = await playedState(7, ["道を造れ", "家を建てよ"]);

    await renderDesk({ flat: true }, saved);
    const flat = readAll();
    cleanup();

    await renderDesk({ flat: false }, saved);
    const overview = readAll();
    for (const id of INFO_OBJECTS.filter((id) => !(WRITABLE as readonly string[]).includes(id))) expect(overview[id], id).toBe(flat[id]);
    expect(flat.newspaper.length).toBeGreaterThan(50);
    expect(flat.result).toContain("顛末");

    // 勅令用紙は俯瞰では読むだけの紙。手に取ると平面と同じ入力欄になる
    expect(overview.decree).toContain("残り 40 字");
    press("4");
    expect(readable(object("decree"))).toBe(flat.decree);
    expect(readable(object("stamp"))).toBe(flat.stamp);
    press("7");
    expect(readable(object("notepad"))).toBe(flat.notepad);
  });

  it("書きかけは俯瞰の紙にも同じ文面・残り字数で写る", async () => {
    await renderDesk({ flat: false });
    press("4");
    fireEvent.change(document.querySelector("textarea.decree-text")!, { target: { value: "井戸を掘れ" } });
    press("Escape");
    expect(screen.getByTestId("decree-preview").textContent).toBe("井戸を掘れ");
    expect(readable(object("decree"))).toContain("残り 35 字");
  });
});

describe("立体の机：俯瞰と手元", () => {
  it("クリックで手に取ると変形が外れ、Esc・右クリック・空いた所のクリックで置く", async () => {
    await renderDesk({ flat: false }, await playedState(3, ["道を造れ"]));
    const news = object("newspaper");
    expect(news.dataset.state).toBe("overview");
    expect(news.style.transform).toContain(`perspective(${DESK_PERSPECTIVE_PX}px)`);

    fireEvent.click(news);
    expect(news.dataset.state).toBe("focused");
    expect(news.style.transform).toBe("none");
    expect(screen.getByTestId("focus-backdrop").className).toContain("is-active");
    expect(object("map").dataset.state).toBe("overview");

    press("Escape");
    expect(news.dataset.state).toBe("overview");

    fireEvent.click(object("ledger"));
    fireEvent.contextMenu(object("ledger"));
    expect(object("ledger").dataset.state).toBe("overview");

    press("3");
    fireEvent.click(screen.getByTestId("focus-backdrop"));
    expect(object("letters").dataset.state).toBe("overview");
  });

  it("入力欄は手元（変形なし）にしか無い（不変条件25）", async () => {
    await renderDesk({ flat: false });
    expect(document.querySelector("textarea")).toBeNull();
    expect(document.querySelectorAll("select")).toHaveLength(0);

    press("4");
    const field = document.querySelector<HTMLTextAreaElement>("textarea.decree-text")!;
    expect(field).not.toBeNull();
    expect(document.activeElement).toBe(field);
    expect(underPerspective(field)).toBe(false);
    for (const select of document.querySelectorAll("select")) expect(underPerspective(select)).toBe(false);
    // 判子は勅令用紙と一緒に手元へ来る
    expect(object("stamp").dataset.state).toBe("companion");
    expect(underPerspective(screen.getByTestId("stamp"))).toBe(false);
  });

  it("俯瞰の物は中身に触れず、物ごと手に取るボタンになる", async () => {
    await renderDesk({ flat: false }, await playedState(5, ["道を造れ"]));
    const letters = object("letters");
    expect(letters.getAttribute("role")).toBe("button");
    expect(letters.querySelector(".desk-object-content")!.hasAttribute("inert")).toBe(true);
    fireEvent.keyDown(letters, { key: "Enter" });
    expect(letters.dataset.state).toBe("focused");
    expect(letters.querySelector(".desk-object-content")!.hasAttribute("inert")).toBe(false);
  });

  it("俯瞰でかざすと、物の名前の小札が（変形なしで）出る", async () => {
    await renderDesk({ flat: false });
    fireEvent.pointerEnter(object("ledger"));
    const tag = screen.getByTestId("desk-tag");
    expect(tag.textContent).toBe("台帳");
    expect(underPerspective(tag)).toBe(false);
    fireEvent.pointerLeave(object("ledger"));
    expect(screen.queryByTestId("desk-tag")).toBeNull();
    // 飾り（ランプ）には出ない
    fireEvent.pointerEnter(object("lamp"));
    expect(screen.queryByTestId("desk-tag")).toBeNull();
  });

  it("Tab で新聞・書簡と地図を並べ読みする", async () => {
    await renderDesk({ flat: false }, await playedState(5, ["道を造れ"]));
    press("2");
    press("Tab");
    expect(object("map").dataset.state).toBe("companion");
    expect(object("map").style.transform).toBe("none");
    press("Tab");
    expect(object("map").dataset.state).toBe("overview");
  });

  it("結果の書類束は ← → でめくれ、置くとめくり方が記録される", async () => {
    const { api } = await renderDesk({ flat: false, motion: "reduce" });
    press("4");
    fireEvent.change(document.querySelector("textarea.decree-text")!, { target: { value: "道を造れ" } });
    fireEvent.click(screen.getByTestId("stamp"));
    await screen.findByTestId("result-sheets", {}, { timeout: 3000 });
    expect(object("result").dataset.state).toBe("focused");
    press("ArrowRight");
    press("ArrowRight");
    press("ArrowLeft");
    press("Escape");
    const closed = api.logged.find((e) => e.event === "result.closed");
    expect(closed?.data).toMatchObject({ flips: 3, deepestSheet: 3 });
    // もう一度手に取っても、記録は増えない
    press("6");
    press("Escape");
    expect(api.logged.filter((e) => e.event === "result.closed")).toHaveLength(1);
  });
});

describe("平面モード", () => {
  it("書類はすべて平らなパネルで、遠近の変形が一切ない", async () => {
    await renderDesk({ flat: true }, await playedState(5, ["道を造れ"]));
    expect(document.querySelector(".desk-object")).toBeNull();
    for (const id of INFO_OBJECTS) expect(object(id).classList.contains("flat-object"), id).toBe(true);
    for (const el of document.querySelectorAll<HTMLElement>("[style]")) expect(el.style.transform).toBe("");
    // 入力欄は最初から使える
    expect(document.querySelector("textarea.decree-text")).not.toBeNull();
  });

  it("6 で結果の書類束をもう一度手元（重ねた紙）に出し、Esc で戻す", async () => {
    await renderDesk({ flat: true }, await playedState(5, ["道を造れ"]));
    press("6");
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByTestId("result-sheets")).toBeTruthy();
    press("Escape");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("1年ずつ遊べる（平面・立体）", () => {
  it.each([true, false])("平面モード=%s：勅令→判→結果→机に戻る、を3年", async (flat) => {
    const { api } = await renderDesk({ flat, motion: "reduce" });
    for (let year = 1; year <= 3; year++) {
      if (!flat) press("4");
      fireEvent.change(document.querySelector("textarea.decree-text")!, { target: { value: "道を造れ" } });
      fireEvent.click(screen.getByTestId("stamp"));
      await screen.findByTestId("result-sheets", {}, { timeout: 3000 });
      fireEvent.click(screen.getByTestId("close-result"));
      await waitFor(() => expect(screen.getByTestId("year").textContent).toBe(`第${year + 1}年`));
    }
    expect(api.logged.filter((e) => e.event === "turn.resolved")).toHaveLength(3);
    expect(api.logged.filter((e) => e.event === "result.closed")).toHaveLength(3);
  });

  it("立体の机では、用紙を手に取っていないと判は押せない", async () => {
    await renderDesk({ flat: false });
    press("4");
    fireEvent.change(document.querySelector("textarea.decree-text")!, { target: { value: "道を造れ" } });
    expect((screen.getByTestId("stamp") as HTMLButtonElement).disabled).toBe(false);
    press("Escape");
    expect((screen.getByTestId("stamp") as HTMLButtonElement).disabled).toBe(true);
  });

  it("平面⇄立体を切り替えても、書きかけは残る", async () => {
    await renderDesk({ flat: false });
    press("4");
    fireEvent.change(document.querySelector("textarea.decree-text")!, { target: { value: "市場を開け" } });
    fireEvent.click(screen.getByTestId("open-settings"));
    fireEvent.click(screen.getByTestId("setting-flat"));
    fireEvent.click(screen.getByTestId("close-settings"));
    expect(screen.getByTestId("flat-desk")).toBeTruthy();
    expect(document.querySelector<HTMLTextAreaElement>("textarea.decree-text")!.value).toBe("市場を開け");
  });
});

describe("動きを減らす（prefers-reduced-motion）", () => {
  const stubMatchMedia = (reduced: boolean) =>
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: reduced && query.includes("prefers-reduced-motion"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));

  it("OS が動きを減らす設定なら、手に取る遷移が即時になり押印の待ちも縮む", async () => {
    stubMatchMedia(true);
    await renderDesk({ flat: false });
    const desk = screen.getByTestId("desk");
    expect(desk.className).toContain("reduce-motion");
    expect(desk.style.getPropertyValue("--focus-ms")).toBe("0ms");
    expect(desk.style.getPropertyValue("--stamp-ms")).toBe("200ms");
  });

  it("OS の設定がなければ通常の長さ。設定で「減らさない」を選べば OS より優先", async () => {
    stubMatchMedia(false);
    await renderDesk({ flat: false });
    expect(screen.getByTestId("desk").style.getPropertyValue("--focus-ms")).toBe("350ms");
    cleanup();
    stubMatchMedia(true);
    await renderDesk({ flat: false, motion: "full" });
    expect(screen.getByTestId("desk").className).not.toContain("reduce-motion");
  });
});
