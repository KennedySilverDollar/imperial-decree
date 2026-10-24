import { INTENT_BONUS_HAPPINESS, PARAM_MAX, PARAM_MIN } from "../domain/constants";
import type { Params } from "../domain/GameState";
import {
  evaluateIntentDeclaration,
  type IntentDeclaration,
  type IntentEvaluation,
} from "../domain/IntentDeclaration";
import { clamp } from "../domain/math";

// 意図判定とボーナス（SPEC §6.2 / A-01：達成時のみ幸福度+5、ペナルティなし）

export interface IntentOutcome {
  readonly evaluation: IntentEvaluation | null;
  readonly bonusHappiness: number;
  readonly params: Params;
}

/** before はターン開始時、after は自然変化・clamp 後でボーナス適用前の値 */
export const evaluateIntent = (declaration: IntentDeclaration | null, before: Params, after: Params): IntentOutcome => {
  if (declaration === null) return { evaluation: null, bonusHappiness: 0, params: after };
  const evaluation = evaluateIntentDeclaration(declaration, before, after);
  if (!evaluation.achieved) return { evaluation, bonusHappiness: 0, params: after };
  const happiness = clamp(after.happiness + INTENT_BONUS_HAPPINESS, PARAM_MIN, PARAM_MAX);
  return { evaluation, bonusHappiness: happiness - after.happiness, params: { ...after, happiness } };
};
