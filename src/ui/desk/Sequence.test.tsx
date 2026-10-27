// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { GameState } from "../../domain/GameState";
import { OFFICE_TILE } from "../../domain/Map";
import { gazetteerFor } from "../../engine/Gazetteer";
import { object, press, renderDesk, storageWith } from "../../test/deskHarness";
import { makeTestGameApi } from "../../test/gameApi";
import { AudioService } from "../audio/AudioService";
import { App } from "../App";
import { render } from "@testing-library/react";
import { playedState } from "../../test/gameApi";

// ターン遷移シーケンス（SPEC_v3.3 §4.5）・エンディングの分岐・並べ読み（§4.6）を、机の上の動作として確かめる
vi.mock("phaser", () => {
  class Scene {}
  class Game {
    events = { on: () => {} };
    loop = { sleep: () => {}, wake: () => {} };
    destroy() {}
  }
  return { default: { Scene, Game, CANVAS: 1, Scale: { NONE: 0 }, Core: { Events: { POST_RENDER: "postrender" } } } };
});

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});
afterEach(cleanup);

const desk = () => screen.getByTestId("desk");
const step = () => desk().getAttribute("data-sequence-step");
const decreeField = () => document.querySelector<HTMLTextAreaElement>("textarea.decree-text")!;

const stampDecree = (flat: boolean, text = "家を建てよ") => {
  if (!flat) press("4");
  fireEvent.change(decreeField(), { target: { value: text } });
  fireEvent.click(screen.getByTestId("stamp"));
};

describe("ターン遷移シーケンス", () => {
  it("押印 → 既決箱 → 窓の光 → 地図 → 配達 → 台帳の順に進み、終わってから結果束が手元に来る（合計4〜6秒）", async () => {
    await renderDesk({ flat: false, motion: "full" }, await playedState(3, ["道を造れ"]));
    const seen: string[] = [];
    const observer = new MutationObserver(() => {
      const s = step() ?? "";
      if (seen.at(-1) !== s) seen.push(s);
    });
    observer.observe(desk(), { attributes: true, attributeFilter: ["data-sequence-step"] });
    stampDecree(false);
    await waitFor(() => expect(step()).toBe("delivery"), { timeout: 5000 });
    // 配達の段では、結果束はまだ机の上
    expect(object("result").getAttribute("data-state")).toBe("overview");
    await waitFor(() => expect(step()).toBe("idle"), { timeout: 3000 });
    observer.disconnect();
    expect(seen.filter((s) => s !== "waiting")).toEqual(["stamp", "file", "weather", "map", "delivery", "ledger", "idle"]);
    expect(object("result").getAttribute("data-state")).toBe("focused");
    const total = Number(desk().getAttribute("data-sequence-total-ms"));
    expect(total).toBeGreaterThanOrEqual(4000);
    expect(total).toBeLessThanOrEqual(6500);
  }, 15000);

  it("クリックで飛ばせる：すぐに結果束が手元に来る", async () => {
    await renderDesk({ flat: false, motion: "full" }, await playedState(4, ["道を造れ"]));
    stampDecree(false);
    fireEvent.click(screen.getByTestId("sequence-skip"));
    await waitFor(() => expect(object("result").getAttribute("data-state")).toBe("focused"), { timeout: 1500 });
    expect(step()).toBe("idle");
  });

  it("動きを減らす：遷移は短くなる（計画は約1秒。jsdom の処理の遅れを見込んで 2 秒以内）", async () => {
    await renderDesk({ flat: true, motion: "reduce" }, await playedState(5, ["道を造れ"]));
    stampDecree(true);
    await waitFor(() => expect(step()).toBe("idle"), { timeout: 3000 });
    expect(Number(desk().getAttribute("data-sequence-total-ms"))).toBeLessThanOrEqual(2000);
  });
});

/** 次の年で成功（町）になる状態：人口・インフラを満たし、役所を建てておく */
const nearSuccess = async (): Promise<GameState> => {
  const state = await playedState(6, ["道を造れ"]);
  const hasOffice = state.buildings.some((b) => b.kind === "office");
  return {
    ...state,
    params: { ...state.params, population: 420, infrastructure: 40, happiness: 70, treasury: 2000 },
    buildings: hasOffice
      ? state.buildings
      : [...state.buildings, { serial: 999, kind: "office", builtTurn: 1, hollow: false, disclosed: false, tile: OFFICE_TILE as [number, number] }],
  };
};

describe("エンディングの演出", () => {
  it("成功の年：地図に町の印章が押され、そのあとエンディングの画面", async () => {
    await renderDesk({ flat: false, motion: "reduce" }, await nearSuccess());
    stampDecree(false);
    await waitFor(() => expect(step()).toBe("ending"), { timeout: 3000 });
    expect(screen.getByTestId("town-seal")).toBeTruthy();
    expect(screen.queryByTestId("ending")).toBeNull();
    // 最後の年の結果束を読んでから、置くとエンディングの画面
    await waitFor(() => expect(object("result").getAttribute("data-state")).toBe("focused"), { timeout: 3000 });
    expect(screen.getByTestId("town-seal")).toBeTruthy();
    fireEvent.click(screen.getByTestId("close-result"));
    await screen.findByTestId("ending", {}, { timeout: 3000 });
    expect(screen.getByTestId("town-seal")).toBeTruthy();
    expect(desk().className).not.toContain("lamp-out");
  });

  it("ゲームオーバーの年：ランプが消え（机が暗くなり）、そのあとエンディングの画面", async () => {
    const state = await playedState(7, ["道を造れ"]);
    await renderDesk({ flat: false, motion: "reduce" }, { ...state, params: { ...state.params, treasury: -5000 } });
    stampDecree(false);
    await waitFor(() => expect(step()).toBe("ending"), { timeout: 3000 });
    expect(desk().className).toContain("lamp-out");
    expect(document.querySelector(".lamp.is-out")).not.toBeNull();
    await waitFor(() => expect(object("result").getAttribute("data-state")).toBe("focused"), { timeout: 3000 });
    // 最後の結果束を読むあいだも、ランプは消えたまま
    expect(desk().className).toContain("lamp-out");
    fireEvent.click(screen.getByTestId("close-result"));
    await screen.findByTestId("ending", {}, { timeout: 3000 });
    expect(desk().className).toContain("lamp-out");
  });
});

describe("並べ読み", () => {
  it("平面モード：新聞の地名にかざすと、地図のその区域の区画が示され、離すと消える", async () => {
    const state = await playedState(8, ["家を建てよ", "畑を開け", "家を建てよ"]);
    await renderDesk({ flat: true }, state);
    const refs = within(object("newspaper")).queryAllByTestId("map-ref");
    const zones = Object.values(gazetteerFor(state.saveId).zones);
    const place = refs.find((r) => zones.includes(r.textContent ?? ""));
    expect(place).toBeDefined();
    const frame = screen.getByTestId("map-canvas");
    fireEvent.pointerEnter(place!);
    await waitFor(() => expect(Number(frame.getAttribute("data-highlighted"))).toBeGreaterThan(0));
    fireEvent.pointerLeave(place!);
    await waitFor(() => expect(frame.getAttribute("data-highlighted")).toBeNull());
  });

  it("立体の机：書類を手に取っただけでは印は無く、Tab で地図を並べると印が付く", async () => {
    await renderDesk({ flat: false }, await playedState(9, ["家を建てよ", "畑を開け"]));
    press("2");
    expect(within(object("newspaper")).queryAllByTestId("map-ref")).toHaveLength(0);
    press("Tab");
    await waitFor(() => expect(within(object("newspaper")).queryAllByTestId("map-ref").length).toBeGreaterThan(0));
  });
});

describe("音（§8.1）", () => {
  it("1年の流れで、手に取る・筆記・判子・地図のペン・配達・封蝋の音を鳴らす", async () => {
    const audio = new AudioService(() => null);
    const api = makeTestGameApi({ saved: await playedState(10, ["家を建てよ"]), seed: 11 });
    render(<App api={api} settingsStorage={storageWith({ flat: false, motion: "reduce" })} fpsFromQuery={false} audio={audio} />);
    await screen.findByTestId("year");
    stampDecree(false, "道を造れ");
    await waitFor(() => expect(object("result").getAttribute("data-state")).toBe("focused"), { timeout: 3000 });
    fireEvent.click(screen.getByTestId("close-result"));
    press("3");
    fireEvent.click(screen.getAllByTestId(/open-letter-/)[0]!);
    for (const id of ["pickUp", "brush", "stamp", "pen", "footsteps", "delivered", "putDown", "waxCrack"] as const) expect(audio.played, id).toContain(id);
  });
});
