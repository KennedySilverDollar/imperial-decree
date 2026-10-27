import type { AudioService } from "./audio/AudioService";
import { Desk } from "./desk/Desk";
import { SURVEY_DELAY_DEFAULT } from "./map/mapConstants";
import type { GameApi } from "./game/GameApi";
import { useGameSession } from "./game/useGameSession";
import type { NotesStorage } from "./notes/notesStorage";
import { useSettings, useSystemReducedMotion, type SettingsStorage } from "./settings/settings";

// 画面全体。ゲームの進行は useGameSession（TurnMachine へのアダプタ）、描画は Desk。
// ここは両者をつなぐだけで、ゲームのロジックも描画の細部も持たない（CLAUDE.md §4-5）。

interface Props {
  readonly api: GameApi;
  readonly settingsStorage: SettingsStorage | null;
  /** メモの保存先（ゲームのセーブとは別のキー） */
  readonly notesStorage?: NotesStorage | null;
  readonly fpsFromQuery: boolean;
  /** 性能の自動調整（SPEC_v3.3 §9）。計測のときだけ止める */
  readonly adaptive?: boolean;
  /** 測量の遅れ（SPEC_v3.3 §5.9）。既定は無効 */
  readonly surveyDelay?: boolean;
  /** 開発用：遷移の演出の倍率（?seqscale） */
  readonly sequenceScale?: number;
  /** 音の係（テストで差し替える） */
  readonly audio?: AudioService;
}

export function App({ api, settingsStorage, notesStorage = null, fpsFromQuery, adaptive = true, surveyDelay = SURVEY_DELAY_DEFAULT, sequenceScale = 1, audio }: Props) {
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
      notesStorage={notesStorage}
      surveyDelay={surveyDelay}
      sequenceScale={sequenceScale}
      {...(audio ? { audio } : {})}
    />
  );
}
