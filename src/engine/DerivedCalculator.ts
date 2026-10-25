import { FAMINE_EVENT_FOOD_FACTOR } from "../domain/constants";
import { adminAccuracyBonus, computeDerived, type DerivedStats } from "../domain/DerivedStats";
import type { GameState } from "../domain/GameState";

// 派生指標をゲーム状態から計算する（v3.2 §2.5）。UI には出さない（CLAUDE.md §4-13）。

export type DerivedSource = Pick<GameState, "params" | "buildings" | "policies" | "event" | "turn">;

export const derivedOf = (state: DerivedSource, population: number = state.params.population): DerivedStats =>
  computeDerived({
    population,
    buildings: state.buildings,
    securityPolicyLevel: state.policies.security_policy.level,
    foodFactor: state.event?.kind === "famine" ? FAMINE_EVENT_FOOD_FACTOR : 1,
    turn: state.turn,
  });

/** その年の側近の精度に加わる、行政能力の加算（勅令の時点の建物で計算＝建てた翌年から効く。X-06） */
export const adminBonusOf = (state: DerivedSource): number => adminAccuracyBonus(derivedOf(state).admin);
