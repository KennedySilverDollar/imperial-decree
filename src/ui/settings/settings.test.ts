import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, loadSettings, parseSettings, resolveReducedMotion, saveSettings, SETTINGS_STORAGE_KEY } from "./settings";

const memory = () => {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
};

describe("設定", () => {
  it("無い・壊れた・古い形は既定値で埋めて読む", () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("{oops")).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("42")).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(JSON.stringify({ flat: true, textSize: "huge", motion: 3 }))).toEqual({ ...DEFAULT_SETTINGS, flat: true });
  });

  it("保存して読み戻せる（セーブとは別のキー）", () => {
    const storage = memory();
    const s = { flat: true, motion: "reduce", textSize: "xlarge", showFps: true } as const;
    saveSettings(storage, s);
    expect(storage.getItem(SETTINGS_STORAGE_KEY)).not.toBeNull();
    expect(loadSettings(storage)).toEqual(s);
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it("動きを減らす：既定は OS に従い、設定で上書きできる", () => {
    expect(resolveReducedMotion("system", true)).toBe(true);
    expect(resolveReducedMotion("system", false)).toBe(false);
    expect(resolveReducedMotion("reduce", false)).toBe(true);
    expect(resolveReducedMotion("full", true)).toBe(false);
  });
});
