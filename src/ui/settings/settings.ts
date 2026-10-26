import { useCallback, useEffect, useState } from "react";
import { TEXT_SCALES } from "../desk/deskConstants";

// 設定（SPEC_v3.3 §9）：平面モード・動きを減らす・手元の文字サイズ・開発用の FPS 表示。
// 表現層が書き込めるのは PlayerNotes と設定だけ（不変条件17）。セーブとは別のキーに保存する。

export type TextSize = keyof typeof TEXT_SCALES;
/** 動きを減らす：OS の設定（prefers-reduced-motion）に従う / 常に減らす / 減らさない */
export type MotionPreference = "system" | "reduce" | "full";

export interface Settings {
  readonly flat: boolean;
  readonly motion: MotionPreference;
  readonly textSize: TextSize;
  readonly showFps: boolean;
}

export const DEFAULT_SETTINGS: Settings = { flat: false, motion: "system", textSize: "normal", showFps: false };
export const SETTINGS_STORAGE_KEY = "imperial-decree/settings";

export const TEXT_SIZES: readonly TextSize[] = ["normal", "large", "xlarge"];
export const MOTION_PREFERENCES: readonly MotionPreference[] = ["system", "reduce", "full"];

const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
  typeof value === "string" && (options as readonly string[]).includes(value) ? (value as T) : fallback;

/** 壊れた値・古い形でも既定値で埋めて読む */
export const parseSettings = (raw: string | null): Settings => {
  if (raw === null) return DEFAULT_SETTINGS;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_SETTINGS;
  }
  if (typeof parsed !== "object" || parsed === null) return DEFAULT_SETTINGS;
  const p = parsed as Record<string, unknown>;
  return {
    flat: typeof p.flat === "boolean" ? p.flat : DEFAULT_SETTINGS.flat,
    motion: oneOf(p.motion, MOTION_PREFERENCES, DEFAULT_SETTINGS.motion),
    textSize: oneOf(p.textSize, TEXT_SIZES, DEFAULT_SETTINGS.textSize),
    showFps: typeof p.showFps === "boolean" ? p.showFps : DEFAULT_SETTINGS.showFps,
  };
};

export type SettingsStorage = Pick<Storage, "getItem" | "setItem">;

export const loadSettings = (storage: SettingsStorage | null): Settings => {
  if (storage === null) return DEFAULT_SETTINGS;
  try {
    return parseSettings(storage.getItem(SETTINGS_STORAGE_KEY));
  } catch {
    return DEFAULT_SETTINGS;
  }
};

export const saveSettings = (storage: SettingsStorage | null, settings: Settings): void => {
  try {
    storage?.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // 保存できなくても、この画面の間は効く
  }
};

export const resolveReducedMotion = (preference: MotionPreference, systemReduced: boolean): boolean =>
  preference === "reduce" || (preference === "system" && systemReduced);

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** OS の「視差効果を減らす」に追従する */
export const useSystemReducedMotion = (): boolean => {
  const [query] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(REDUCED_MOTION_QUERY) : null,
  );
  const [reduced, setReduced] = useState(query?.matches ?? false);
  useEffect(() => {
    if (query === null) return;
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [query]);
  return reduced;
};

export const useSettings = (storage: SettingsStorage | null): readonly [Settings, (patch: Partial<Settings>) => void] => {
  const [settings, setSettings] = useState<Settings>(() => loadSettings(storage));
  const update = useCallback(
    (patch: Partial<Settings>) =>
      setSettings((current) => {
        const next = { ...current, ...patch };
        saveSettings(storage, next);
        return next;
      }),
    [storage],
  );
  return [settings, update];
};
