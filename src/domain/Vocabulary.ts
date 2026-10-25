// 勅令の語彙と action × target の有効組合せ表（DECISIONS §11.4 / CLAUDE.md §4-15）
import { BUILDING_IDS, isBuildingId, POLICY_IDS, TARGETS, type BuildingId, type PolicyId, type Target } from "./Buildings";

export { BUILDING_IDS, POLICY_IDS, TARGETS, isTarget, isBuildingId, isPolicyId } from "./Buildings";
export type { BuildingId, PolicyId, Target } from "./Buildings";

export const ACTIONS = ["build", "tax", "invest", "reform", "appoint", "dismiss"] as const;
export type Action = (typeof ACTIONS)[number];

export const PARAM_KEYS = ["population", "treasury", "happiness", "infrastructure", "corruption"] as const;
export type ParamKey = (typeof PARAM_KEYS)[number];

export const isAction = (value: string): value is Action => (ACTIONS as readonly string[]).includes(value);

export type NoopReason = "unknownTarget" | "lowConfidence" | "appointDismiss" | "invalidCombination" | "nonPositive";

/** 組合せ表を引いた結果 */
export type Resolution =
  | { readonly kind: "construct"; readonly building: BuildingId; readonly repairFirst: boolean }
  | { readonly kind: "policy"; readonly policy: PolicyId; readonly direction: 1 | -1 }
  | { readonly kind: "noop"; readonly reason: NoopReason };

/**
 * action × target の有効組合せ（DECISIONS §11.4）。
 * - action=tax は target を問わず税率の上げ下げ（v3.1 の扱いを踏襲）
 * - 建物：build=新築、invest=空洞の修繕を優先して新築（W-10）、reform は無効、負の規模（取り壊し）は無効
 * - 政策：invest/reform は符号どおり、build は reform と読み替え
 */
export const resolveCombination = (action: Action, target: Target | null, magnitude: number): Resolution => {
  if (action === "appoint" || action === "dismiss") return { kind: "noop", reason: "appointDismiss" };
  if (target === null) return { kind: "noop", reason: "unknownTarget" };
  if (action === "tax") {
    if (magnitude === 0) return { kind: "noop", reason: "nonPositive" };
    return { kind: "policy", policy: "tax_rate", direction: magnitude > 0 ? 1 : -1 };
  }
  if (isBuildingId(target)) {
    if (action === "reform") return { kind: "noop", reason: "invalidCombination" };
    if (magnitude <= 0) return { kind: "noop", reason: "nonPositive" };
    return { kind: "construct", building: target, repairFirst: action === "invest" };
  }
  if (magnitude === 0) return { kind: "noop", reason: "nonPositive" };
  return { kind: "policy", policy: target, direction: magnitude > 0 ? 1 : -1 };
};

/** action ごとに取り違え先になりうる target（BALANCE §4.4 を20種に拡張） */
export const SWAPPABLE_TARGETS: Readonly<Record<Action, readonly Target[]>> = {
  build: BUILDING_IDS,
  invest: [...BUILDING_IDS, "welfare_policy", "security_policy"],
  reform: POLICY_IDS,
  tax: [],
  appoint: [],
  dismiss: [],
};

/** テンプレートパーサーで action が読み取れなかったときの既定 action */
export const defaultActionFor = (target: Target): Action =>
  target === "tax_rate" ? "tax" : isBuildingId(target) ? "build" : "invest";

export const ALL_TARGETS: readonly Target[] = TARGETS;
