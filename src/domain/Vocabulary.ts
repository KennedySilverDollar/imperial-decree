// 勅令の語彙（A-03 の target 8種、SPEC §11.2 の action 6種）とパラメータ名

export const TARGETS = [
  "residential",
  "road",
  "well",
  "office",
  "market",
  "tax",
  "welfare",
  "security",
] as const;
export type Target = (typeof TARGETS)[number];

export const ACTIONS = ["build", "tax", "invest", "reform", "appoint", "dismiss"] as const;
export type Action = (typeof ACTIONS)[number];

export const PARAM_KEYS = ["population", "treasury", "happiness", "infrastructure", "corruption"] as const;
export type ParamKey = (typeof PARAM_KEYS)[number];

export const isTarget = (value: string): value is Target => (TARGETS as readonly string[]).includes(value);
export const isAction = (value: string): value is Action => (ACTIONS as readonly string[]).includes(value);

/** target ごとに有効な action（BALANCE §3）。action=tax は target を問わず増減税として扱う */
export const ALLOWED_ACTIONS: Readonly<Record<Target, readonly Action[]>> = {
  road: ["build", "invest"],
  well: ["build", "invest"],
  residential: ["build", "invest"],
  market: ["build", "invest"],
  office: ["build"],
  tax: ["tax", "reform"],
  welfare: ["invest", "reform"],
  security: ["invest", "reform"],
};

/** action ごとに取り違え先になりうる target（BALANCE §4.4） */
export const SWAPPABLE_TARGETS: Readonly<Record<Action, readonly Target[]>> = {
  build: ["residential", "road", "well", "office", "market"],
  invest: ["road", "well", "residential", "market", "welfare", "security"],
  reform: ["tax", "welfare", "security"],
  tax: [],
  appoint: [],
  dismiss: [],
};

/** テンプレートパーサーで action が読み取れなかったときの既定 action */
export const DEFAULT_ACTION_FOR_TARGET: Readonly<Record<Target, Action>> = {
  road: "build",
  well: "build",
  residential: "build",
  market: "build",
  office: "build",
  tax: "tax",
  welfare: "invest",
  security: "invest",
};

export const isAllowedCombination = (action: Action, target: Target): boolean =>
  action === "tax" || ALLOWED_ACTIONS[target].includes(action);
