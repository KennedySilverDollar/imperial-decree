import { describe, expect, it } from "vitest";
import { LAMP_LIGHT, WINDOW_LIGHT, objectShadow, shadowLayer, tabletopLighting, toLocal } from "./lighting";

describe("擬似照明と影", () => {
  it("高いほど影は遠く・ぼけて・薄くなる", () => {
    const low = shadowLayer(LAMP_LIGHT, 0, 0, 4);
    const high = shadowLayer(LAMP_LIGHT, 0, 0, 40);
    expect(Math.hypot(high.x, high.y)).toBeGreaterThan(Math.hypot(low.x, low.y));
    expect(high.blur).toBeGreaterThan(low.blur);
    expect(high.alpha).toBeLessThanOrEqual(low.alpha);
  });

  it("ランプの影は、ランプから遠ざかる向きに落ちる", () => {
    const right = shadowLayer(LAMP_LIGHT, LAMP_LIGHT.x + 800, LAMP_LIGHT.y, 20);
    expect(right.x).toBeGreaterThan(0);
    const below = shadowLayer(LAMP_LIGHT, LAMP_LIGHT.x, LAMP_LIGHT.y + 800, 20);
    expect(below.y).toBeGreaterThan(0);
  });

  it("窓（右上）の影は左下へ落ちる", () => {
    const s = shadowLayer(WINDOW_LIGHT, 0, 0, 20);
    expect(s.x).toBeLessThan(0);
    expect(s.y).toBeGreaterThan(0);
  });

  it("机に接していれば影はずれない", () => {
    const flat = shadowLayer(LAMP_LIGHT, 500, 500, 0);
    expect(flat.x).toBeCloseTo(0);
    expect(flat.y).toBeCloseTo(0);
  });

  it("影のずれには上限がある", () => {
    const far = shadowLayer(LAMP_LIGHT, 5000, 5000, 300);
    expect(Math.hypot(far.x, far.y)).toBeLessThanOrEqual(70.0001);
  });

  it("机上の向きの分だけ、要素の座標へ逆に回す", () => {
    const local = toLocal({ x: 10, y: 0, blur: 1, alpha: 1 }, 90);
    expect(local.x).toBeCloseTo(0);
    expect(local.y).toBeCloseTo(-10);
  });

  it("影は接地＋2光源の3層（box-shadow と drop-shadow の両方）", () => {
    const shadow = objectShadow(0, 0, 8, 2);
    expect(shadow.box.split("), ").length).toBe(3);
    expect(shadow.drop.match(/drop-shadow\(/g)?.length).toBe(3);
  });

  it("天板の照明はランプの温かい光と縁の陰りを含む", () => {
    const css = tabletopLighting();
    expect(css).toContain("242 196 138");
    expect(css).toContain("36 24 13");
  });
});
