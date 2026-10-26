import { useEffect, useRef } from "react";
import { FPS_SAMPLE_WINDOW_MS, LOW_FPS_THRESHOLD, LOW_FPS_WINDOW_MS } from "../desk/deskConstants";

// フレームレートの計測（開発用の表示と、SPEC_v3.3 §9 の性能の自動調整に使う）。

export interface FpsStats {
  /** 直近 1 秒の平均 */
  readonly fps: number;
  /** 計測を始めてからの 1 秒平均の最低値（立ち上がりの数秒は除く） */
  readonly minFps: number;
  /** 直近 1 秒で一番長かったフレーム（ms） */
  readonly worstFrameMs: number;
  readonly samples: number;
}

/** フレームの時刻の列から、直近 windowMs の平均 fps と最長フレームを出す */
export const fpsOver = (timestamps: readonly number[], now: number, windowMs: number = FPS_SAMPLE_WINDOW_MS) => {
  const recent = timestamps.filter((t) => now - t <= windowMs);
  if (recent.length < 2) return { fps: 0, worstFrameMs: 0 };
  let worst = 0;
  for (let i = 1; i < recent.length; i++) worst = Math.max(worst, (recent[i] ?? 0) - (recent[i - 1] ?? 0));
  const span = (recent.at(-1) ?? 0) - (recent[0] ?? 0);
  return { fps: span > 0 ? ((recent.length - 1) * 1000) / span : 0, worstFrameMs: worst };
};

/** 低いフレームレートが続いたか（しきい値未満がずっと続いた時間で判定） */
export const isSustainedLow = (lowSince: number | null, now: number): boolean =>
  lowSince !== null && now - lowSince >= LOW_FPS_WINDOW_MS;

/** 立ち上がり（フォント・地図の初期化）を最低値の計算から外す時間 */
const WARMUP_MS = 2000;
const REPORT_EVERY_MS = 250;

declare global {
  interface Window {
    /** スクリーンショット・計測スクリプト用（開発時の確認のみ） */
    __deskFps?: FpsStats;
  }
}

/**
 * requestAnimationFrame で計測し、結果を window.__deskFps に置く（表示は FpsOverlay が読む）。
 * onSustainedLow は 45fps 未満が 3 秒続いたら1度だけ呼ぶ。React の状態は持たないので、計測で描き直しは起きない。
 */
export const useFpsMonitor = (opts: { readonly onSustainedLow?: () => void }): void => {
  const onLow = useRef(opts.onSustainedLow);
  onLow.current = opts.onSustainedLow;

  useEffect(() => {
    if (typeof window.requestAnimationFrame !== "function") return;
    const frames: number[] = [];
    const started = performance.now();
    let lowSince: number | null = null;
    let lowFired = false;
    let minFps = Number.POSITIVE_INFINITY;
    let lastReport = 0;
    let handle = 0;
    const tick = (now: number) => {
      frames.push(now);
      while (frames.length > 0 && now - (frames[0] ?? now) > FPS_SAMPLE_WINDOW_MS * 1.5) frames.shift();
      if (now - lastReport >= REPORT_EVERY_MS) {
        lastReport = now;
        const { fps, worstFrameMs } = fpsOver(frames, now);
        const warmedUp = now - started > WARMUP_MS;
        if (warmedUp && fps > 0) {
          minFps = Math.min(minFps, fps);
          lowSince = fps < LOW_FPS_THRESHOLD ? (lowSince ?? now) : null;
          if (!lowFired && isSustainedLow(lowSince, now)) {
            lowFired = true;
            onLow.current?.();
          }
        }
        const next: FpsStats = {
          fps: Math.round(fps),
          minFps: Number.isFinite(minFps) ? Math.round(minFps) : Math.round(fps),
          worstFrameMs: Math.round(worstFrameMs * 10) / 10,
          samples: frames.length,
        };
        window.__deskFps = next;
      }
      handle = window.requestAnimationFrame(tick);
    };
    // タブを離れている間は止まるので、戻ったときの空白を低フレームと見なさない
    const onVisibility = () => {
      frames.length = 0;
      lowSince = null;
    };
    document.addEventListener("visibilitychange", onVisibility);
    handle = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(handle);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
};
