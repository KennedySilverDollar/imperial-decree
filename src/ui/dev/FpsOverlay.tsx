import { useEffect, useState } from "react";
import { messages } from "../../i18n/messages";
import type { FpsStats } from "./fps";

// 開発用の FPS 表示（?fps または設定で出す）。画面の右下に、変形なしで重ねる。
// 計測は机（useFpsMonitor）が続けていて、ここは 4 回/秒 その値を読むだけ（机全体を描き直さない）。

const READ_EVERY_MS = 250;

export function FpsOverlay({ lowPower }: { readonly lowPower: boolean }) {
  const t = messages.ui.fps;
  const [stats, setStats] = useState<FpsStats | null>(null);
  useEffect(() => {
    const id = window.setInterval(() => setStats(window.__deskFps ?? null), READ_EVERY_MS);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div className="fps-overlay" data-testid="fps-overlay" aria-hidden>
      <span>{t.current(stats?.fps ?? 0)}</span>
      <span>{t.min(stats?.minFps ?? 0)}</span>
      <span>{t.worst(stats?.worstFrameMs ?? 0)}</span>
      {lowPower && <span className="fps-low">{t.lowPower}</span>}
    </div>
  );
}
