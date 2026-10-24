import {
  ACCURACY_ABILITY_DIVISOR,
  ACCURACY_AMBITION_PENALTY,
  ACCURACY_AMBITION_THRESHOLD,
  ACCURACY_BASE,
  ACCURACY_SPECIALTY_BONUS,
  ACCURACY_TRUST_BONUS,
  ACCURACY_TRUST_THRESHOLD,
  CONSERVATIVE_LARGE_MAGNITUDE,
} from "./constants";
import { clamp } from "./math";
import type { Action, Target } from "./Vocabulary";

// 側近（SPEC §5.2, §7.5）。P0 ではパラメータは固定（DECISIONS D-18）。

export type Faction = "development" | "commerce" | "conservative" | "military" | "environment";
export type Specialty = "infrastructure" | "economy" | "security" | "environment";

export interface Aide {
  /** messages.ts の側近名・紹介文のキーを兼ねる */
  readonly id: string;
  readonly loyalty: number;
  readonly ability: number;
  readonly ambition: number;
  readonly faction: Faction;
  readonly specialty: Specialty;
  readonly trust: number;
  /** 着任ターン（同点時は在任が長い方を優先） */
  readonly appointedTurn: number;
}

type AideProfile = Omit<Aide, "appointedTurn">;

/** SPEC §7.5 の初期側近 */
export const INITIAL_AIDE_PROFILES: readonly AideProfile[] = [
  { id: "elderSteward", loyalty: 80, ability: 60, ambition: 30, faction: "development", specialty: "infrastructure", trust: 70 },
  { id: "youngMerchant", loyalty: 60, ability: 75, ambition: 70, faction: "commerce", specialty: "economy", trust: 50 },
];

/** 任命候補のプール（DECISIONS D-22）。毎回ここから2人を選ぶ */
export const CANDIDATE_POOL: readonly AideProfile[] = [
  { id: "retiredCaptain", loyalty: 75, ability: 55, ambition: 40, faction: "military", specialty: "security", trust: 55 },
  { id: "templeScribe", loyalty: 70, ability: 70, ambition: 20, faction: "conservative", specialty: "economy", trust: 45 },
  { id: "forestWarden", loyalty: 65, ability: 60, ambition: 35, faction: "environment", specialty: "environment", trust: 60 },
  { id: "masonForeman", loyalty: 55, ability: 80, ambition: 65, faction: "development", specialty: "infrastructure", trust: 40 },
  { id: "guildTreasurer", loyalty: 50, ability: 85, ambition: 80, faction: "commerce", specialty: "economy", trust: 35 },
  { id: "villageElder", loyalty: 85, ability: 45, ambition: 15, faction: "conservative", specialty: "security", trust: 75 },
];

export const ALL_AIDE_PROFILES: readonly AideProfile[] = [...INITIAL_AIDE_PROFILES, ...CANDIDATE_POOL];

export const makeAide = (profile: AideProfile, appointedTurn: number): Aide => ({ ...profile, appointedTurn });

const SPECIALTY_TARGETS: Readonly<Record<Specialty, readonly Target[]>> = {
  infrastructure: ["residential", "road", "well", "office", "market"],
  economy: ["tax", "market", "security"],
  security: ["welfare", "security"],
  environment: ["well"],
};

export const isSpecialtyMatch = (aide: Aide, action: Action, target: Target | null): boolean =>
  (action === "tax" && aide.specialty === "economy") ||
  (target !== null && SPECIALTY_TARGETS[aide.specialty].includes(target));

/** 派閥対立（BALANCE §4.3） */
export const isFactionConflict = (aide: Aide, action: Action, target: Target | null, magnitude: number): boolean => {
  switch (aide.faction) {
    case "development":
      return (action === "build" || action === "invest" || action === "tax") && magnitude < 0;
    case "commerce":
      return (action === "tax" && magnitude > 0) || target === "security";
    case "conservative":
      return action === "build" && magnitude > CONSERVATIVE_LARGE_MAGNITUDE;
    case "military":
      return target === "welfare";
    case "environment":
      return action === "build" && target === "road" && magnitude > 0;
  }
};

/** 解釈精度（SPEC §7.6 / A-04） */
export const computeAccuracy = (aide: Aide, specialtyMatch: boolean, factionConflict: boolean): number =>
  clamp(
    ACCURACY_BASE +
      aide.ability / ACCURACY_ABILITY_DIVISOR +
      (specialtyMatch ? ACCURACY_SPECIALTY_BONUS : 0) +
      (aide.trust >= ACCURACY_TRUST_THRESHOLD ? ACCURACY_TRUST_BONUS : 0) -
      (aide.ambition >= ACCURACY_AMBITION_THRESHOLD && factionConflict ? ACCURACY_AMBITION_PENALTY : 0),
    0,
    1,
  );

export type SelectionReason = "specialty" | "trust" | "offSpecialty";

export interface AideSelection {
  readonly aide: Aide;
  readonly reason: SelectionReason;
}

/**
 * 担当側近の自動選択（A-05）：①専門一致 ②信頼が高い ③在任が長い。
 * reason: 専門一致が1人なら specialty、複数一致で信頼により決まれば trust、誰も一致しなければ offSpecialty。
 */
export const selectAide = (aides: readonly Aide[], action: Action, target: Target | null): AideSelection | null => {
  if (aides.length === 0) return null;
  const matching = aides.filter((aide) => isSpecialtyMatch(aide, action, target));
  const pool = matching.length > 0 ? matching : aides;
  const sorted = [...pool].sort((a, b) => b.trust - a.trust || a.appointedTurn - b.appointedTurn);
  const aide = sorted[0];
  if (aide === undefined) return null;
  const reason: SelectionReason = matching.length === 0 ? "offSpecialty" : matching.length === 1 ? "specialty" : "trust";
  return { aide, reason };
};
