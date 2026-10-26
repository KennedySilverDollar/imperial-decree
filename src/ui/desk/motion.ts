import { STAMP_ANIMATION_MS } from "../../domain/constants";
import { FOCUS_TRANSITION_MS, REDUCED_FADE_MS, REDUCED_STAMP_MS } from "./deskConstants";

// 動きの長さ（SPEC_v3.3 §4.1・§8.2）。「動きを減らす」（OS の prefers-reduced-motion か設定）では、
// 移動を即時にして短いフェードに置き換え、押印の待ちも縮める。

export interface MotionTimings {
  /** 手に取る／置く */
  readonly focusMs: number;
  /** 動きを減らすときの代わりのフェード */
  readonly fadeMs: number;
  /** 押印から執行までの待ち */
  readonly stampMs: number;
}

export const motionTimings = (reduced: boolean): MotionTimings => ({
  focusMs: reduced ? 0 : FOCUS_TRANSITION_MS,
  fadeMs: reduced ? REDUCED_FADE_MS : 0,
  stampMs: reduced ? REDUCED_STAMP_MS : STAMP_ANIMATION_MS,
});
