import { MAX_TURNS, SUCCESS_INFRASTRUCTURE, SUCCESS_POPULATION } from "./constants";
import type { Params } from "./GameState";

// エンディング（SPEC §7.2 / DECISIONS D-05, D-16, D-17）

export type GameOverReason = "population" | "treasury" | "happiness";

export type Ending =
  | { readonly kind: "gameover"; readonly reason: GameOverReason }
  | { readonly kind: "success"; readonly stage: "town" }
  | { readonly kind: "timeout" };

/**
 * 判定順：人口0 → 国庫<0 → 幸福度0 → 成功 → 時間切れ（ゲームオーバー優先）。
 * officeBuilt は役所が完成しているか（空洞でも「建った」とみなす。DECISIONS I-13）。
 * playedTurn は今処理し終えたターン番号。
 */
export const determineEnding = (params: Params, officeBuilt: boolean, playedTurn: number): Ending | null => {
  if (params.population <= 0) return { kind: "gameover", reason: "population" };
  if (params.treasury < 0) return { kind: "gameover", reason: "treasury" };
  if (params.happiness <= 0) return { kind: "gameover", reason: "happiness" };
  if (params.population >= SUCCESS_POPULATION && params.infrastructure >= SUCCESS_INFRASTRUCTURE && officeBuilt) {
    return { kind: "success", stage: "town" };
  }
  if (playedTurn >= MAX_TURNS) return { kind: "timeout" };
  return null;
};
