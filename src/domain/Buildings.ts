// 20 の target（建物17＋政策3）の単一情報源（v3.2 §2.3 / CLAUDE.md §4-11）。
// Effect Schema・Structured Outputs の JSON Schema・プロキシ・テンプレート辞書・UI のラベルはここから作る。
// 名称とタイルの文字は文言なので i18n/messages.ts に置き、ここの id をキーにして型で網羅を保証する。
// 建材表（recipe）と工期は秘匿値（v3.3 / CLAUDE.md §4-13）。UI に出さない。

export const BUILDING_IDS = [
  "residential",
  "tenement",
  "manor",
  "road",
  "well",
  "granary",
  "market",
  "farm",
  "workshop",
  "office",
  "taxoffice",
  "courthouse",
  "clinic",
  "school",
  "temple",
  "watchtower",
  "jail",
] as const;
export type BuildingId = (typeof BUILDING_IDS)[number];

export const POLICY_IDS = ["tax_rate", "welfare_policy", "security_policy"] as const;
export type PolicyId = (typeof POLICY_IDS)[number];

export const TARGETS = [...BUILDING_IDS, ...POLICY_IDS] as const;
export type Target = BuildingId | PolicyId;

export const CATEGORIES = ["housing", "infrastructure", "economy", "administration", "social", "security"] as const;
export type Category = (typeof CATEGORIES)[number];

export type Prerequisite =
  | { readonly kind: "minPopulation"; readonly value: number }
  | { readonly kind: "building"; readonly building: BuildingId };

/** 建物1棟あたりの効果（空洞の建物は全てゼロ） */
export interface BuildingEffects {
  /** 毎年の国庫収入（v3.2「税+N」） */
  readonly tax: number;
  /** 幸福度の平衡点への寄与（ある間ずっと。W-02） */
  readonly happiness: number;
  readonly capacity: number;
  readonly food: number;
  readonly sanitation: number;
  readonly security: number;
  readonly admin: number;
  /** 汚職率への毎年の寄与（裁判所 −3） */
  readonly corruptionPerTurn: number;
  /** 完成時に台帳のインフラへ加える量（道路） */
  readonly infrastructure: number;
}

/** 秘匿の建材表（1棟あたり。BALANCE §23） */
export interface Recipe {
  readonly work: number;
  readonly minTurns: number;
  readonly wood: number;
  readonly stone: number;
}

export interface BuildingDef {
  readonly id: BuildingId;
  readonly category: Category;
  readonly cost: number;
  readonly upkeep: number;
  readonly effects: BuildingEffects;
  readonly prerequisite: Prerequisite | null;
  /** 最大棟数（役所は1） */
  readonly maxCount: number | null;
  /** 汚職率そのものによる空洞化の対象（v3.2 の5種。BALANCE §17） */
  readonly hollowableByCorruption: boolean;
  /** 区画を占めるか（道路は地図の十字に描くので区画を占めない） */
  readonly occupiesTile: boolean;
  readonly recipe: Recipe;
}

const NONE: BuildingEffects = {
  tax: 0,
  happiness: 0,
  capacity: 0,
  food: 0,
  sanitation: 0,
  security: 0,
  admin: 0,
  corruptionPerTurn: 0,
  infrastructure: 0,
};

const def = (
  id: BuildingId,
  category: Category,
  cost: number,
  upkeep: number,
  effects: Partial<BuildingEffects>,
  recipe: Recipe,
  options: Partial<Pick<BuildingDef, "prerequisite" | "maxCount" | "hollowableByCorruption" | "occupiesTile">> = {},
): BuildingDef => ({
  id,
  category,
  cost,
  upkeep,
  effects: { ...NONE, ...effects },
  prerequisite: options.prerequisite ?? null,
  maxCount: options.maxCount ?? null,
  hollowableByCorruption: options.hollowableByCorruption ?? false,
  occupiesTile: options.occupiesTile ?? true,
  recipe,
});

const MANOR_MIN_POPULATION = 200;
const SCHOOL_ADMIN = 0.5;

/** v3.2 §2.3 の表 ＋ v3.3 の建材表（BALANCE §23） */
export const BUILDINGS: Readonly<Record<BuildingId, BuildingDef>> = {
  residential: def("residential", "housing", 100, 2, { happiness: 1, capacity: 20 }, { work: 40, minTurns: 2, wood: 20, stone: 5 }),
  tenement: def("tenement", "housing", 80, 1, { happiness: -2, capacity: 35, sanitation: -2 }, { work: 30, minTurns: 2, wood: 20, stone: 0 }),
  manor: def("manor", "housing", 250, 3, { tax: 5, happiness: -3, capacity: 10 }, { work: 90, minTurns: 4, wood: 30, stone: 30 }, {
    prerequisite: { kind: "minPopulation", value: MANOR_MIN_POPULATION },
  }),
  road: def("road", "infrastructure", 80, 0, { infrastructure: 3 }, { work: 20, minTurns: 1, wood: 0, stone: 10 }, { occupiesTile: false }),
  well: def("well", "infrastructure", 60, 1, { happiness: 2, sanitation: 3 }, { work: 20, minTurns: 1, wood: 0, stone: 10 }),
  granary: def("granary", "infrastructure", 120, 2, { food: 2 }, { work: 50, minTurns: 2, wood: 25, stone: 10 }, {
    hollowableByCorruption: true,
  }),
  market: def("market", "economy", 150, 2, { tax: 4, happiness: 1 }, { work: 60, minTurns: 3, wood: 25, stone: 15 }, {
    hollowableByCorruption: true,
  }),
  farm: def("farm", "economy", 70, 1, { tax: 1, food: 4 }, { work: 25, minTurns: 1, wood: 10, stone: 0 }),
  workshop: def("workshop", "economy", 120, 2, { tax: 3, happiness: -1, sanitation: -2 }, { work: 50, minTurns: 2, wood: 25, stone: 10 }, {
    hollowableByCorruption: true,
  }),
  office: def("office", "administration", 300, 5, { admin: 1 }, { work: 120, minTurns: 4, wood: 30, stone: 40 }, { maxCount: 1 }),
  taxoffice: def("taxoffice", "administration", 100, 1, { tax: 5, happiness: -3 }, { work: 40, minTurns: 2, wood: 15, stone: 10 }),
  courthouse: def("courthouse", "administration", 200, 3, { happiness: 2, corruptionPerTurn: -3 }, { work: 100, minTurns: 4, wood: 20, stone: 40 }, {
    prerequisite: { kind: "building", building: "office" },
  }),
  clinic: def("clinic", "social", 120, 2, { happiness: 2, sanitation: 2 }, { work: 50, minTurns: 2, wood: 20, stone: 15 }, {
    hollowableByCorruption: true,
  }),
  school: def("school", "social", 180, 3, { happiness: 1, admin: SCHOOL_ADMIN }, { work: 80, minTurns: 3, wood: 25, stone: 25 }, {
    hollowableByCorruption: true,
  }),
  temple: def("temple", "social", 150, 2, { happiness: 3, security: 2 }, { work: 90, minTurns: 4, wood: 15, stone: 45 }),
  watchtower: def("watchtower", "security", 100, 2, { security: 3 }, { work: 40, minTurns: 2, wood: 15, stone: 15 }),
  jail: def("jail", "security", 150, 2, { happiness: -2, security: 4 }, { work: 60, minTurns: 3, wood: 10, stone: 30 }, {
    prerequisite: { kind: "building", building: "watchtower" },
  }),
};

/** 初期の建物（BALANCE §13：開始直後に記事N-05/06/14 を発火させない最小構成） */
export const INITIAL_BUILDINGS: Readonly<Partial<Record<BuildingId, number>>> = {
  residential: 7,
  farm: 3,
  well: 1,
  watchtower: 1,
};

/** 地図の配置の優先順位（v3.2 §2.6）。役所は中央に固定 */
export const CATEGORY_PLACEMENT_ORDER: readonly Category[] = [
  "administration",
  "housing",
  "economy",
  "social",
  "security",
  "infrastructure",
];

export const isBuildingId = (value: string): value is BuildingId => (BUILDING_IDS as readonly string[]).includes(value);
export const isPolicyId = (value: string): value is PolicyId => (POLICY_IDS as readonly string[]).includes(value);
export const isTarget = (value: string): value is Target => (TARGETS as readonly string[]).includes(value);
