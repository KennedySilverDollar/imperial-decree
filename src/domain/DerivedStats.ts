import { BUILDINGS, BUILDING_IDS, type BuildingId } from "./Buildings";
import {
  ADMIN_ACCURACY_MAX,
  ADMIN_ACCURACY_PER_POINT,
  LABOR_RATIO,
  OVERCROWD_DIVISOR,
  PEOPLE_PER_FOOD,
  SANITATION_BASE,
  SCHOOL_ADMIN_DELAY_TURNS,
  SECURITY_BASE,
  SECURITY_POLICY_SECURITY_PER_LEVEL,
} from "./constants";
import { stableFloor } from "./math";

// 派生指標（v3.2 §2.5）。台帳に載らず、新聞と側近報告でしか知れない（CLAUDE.md §4-13）。
// すべて max(0, …) でクランプし、判定もクランプ後の値で行う（V-04）。

export interface DerivedStats {
  readonly housingCapacity: number;
  readonly food: number;
  readonly foodDemand: number;
  readonly sanitation: number;
  readonly security: number;
  readonly admin: number;
}

/** 建物1棟（区画と完成年を持つ。空洞は効果ゼロ） */
export interface BuildingInstance {
  readonly serial: number;
  readonly kind: BuildingId;
  readonly builtTurn: number;
  readonly hollow: boolean;
  /** 空洞が側近報告で開示済みか（地図の亀裂） */
  readonly disclosed: boolean;
  /** 区画 [x, y]。道路は区画を持たない */
  readonly tile: readonly [number, number] | null;
}

export type BuildingCounts = Readonly<Record<BuildingId, number>>;

const zeroCounts = (): Record<BuildingId, number> =>
  Object.fromEntries(BUILDING_IDS.map((id) => [id, 0])) as Record<BuildingId, number>;

/** 保有棟数（空洞も含む） */
export const countBuildings = (buildings: readonly BuildingInstance[]): BuildingCounts => {
  const counts = zeroCounts();
  for (const b of buildings) counts[b.kind]++;
  return counts;
};

/** 機能している棟数（空洞を除く） */
export const countFunctional = (buildings: readonly BuildingInstance[]): BuildingCounts => {
  const counts = zeroCounts();
  for (const b of buildings) if (!b.hollow) counts[b.kind]++;
  return counts;
};

export interface DerivedInput {
  readonly population: number;
  readonly buildings: readonly BuildingInstance[];
  /** 治安政策の水準 */
  readonly securityPolicyLevel: number;
  /** 食料の産出倍率（凶作で0.5） */
  readonly foodFactor: number;
  /** 学校の効き始めを判定する年 */
  readonly turn: number;
}

const nonNegative = (value: number): number => Math.max(0, value);

export const computeDerived = (input: DerivedInput): DerivedStats => {
  const f = countFunctional(input.buildings);
  const sum = (key: "capacity" | "food" | "sanitation" | "security") =>
    BUILDING_IDS.reduce((total, id) => total + BUILDINGS[id].effects[key] * f[id], 0);
  const housingCapacity = nonNegative(sum("capacity"));
  const overcrowding = nonNegative((input.population - housingCapacity) / OVERCROWD_DIVISOR);
  // 学校の行政能力は、建ててから SCHOOL_ADMIN_DELAY_TURNS 年後に効く（W-05）
  const admin = input.buildings.reduce((total, b) => {
    if (b.hollow) return total;
    const value = BUILDINGS[b.kind].effects.admin;
    const delayed = b.kind === "school" && input.turn - b.builtTurn < SCHOOL_ADMIN_DELAY_TURNS;
    return total + (delayed ? 0 : value);
  }, 0);
  return {
    housingCapacity,
    food: nonNegative(sum("food") * input.foodFactor),
    foodDemand: nonNegative(input.population / PEOPLE_PER_FOOD),
    sanitation: nonNegative(SANITATION_BASE + sum("sanitation") - overcrowding),
    security: nonNegative(
      SECURITY_BASE + sum("security") + SECURITY_POLICY_SECURITY_PER_LEVEL * input.securityPolicyLevel - overcrowding,
    ),
    admin: nonNegative(admin),
  };
};

/** 行政能力による側近の解釈精度の加算（v3.2 §2.5：+0.05×admin、上限 +0.15） */
export const adminAccuracyBonus = (admin: number): number => Math.min(ADMIN_ACCURACY_MAX, ADMIN_ACCURACY_PER_POINT * admin);

/** 労働人口（v3.3：台帳に表示） */
export const laborForce = (population: number): number => stableFloor(population * LABOR_RATIO);
