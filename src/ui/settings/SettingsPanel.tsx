import { useEffect, useRef } from "react";
import { messages } from "../../i18n/messages";
import { MOTION_PREFERENCES, TEXT_SIZES, type Settings } from "./settings";

const VOLUME_KEYS = ["master", "sfx", "ambient"] as const;

// 設定の紙（SPEC_v3.3 §8.1・§9）。机の上ではなく画面の手前に、変形なしで出す。

interface Props {
  readonly settings: Settings;
  readonly onChange: (patch: Partial<Settings>) => void;
  readonly lowPower: boolean;
  readonly onClose: () => void;
}

export function SettingsPanel({ settings, onChange, lowPower, onClose }: Props) {
  const t = messages.ui.settings;
  const sheet = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    sheet.current?.focus();
    // 机の操作より先に Esc を受けて、設定だけを閉じる
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close.current();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, []);

  return (
    <div className="overlay fade-in" role="dialog" aria-modal="true" aria-label={t.title} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="paper settings-sheet" ref={sheet} tabIndex={-1} data-testid="settings">
        <h2 className="settings-title">{t.title}</h2>
        <label className="settings-row">
          <input type="checkbox" checked={settings.flat} onChange={(e) => onChange({ flat: e.target.checked })} data-testid="setting-flat" />
          {t.flat}
        </label>
        <label className="settings-row">
          <span className="settings-label">{t.motion}</span>
          <select
            value={settings.motion}
            onChange={(e) => onChange({ motion: e.target.value as Settings["motion"] })}
            data-testid="setting-motion"
          >
            {MOTION_PREFERENCES.map((m) => (
              <option key={m} value={m}>
                {t.motionOptions[m]}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="settings-row settings-sizes">
          <legend className="settings-label">{t.textSize}</legend>
          {TEXT_SIZES.map((size) => (
            <label key={size}>
              <input
                type="radio"
                name="text-size"
                value={size}
                checked={settings.textSize === size}
                onChange={() => onChange({ textSize: size })}
                data-testid={`setting-text-${size}`}
              />
              {t.textSizes[size]}
            </label>
          ))}
        </fieldset>
        <fieldset className="settings-row settings-volumes">
          <legend className="settings-label">{t.volume}</legend>
          {VOLUME_KEYS.map((key) => (
            <label key={key} className="settings-volume">
              <span>{t.volumes[key]}</span>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={Math.round(settings.volume[key] * 100)}
                onChange={(e) => onChange({ volume: { ...settings.volume, [key]: Number(e.target.value) / 100 } })}
                data-testid={`setting-volume-${key}`}
              />
              <span className="settings-volume-value">{Math.round(settings.volume[key] * 100)}</span>
            </label>
          ))}
        </fieldset>
        <label className="settings-row settings-dev">
          <input type="checkbox" checked={settings.showFps} onChange={(e) => onChange({ showFps: e.target.checked })} data-testid="setting-fps" />
          {t.showFps}
        </label>
        {lowPower && <p className="panel-note">{t.lowPower}</p>}
        <div className="settings-actions">
          <button className="button primary" onClick={onClose} data-testid="close-settings">
            {t.close}
          </button>
        </div>
      </div>
    </div>
  );
}
