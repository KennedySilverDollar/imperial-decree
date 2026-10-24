import type { ParamKey } from "./Vocabulary";
import type { Params } from "./GameState";

// 意図宣言（SPEC §6.2 / DECISIONS D-03, D-50）。宣言しない場合は null で表す。

export type IntentDirection = "increase" | "decrease" | "absolute";

export interface IntentDeclaration {
  readonly targetParam: ParamKey;
  readonly targetValue: number;
  readonly direction: IntentDirection;
}

export interface IntentEvaluation {
  readonly declaration: IntentDeclaration;
  readonly before: number;
  readonly after: number;
  /** increase/decrease は変化量、absolute は到達値 */
  readonly measured: number;
  readonly achieved: boolean;
}

export const isValidIntentDeclaration = (decl: IntentDeclaration): boolean =>
  Number.isFinite(decl.targetValue) && decl.targetValue > 0;

/** 判定はボーナス適用前・自然変化込みのターン全体の変化で行う */
export const evaluateIntentDeclaration = (
  decl: IntentDeclaration,
  before: Params,
  after: Params,
): IntentEvaluation => {
  const b = before[decl.targetParam];
  const a = after[decl.targetParam];
  const measured = decl.direction === "increase" ? a - b : decl.direction === "decrease" ? b - a : a;
  return { declaration: decl, before: b, after: a, measured, achieved: measured >= decl.targetValue };
};
