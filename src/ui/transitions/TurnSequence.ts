import { STAMP_ANIMATION_MS } from "../../domain/constants";
import type { Ending } from "../../domain/Ending";

// ターン遷移シーケンス（SPEC_v3.3 §4.5）。判子を押してから次の入力までを1つの流れとして演出する（合計4〜6秒、スキップ可）。
//   1. 押印（1.2s）→ 2. 勅令用紙が畳まれ既決箱へ（0.6s）→ 3. 窓の光が変わる（0.4s）→ 4. 地図の更新（1.2s）
//   → 5. 配達：新聞・書簡・結果束（1.0s）→ 6. 台帳に書き込む（0.5s）
// エンディングの年は 4 の後に専用の演出へ分岐する（成功：町の印章／ゲームオーバー・時間切れ：ランプが消える）。
// 「動きを減らす」（§8.2）では、移動をやめて短いフェードだけにし、合計を約1秒に縮める。
// ここは時間割だけを決める純粋な関数（表示も状態の書き換えもしない）。

export type SequenceStep = "stamp" | "file" | "weather" | "map" | "delivery" | "ledger" | "ending";

/** 各段の長さ（ミリ秒）。押印は domain/constants の STAMP_ANIMATION_MS（§4.3） */
export const SEQUENCE_MS: Readonly<Record<SequenceStep, number>> = {
  stamp: STAMP_ANIMATION_MS,
  file: 600,
  weather: 400,
  map: 1200,
  delivery: 1000,
  ledger: 500,
  ending: 2400,
};

/** 動きを減らすときの各段（フェードだけ） */
export const REDUCED_SEQUENCE_MS: Readonly<Record<SequenceStep, number>> = {
  stamp: 200,
  file: 120,
  weather: 120,
  map: 300,
  delivery: 200,
  ledger: 120,
  ending: 600,
};

export type EndingStyle = "seal" | "lampOut";

/** エンディングの演出：成功は町の印章、ゲームオーバーと時間切れはランプが消える */
export const endingStyleOf = (ending: Ending | null): EndingStyle | null =>
  ending === null ? null : ending.kind === "success" ? "seal" : "lampOut";

export interface PlannedStep {
  readonly step: SequenceStep;
  /** 押印の始まりからの開始時刻 */
  readonly start: number;
  readonly duration: number;
}

/** 段の並び：エンディングの年は地図の更新の後に専用の演出で終わる */
export const sequenceSteps = (ending: EndingStyle | null): readonly SequenceStep[] =>
  ending === null ? ["stamp", "file", "weather", "map", "delivery", "ledger"] : ["stamp", "file", "weather", "map", "ending"];

/** scale は開発用（?seqscale=N で演出をゆっくりにして、段ごとのスクリーンショットを撮る）。既定は 1 */
export const planSequence = (opts: { readonly reduced: boolean; readonly ending: EndingStyle | null; readonly scale?: number }): readonly PlannedStep[] => {
  const table = opts.reduced ? REDUCED_SEQUENCE_MS : SEQUENCE_MS;
  const scale = opts.scale ?? 1;
  let at = 0;
  return sequenceSteps(opts.ending).map((step) => {
    const duration = table[step] * scale;
    const planned = { step, start: at, duration };
    at += duration;
    return planned;
  });
};

export const sequenceTotal = (plan: readonly PlannedStep[]): number => {
  const last = plan[plan.length - 1];
  return last === undefined ? 0 : last.start + last.duration;
};

/** 結果が届く前に進めてよい段（押印と、勅令用紙を既決箱へ）。結果が届くまでは「file」の後で待つ */
export const BEFORE_RESULT: readonly SequenceStep[] = ["stamp", "file"];
