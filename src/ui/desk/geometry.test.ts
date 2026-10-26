import { describe, expect, it } from "vitest";
import { DESK_AREA, DESK_PERSPECTIVE_PX, DESK_TILT_DEG, FOCUS_GAP_PX, FOCUS_MARGIN_PX } from "./deskConstants";
import { fitDesk, focusSlots, overviewTransform, project, screenPoint } from "./geometry";
import { DESK_OBJECTS, DESK_OBJECT_IDS } from "./objects";

const STAGES = [
  { width: 1280, height: 668 },
  { width: 1440, height: 848 },
  { width: 1920, height: 1028 },
];

describe("机の幾何", () => {
  it("奥ほど小さく、手前ほど大きく映る（遠近）", () => {
    const far = project({ x: 100, y: -500 }, 0.5);
    const near = project({ x: 100, y: 500 }, 0.5);
    expect(Math.abs(far.x)).toBeLessThan(50);
    expect(Math.abs(near.x)).toBeGreaterThan(50);
    expect(far.y).toBeLessThan(0);
    expect(near.y).toBeGreaterThan(0);
  });

  it("持ち上げると画面の上へずれる", () => {
    expect(project({ x: 0, y: 0, z: 30 }, 0.5).y).toBeLessThan(0);
  });

  it.each(STAGES)("書類の領域が画面に収まる（$width×$height）", (stage) => {
    const fit = fitDesk(stage);
    const corners = [
      { x: -DESK_AREA.width / 2, y: -DESK_AREA.height / 2 },
      { x: DESK_AREA.width / 2, y: -DESK_AREA.height / 2 },
      { x: -DESK_AREA.width / 2, y: DESK_AREA.height / 2 },
      { x: DESK_AREA.width / 2, y: DESK_AREA.height / 2 },
    ].map((p) => screenPoint(p, fit));
    for (const c of corners) {
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.x).toBeLessThanOrEqual(stage.width);
      expect(c.y).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeLessThanOrEqual(stage.height);
    }
    // 収まる範囲で大きく使う
    expect(fitDesk(stage, 1.02).scale).toBeGreaterThan(fit.scale);
  });

  it.each(STAGES)("すべての物の置き場が画面の中に映る（$width×$height）", (stage) => {
    const fit = fitDesk(stage);
    for (const id of DESK_OBJECT_IDS) {
      const p = screenPoint(DESK_OBJECTS[id].home, fit);
      expect(p.x, id).toBeGreaterThan(0);
      expect(p.x, id).toBeLessThan(stage.width);
      expect(p.y, id).toBeGreaterThan(0);
      expect(p.y, id).toBeLessThan(stage.height);
    }
  });

  it("手元の置き場：1枚なら中央、勅令用紙と判子は重ならずに並ぶ", () => {
    const width = 1440;
    const slots = focusSlots(width, "newspaper", false);
    const news = slots.newspaper;
    expect(news.left + DESK_OBJECTS.newspaper.width / 2).toBeCloseTo(width / 2);
    expect(news.top).toBe(FOCUS_MARGIN_PX);
    const decree = slots.decree;
    const stamp = slots.stamp;
    expect(stamp.left).toBe(decree.left + DESK_OBJECTS.decree.width + FOCUS_GAP_PX);
    const pairCenter = (decree.left + stamp.left + DESK_OBJECTS.stamp.width) / 2;
    expect(pairCenter).toBeCloseTo(width / 2);
  });

  it("並べ読み：地図が左、読む書類が右", () => {
    const slots = focusSlots(1440, "letters", true);
    expect(slots.map.left + DESK_OBJECTS.map.width + FOCUS_GAP_PX).toBe(slots.letters.left);
    // 並べ読みでない書類の置き場は変わらない
    expect(focusSlots(1440, "ledger", true).map).toEqual(focusSlots(1440, null, false).map);
  });

  it("狭い画面でも置き場は画面の左の余白より内側", () => {
    const slots = focusSlots(500, "decree", false);
    expect(slots.decree.left).toBeGreaterThanOrEqual(FOCUS_MARGIN_PX);
  });

  it("俯瞰の変形は共通の原点・傾き・遠近を使う", () => {
    const fit = fitDesk({ width: 1440, height: 848 });
    const slot = { left: 300, top: 20 };
    const placed = overviewTransform(slot, DESK_OBJECTS.map.width, DESK_OBJECTS.map.home, fit);
    expect(placed.transform).toContain(`perspective(${DESK_PERSPECTIVE_PX}px)`);
    expect(placed.transform).toContain(`rotateX(calc(${DESK_TILT_DEG}deg + var(--parallax-x, 0deg)))`);
    expect(placed.transform).toContain("var(--lift, 0px)");
    const [ox, oy] = placed.transformOrigin.split(" ").map((v) => Number.parseFloat(v));
    expect(ox).toBeCloseTo(fit.originX - slot.left, 2);
    expect(oy).toBeCloseTo(fit.originY - slot.top, 2);
  });
});
