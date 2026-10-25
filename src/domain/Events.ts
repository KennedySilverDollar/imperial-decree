import type { BuildingId, PolicyId } from "./Buildings";
import {
  BANDIT_CHANCE,
  BANDIT_CHANCE_LOW_SECURITY,
  EPIDEMIC_CHANCE,
  EPIDEMIC_CHANCE_LOW_SANITATION,
  FAMINE_EVENT_CHANCE,
  FAMINE_EVENT_CHANCE_NO_GRANARY,
  SANITATION_LOW,
  SECURITY_LOW,
} from "./constants";
import type { DerivedStats } from "./DerivedStats";

// 勅令で解決するランダムイベント3種（v3.3 / DECISIONS §12.4, Z-08, Z-09 / BALANCE §25）

export const EVENT_KINDS = ["epidemic", "famine", "bandits"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export interface ActiveEvent {
  readonly kind: EventKind;
  /** 発生からの経過年数 */
  readonly turns: number;
  readonly startedTurn: number;
}

/** 解決する勅令（側近の補正後の指示で判定。発注・政策の変更が成立した時点で解決） */
export const EVENT_RESOLUTIONS: Readonly<
  Record<EventKind, { readonly buildings: readonly BuildingId[]; readonly policy: PolicyId; readonly direction: 1 | -1 }>
> = {
  epidemic: { buildings: ["clinic", "well"], policy: "welfare_policy", direction: 1 },
  famine: { buildings: ["granary", "farm"], policy: "tax_rate", direction: -1 },
  bandits: { buildings: ["watchtower", "jail"], policy: "security_policy", direction: 1 },
};

/** その年の発生確率（判定順は EVENT_KINDS の順、最初に当たったものだけ起きる） */
export const eventChance = (kind: EventKind, derived: DerivedStats, hasFunctionalGranary: boolean): number => {
  switch (kind) {
    case "epidemic":
      return EPIDEMIC_CHANCE + (derived.sanitation < SANITATION_LOW ? EPIDEMIC_CHANCE_LOW_SANITATION : 0);
    case "famine":
      return FAMINE_EVENT_CHANCE + (hasFunctionalGranary ? 0 : FAMINE_EVENT_CHANCE_NO_GRANARY);
    case "bandits":
      return BANDIT_CHANCE + (derived.security < SECURITY_LOW ? BANDIT_CHANCE_LOW_SECURITY : 0);
  }
};

export type ResolvingAction =
  | { readonly kind: "construct"; readonly building: BuildingId }
  | { readonly kind: "policy"; readonly policy: PolicyId; readonly direction: 1 | -1 };

export const resolvesEvent = (event: EventKind, action: ResolvingAction): boolean => {
  const r = EVENT_RESOLUTIONS[event];
  return action.kind === "construct"
    ? r.buildings.includes(action.building)
    : action.policy === r.policy && action.direction === r.direction;
};
