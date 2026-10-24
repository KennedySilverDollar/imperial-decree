import { Effect } from "effect";
import {
  AIDE_SALARY,
  CORRUPTION_DRIFT_PER_TURN,
  CROWDING_HAPPINESS_PENALTY,
  HAPPINESS_EQUILIBRIUM_BASE,
  HAPPINESS_GROWTH_THRESHOLD,
  HAPPINESS_NEUTRAL,
  HAPPINESS_PENALTY_PER_CORRUPTION,
  HAPPINESS_PER_INFRA,
  HAPPINESS_REVERT_RATE,
  HOLLOW_DECAY_PER_TURN,
  INFRA_DECAY_AMOUNT,
  INFRA_DECAY_CHANCE,
  INFRA_UPKEEP_PER_POINT,
  LEVY_HAPPINESS_PER_MAG,
  LEVY_PER_CAPITA_PER_MAG,
  LOW_CONFIDENCE_THRESHOLD,
  MAGNITUDE_MAX,
  MAGNITUDE_MIN,
  MARKET_COST,
  MARKET_MAX,
  MARKET_TAX_BONUS,
  MIN_EFFECTIVE_SCALE,
  NEGLECTED_CORRUPTION_PENALTY,
  NEGLECTED_CORRUPTION_THRESHOLD,
  OFFICE_COST,
  OFFICE_MIN_INFRASTRUCTURE,
  OFFICE_MIN_POPULATION,
  OFFICE_UPKEEP,
  OVERCROWD_OUTFLOW_RATE,
  PARAM_MAX,
  PARAM_MIN,
  PERCENT,
  POPULATION_GROWTH_BASE,
  POPULATION_GROWTH_PER_HAPPINESS,
  POPULATION_OUTFLOW_PER_HAPPINESS,
  RELIEF_HAPPINESS_PER_MAG,
  RESIDENTIAL_COST_PER_MAG,
  RESIDENTIAL_UNITS_PER_MAG,
  RESIDENTS_PER_HOUSING_TILE,
  ROAD_COST_PER_MAG,
  ROAD_INFRA_PER_MAG,
  SECURITY_CORRUPTION_PER_MAG,
  SECURITY_COST_PER_MAG,
  SECURITY_HAPPINESS_PER_MAG,
  TAX_PER_CAPITA,
  WELFARE_COST_PER_MAG,
  WELFARE_HAPPINESS_PER_MAG,
  WELL_COST_PER_MAG,
  WELL_HAPPINESS_PER_MAG,
  WELL_INFRA_PER_MAG,
} from "../domain/constants";
import type { DecreeIntent } from "../domain/DecreeIntent";
import type { Facilities, Params } from "../domain/GameState";
import { clamp, stableFloor } from "../domain/math";
import type { Execution, ExecutionNote, FixedCostFailure } from "../domain/TurnRecord";
import { isAllowedCombination, type Target } from "../domain/Vocabulary";
import { chance, type Rng } from "../services/Rng";

// ルールエンジン（CLAUDE.md §4-1：状態を変更できるのはここだけ）。BALANCE §2, §3, §5。

export interface CityState {
  readonly params: Params;
  readonly facilities: Facilities;
}

export interface ExecutionResult extends CityState {
  readonly execution: Execution;
}

const NOTHING: Omit<Execution, "notes"> = { cost: 0, scale: 1, hollowAdded: 0 };

const noop = (city: CityState, note: ExecutionNote): ExecutionResult => ({
  ...city,
  execution: { ...NOTHING, notes: [note] },
});

/** 規模に比例する効果（magnitude 1 あたり） */
interface ScaledEffect {
  readonly costPerMag: number;
  readonly infrastructure?: number;
  readonly happiness?: number;
  readonly corruption?: number;
  readonly housingUnits?: number;
}

const SCALED_EFFECTS: Partial<Record<Target, ScaledEffect>> = {
  road: { costPerMag: ROAD_COST_PER_MAG, infrastructure: ROAD_INFRA_PER_MAG },
  well: { costPerMag: WELL_COST_PER_MAG, infrastructure: WELL_INFRA_PER_MAG, happiness: WELL_HAPPINESS_PER_MAG },
  residential: { costPerMag: RESIDENTIAL_COST_PER_MAG, housingUnits: RESIDENTIAL_UNITS_PER_MAG },
  welfare: { costPerMag: WELFARE_COST_PER_MAG, happiness: WELFARE_HAPPINESS_PER_MAG },
  security: {
    costPerMag: SECURITY_COST_PER_MAG,
    corruption: -SECURITY_CORRUPTION_PER_MAG,
    happiness: SECURITY_HAPPINESS_PER_MAG,
  },
};

/** 予算による縮小率（A-07 / DECISIONS D-08）。国庫と LLM の budget の小さい方に合わせる */
export const budgetScale = (
  cost: number,
  treasury: number,
  budget: number,
): { readonly scale: number; readonly cause: "treasury" | "budget" | null } => {
  if (cost <= 0) return { scale: 1, cause: null };
  const byTreasury = treasury >= cost ? 1 : Math.max(0, treasury) / cost;
  const byBudget = budget > 0 && budget < cost ? budget / cost : 1;
  if (byTreasury >= 1 && byBudget >= 1) return { scale: 1, cause: null };
  return byTreasury <= byBudget ? { scale: byTreasury, cause: "treasury" } : { scale: byBudget, cause: "budget" };
};

const fixedCostFailure = (cost: number, treasury: number, budget: number): FixedCostFailure | null =>
  treasury < cost ? "treasury" : budget > 0 && budget < cost ? "budget" : null;

/**
 * 歪み適用後の指示を執行する（自然変化の前）。
 * effectFactor は骨抜きによる効果倍率で、コストには掛からない。
 */
export const executeDecree = (city: CityState, intent: DecreeIntent, effectFactor: number): ExecutionResult => {
  const { params, facilities } = city;
  if (intent.action === "appoint" || intent.action === "dismiss") return noop(city, { kind: "noop", reason: "appointDismiss" });
  if (intent.target === null) return noop(city, { kind: "noop", reason: "unknownTarget" });
  if (intent.confidence < LOW_CONFIDENCE_THRESHOLD) return noop(city, { kind: "noop", reason: "lowConfidence" });
  if (!isAllowedCombination(intent.action, intent.target)) {
    return noop(city, { kind: "noop", reason: "invalidCombination" });
  }

  const m = clamp(intent.magnitude, MAGNITUDE_MIN, MAGNITUDE_MAX);
  const target: Target = intent.action === "tax" ? "tax" : intent.target;

  if (target === "tax") {
    if (m > 0) {
      return {
        params: {
          ...params,
          treasury: params.treasury + params.population * LEVY_PER_CAPITA_PER_MAG * m * effectFactor,
          happiness: params.happiness - LEVY_HAPPINESS_PER_MAG * m * effectFactor,
        },
        facilities,
        execution: { ...NOTHING, notes: [{ kind: "applied" }] },
      };
    }
    if (m === 0) return noop(city, { kind: "noop", reason: "nonPositive" });
    return applyScaled(city, intent.budget, params.population * LEVY_PER_CAPITA_PER_MAG * -m, (scale) => ({
      happiness: RELIEF_HAPPINESS_PER_MAG * -m * scale * effectFactor,
    }));
  }

  if (m <= 0) return noop(city, { kind: "noop", reason: "nonPositive" });

  if (target === "office") {
    const reason: FixedCostFailure | null = facilities.officeBuilt
      ? "alreadyBuilt"
      : params.population < OFFICE_MIN_POPULATION
        ? "population"
        : params.infrastructure < OFFICE_MIN_INFRASTRUCTURE
          ? "infrastructure"
          : fixedCostFailure(OFFICE_COST, params.treasury, intent.budget);
    if (reason !== null) return noop(city, { kind: "officeFailed", reason });
    return {
      params: { ...params, treasury: params.treasury - OFFICE_COST },
      facilities: { ...facilities, officeBuilt: true },
      execution: { ...NOTHING, cost: OFFICE_COST, notes: [{ kind: "officeBuilt" }] },
    };
  }

  if (target === "market") {
    const reason: FixedCostFailure | null =
      facilities.marketCount >= MARKET_MAX ? "max" : fixedCostFailure(MARKET_COST, params.treasury, intent.budget);
    if (reason !== null) return noop(city, { kind: "marketFailed", reason });
    return {
      params: { ...params, treasury: params.treasury - MARKET_COST },
      facilities: { ...facilities, marketCount: facilities.marketCount + 1 },
      execution: { ...NOTHING, cost: MARKET_COST, notes: [{ kind: "marketBuilt" }] },
    };
  }

  const effect = SCALED_EFFECTS[target];
  if (effect === undefined) return noop(city, { kind: "noop", reason: "invalidCombination" });
  return applyScaled(city, intent.budget, effect.costPerMag * m, (scale) => {
    const amount = m * scale;
    const infraGain = (effect.infrastructure ?? 0) * amount;
    return {
      infrastructure: infraGain * effectFactor,
      happiness: (effect.happiness ?? 0) * amount * effectFactor,
      corruption: (effect.corruption ?? 0) * amount * effectFactor,
      housingUnits: (effect.housingUnits ?? 0) * amount * effectFactor,
      hollow: infraGain * (1 - effectFactor),
    };
  });
};

interface Gains {
  readonly infrastructure?: number;
  readonly happiness?: number;
  readonly corruption?: number;
  readonly housingUnits?: number;
  readonly hollow?: number;
}

const applyScaled = (
  city: CityState,
  budget: number,
  fullCost: number,
  gainsAt: (scale: number) => Gains,
): ExecutionResult => {
  const { params, facilities } = city;
  const { scale, cause } = budgetScale(fullCost, params.treasury, budget);
  if (scale < MIN_EFFECTIVE_SCALE) return noop(city, { kind: "nothingAffordable" });
  const gains = gainsAt(scale);
  const cost = fullCost * scale;
  const hollowAdded = gains.hollow ?? 0;
  const notes: ExecutionNote[] = [{ kind: "applied" }];
  if (cause !== null) notes.push({ kind: "budgetScaled", ratio: scale, cause });
  return {
    params: {
      ...params,
      treasury: params.treasury - cost,
      infrastructure: params.infrastructure + (gains.infrastructure ?? 0),
      happiness: params.happiness + (gains.happiness ?? 0),
      corruption: params.corruption + (gains.corruption ?? 0),
    },
    facilities: {
      ...facilities,
      housingUnits: facilities.housingUnits + (gains.housingUnits ?? 0),
      hollowInfrastructure: facilities.hollowInfrastructure + hollowAdded,
    },
    execution: { notes, cost, scale, hollowAdded },
  };
};

// --- 自然変化（BALANCE §2） ---

export const housingCapacity = (facilities: Facilities): number =>
  Math.floor(facilities.housingUnits) * RESIDENTS_PER_HOUSING_TILE;

export const naturalUpdate = (city: CityState, aideCount: number): Effect.Effect<CityState, never, Rng> =>
  Effect.gen(function* () {
    const { params, facilities } = city;
    const capacity = housingCapacity(facilities);

    // 人口
    const h = params.happiness;
    let rate =
      h >= HAPPINESS_GROWTH_THRESHOLD
        ? POPULATION_GROWTH_BASE + (h - HAPPINESS_NEUTRAL) * POPULATION_GROWTH_PER_HAPPINESS
        : (h - HAPPINESS_NEUTRAL) * POPULATION_OUTFLOW_PER_HAPPINESS;
    if (params.population > capacity && rate > 0) rate = 0;
    let population = params.population * (1 + rate);
    const overcrowded = population > capacity;
    if (overcrowded) population -= (population - capacity) * OVERCROWD_OUTFLOW_RATE;
    population = stableFloor(Math.max(0, population));

    // 国庫
    const taxRevenue =
      population *
      TAX_PER_CAPITA *
      (1 + MARKET_TAX_BONUS * facilities.marketCount) *
      (1 - params.corruption / PERCENT);
    const upkeep =
      params.infrastructure * INFRA_UPKEEP_PER_POINT +
      AIDE_SALARY * aideCount +
      (facilities.officeBuilt ? OFFICE_UPKEEP : 0);

    // 幸福度（A-08 のペナルティを含む）
    const penalty =
      (overcrowded ? CROWDING_HAPPINESS_PENALTY : 0) +
      (params.corruption > NEGLECTED_CORRUPTION_THRESHOLD ? NEGLECTED_CORRUPTION_PENALTY : 0);
    const equilibrium =
      HAPPINESS_EQUILIBRIUM_BASE +
      params.infrastructure * HAPPINESS_PER_INFRA -
      params.corruption * HAPPINESS_PENALTY_PER_CORRUPTION -
      penalty / HAPPINESS_REVERT_RATE;
    const happiness = h + (equilibrium - h) * HAPPINESS_REVERT_RATE;

    const decayed = yield* chance(INFRA_DECAY_CHANCE);
    const hollow = Math.max(0, facilities.hollowInfrastructure - HOLLOW_DECAY_PER_TURN);

    return {
      params: {
        population,
        treasury: params.treasury + taxRevenue - upkeep,
        happiness,
        infrastructure: params.infrastructure - (decayed ? INFRA_DECAY_AMOUNT : 0),
        corruption: params.corruption + CORRUPTION_DRIFT_PER_TURN,
      },
      facilities: {
        ...facilities,
        hollowInfrastructure: hollow,
        hollowDisclosed: hollow > 0 && facilities.hollowDisclosed,
      },
    };
  });

/** 幸福度・インフラ・汚職を [0,100] に、人口を 0 以上の整数に。国庫は clamp しない（BALANCE §0） */
export const clampParams = (params: Params): Params => ({
  population: Math.max(0, stableFloor(params.population)),
  treasury: params.treasury,
  happiness: clamp(params.happiness, PARAM_MIN, PARAM_MAX),
  infrastructure: clamp(params.infrastructure, PARAM_MIN, PARAM_MAX),
  corruption: clamp(params.corruption, PARAM_MIN, PARAM_MAX),
});
