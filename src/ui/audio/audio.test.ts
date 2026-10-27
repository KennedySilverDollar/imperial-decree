import { describe, expect, it } from "vitest";
import { AudioService } from "./AudioService";
import { AMBIENCE, DEFAULT_VOLUMES, effectiveGain, SOUND_RECIPES } from "./soundRecipes";

// 音（SPEC_v3.3 §8.1）：一覧の場面がすべてあり、音量は3系統で既定は控えめ。Web Audio の無い環境では鳴らさずに進む

describe("効果音の一覧", () => {
  it("§8.1 の場面（手に取る・置く・新聞・めくる・封蝋・筆記・付箋・判子・地図の描き込み・配達）がすべてある", () => {
    const scenes = Object.values(SOUND_RECIPES).map((r) => r.scene).join("／");
    for (const scene of ["手に取る", "置く", "新聞を広げる", "めくる", "封蝋", "筆記", "付箋", "判子", "地図の描き込み", "足音", "書類が置かれる"]) expect(scenes).toContain(scene);
    // 環境音：ランプ・雨・風
    expect(Object.keys(AMBIENCE).sort()).toEqual(["lamp", "rain", "wind"]);
  });

  it("どの音も短く（2秒以内）、音量は 1 を超えない。筆記音は間引く", () => {
    for (const recipe of Object.values(SOUND_RECIPES))
      for (const layer of recipe.layers) {
        expect((layer.delay ?? 0) + layer.attack + layer.decay).toBeLessThanOrEqual(2);
        expect(layer.gain).toBeLessThanOrEqual(1);
      }
    expect(SOUND_RECIPES.brush.minInterval).toBeGreaterThan(0);
  });
});

describe("音量", () => {
  it("主音量 × 系統。既定は控えめ（効果音 0.3、環境音 0.15）。範囲外は 0..1 に収める", () => {
    expect(effectiveGain(DEFAULT_VOLUMES, "sfx")).toBeCloseTo(0.3);
    expect(effectiveGain(DEFAULT_VOLUMES, "ambient")).toBeCloseTo(0.15);
    expect(effectiveGain({ master: 2, sfx: -1, ambient: 1 }, "sfx")).toBe(0);
    expect(effectiveGain({ master: 0, sfx: 1, ambient: 1 }, "ambient")).toBe(0);
  });

  it("Web Audio が無ければ何も鳴らさないが、止まらない（鳴らそうとした記録だけ残る）", () => {
    const service = new AudioService(() => null);
    service.unlock();
    service.setVolumes({ master: 1, sfx: 1, ambient: 1 });
    service.setAmbience("winter", "rain");
    service.play("stamp");
    service.playFor("pen", 0.5);
    expect(service.played[0]).toBe("stamp");
    expect(service.played.filter((s) => s === "pen").length).toBeGreaterThan(1);
    service.dispose();
  });
});
