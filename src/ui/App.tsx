import { Desk } from "./desk/Desk";
import type { GameApi } from "./game/GameApi";
import { useGameSession } from "./game/useGameSession";
import { useSettings, useSystemReducedMotion, type SettingsStorage } from "./settings/settings";

// 画面全体。ゲームの進行は useGameSession（TurnMachine へのアダプタ）、描画は Desk。
// ここは両者をつなぐだけで、ゲームのロジックも描画の細部も持たない（CLAUDE.md §4-5）。

interface Props {
  readonly api: GameApi;
  readonly settingsStorage: SettingsStorage | null;
  readonly fpsFromQuery: boolean;
  /** 性能の自動調整（SPEC_v3.3 §9）。計測のときだけ止める */
  readonly adaptive?: boolean;
}

export function App({ api, settingsStorage, fpsFromQuery, adaptive = true }: Props) {
  const session = useGameSession(api);
  const [settings, updateSettings] = useSettings(settingsStorage);
  const systemReducedMotion = useSystemReducedMotion();
  return (
    <Desk
      session={session}
      settings={settings}
      onSettings={updateSettings}
      systemReducedMotion={systemReducedMotion}
      fpsFromQuery={fpsFromQuery}
      adaptive={adaptive}
    />
  );
}
