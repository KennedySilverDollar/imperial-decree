// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createInitialState } from "../../domain/GameState";
import { projectMapView } from "../game/projectMapView";
import { MapPanel } from "./MapPanel";

// 地図パネル：外側の構造（クラス名・data-testid）を保ち（AA-14）、地形の状態を data-terrain-ready で示す（SPEC_v3.4 §9）。
// jsdom には Worker と canvas がないので、地形は作れず抽象グリッドに戻る（不変条件29）。
vi.mock("phaser", () => {
  class Scene {}
  class Game {
    events = { on: () => {} };
    loop = { sleep: () => {}, wake: () => {} };
    destroy() {}
  }
  return { default: { Scene, Game, CANVAS: 1, Core: { Events: { POST_RENDER: "postrender" } } } };
});

afterEach(() => cleanup());

describe("MapPanel", () => {
  it("外側の構造と data-testid を保ち、Worker がない環境では fallback（抽象グリッド）", () => {
    const view = projectMapView(createInitialState(1));
    const { container } = render(<MapPanel view={view} works={[]} />);
    const panel = container.querySelector(".map-panel");
    expect(panel).not.toBeNull();
    expect(panel?.getAttribute("data-terrain-ready")).toBe("fallback");
    expect(container.querySelector("[data-testid=map-canvas]")).not.toBeNull();
    expect(container.querySelector("[data-testid=works]")).not.toBeNull();
    expect(container.querySelector(".map-legend")).not.toBeNull();
    expect(container.querySelector(".map-surveying")).toBeNull();
  });
});
