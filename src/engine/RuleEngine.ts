import { Effect } from "effect";
import { BUILDINGS, BUILDING_IDS, POLICY_IDS, type BuildingId, type PolicyId } from "../domain/Buildings";
import { advanceConstruction, addMaterials, hollowChance, newProject, type Project } from "../domain/Construction";
import {
  AIDE_SALARY,
  BANDIT_AFTERMATH_CORRUPTION,
  BANDIT_HAPPINESS_PENALTY,
  BANDIT_TREASURY_LOSS,
  BANDIT_WOOD_LOSS,
  BUILD_COST_MULTIPLIER,
  CORRUPTION_DRIFT_PER_TURN,
  CROWDING_HAPPINESS_PENALTY,
  DECREE_BASE_COST,
  DISEASE_OUTFLOW_RATE,
  EPIDEMIC_AFTERMATH_HAPPINESS,
  EPIDEMIC_HAPPINESS_PENALTY,
  EPIDEMIC_POPULATION_LOSS,
  EVENT_COOLDOWN_TURNS,
  EVENT_MAX_TURNS,
  EVENT_RESOLVE_HAPPINESS,
  FAMINE_EVENT_AFTERMATH_POPULATION,
  FAMINE_HAPPINESS_PENALTY,
  FAMINE_OUTFLOW_RATE,
  HAPPINESS_EQUILIBRIUM_BASE,
  HAPPINESS_GROWTH_THRESHOLD,
  HAPPINESS_NEUTRAL,
  HAPPINESS_PENALTY_PER_CORRUPTION,
  HAPPINESS_PER_INFRA,
  HAPPINESS_REF_POP,
  HAPPINESS_REVERT_RATE,
  HOLLOW_REPAIR_COST_RATIO,
  HOLLOW_ROAD_INFRA_FACTOR,
  INFRA_DECAY_AMOUNT,
  INFRA_DECAY_CHANCE,
  LOW_CONFIDENCE_THRESHOLD,
  MAGNITUDE_MAX,
  MAGNITUDE_MIN,
  MAGNITUDE_PER_BUILDING,
  MAX_BUILD_PER_DECREE,
  NEGLECTED_CORRUPTION_PENALTY,
  NEGLECTED_CORRUPTION_THRESHOLD,
  OVERCROWD_OUTFLOW_RATE,
  PARAM_MAX,
  PARAM_MIN,
  PERCENT,
  POLICY_DURATION_TURNS,
  POLICY_LARGE_MAGNITUDE,
  POLICY_LEVEL_MAX,
  POPULATION_GROWTH_BASE,
  POPULATION_GROWTH_PER_HAPPINESS,
  POPULATION_OUTFLOW_PER_HAPPINESS,
  ROAD_TILE_TAX,
  ROAD_TILE_UPKEEP,
  SANITATION_LOW,
  SANITATION_PENALTY,
  SECURITY_LOW,
  SECURITY_PENALTY,
  SECURITY_POLICY_COST_PER_LEVEL,
  SECURITY_POLICY_HAPPINESS_PER_LEVEL,
  STONE_INCOME,
  TAX_PER_CAPITA,
  TAX_RATE_HAPPINESS_PER_LEVEL,
  TAX_RATE_INCOME_PER_LEVEL,
  TAX_RATE_SHOCK_PER_LEVEL,
  UPKEEP_MULTIPLIER,
  WELFARE_COST_PER_CAPITA_PER_LEVEL,
  WELFARE_HAPPINESS_PER_LEVEL,
  WOOD_INCOME,
  WORKSHOP_STONE,
  WORKSHOP_WOOD,
} from "../domain/constants";
import type { DecreeIntent } from "../domain/DecreeIntent";
import { countBuildings, countFunctional, laborForce, type BuildingInstance } from "../domain/DerivedStats";
import { EVENT_KINDS, eventChance, resolvesEvent, type ActiveEvent, type ResolvingAction } from "../domain/Events";
import type { GameState, Params, PolicyState } from "../domain/GameState";
import { chooseTile, freeBuildingTiles, occupiedTiles, placementUnit, roadTileCount, tileKey, type Coord } from "../domain/Map";
import { clamp, stableFloor } from "../domain/math";
import type { Completion, ConstructionReport, EventNote, Execution, ExecutionNote, OrderFailure, OrderLimit } from "../domain/TurnRecord";
import { resolveCombination } from "../domain/Vocabulary";
import { chance, type Rng } from "../services/Rng";
import { derivedOf } from "./DerivedCalculator";

// ルールエンジン（CLAUDE.md §4-1：状態を変更できるのはここだけ）。
// v3.2：建物・政策・組合せ表・前提（BALANCE 第2部） ／ v3.3：工期・労働・資材・イベント（BALANCE 第3部）

/** 発注の区画の乱数に使う、通し番号の空間（建物の通し番号と重ならないようにずらす） */
const PROJECT_TILE_SALT = 1_000_000;
const MAX_TILES_PER_PROJECT = 10;
/** 骨抜きのとき、空洞にする割合（棟数の半分） */
const WATER_DOWN_HOLLOW_DIVISOR = 2;
const COIN = 0.5;

export interface DecreeOutcome {
  readonly state: GameState;
  readonly execution: Execution;
  /** 解決されたイベント（あれば） */
  readonly eventNote: EventNote | null;
}

const noop = (state: GameState, note: ExecutionNote): DecreeOutcome => ({
  state,
  execution: { notes: [note], cost: 0, baseCostCharged: false },
  eventNote: null,
});

/** 建設数（V-06）：1〜34→1棟、35〜68→2棟、69〜100→3棟 */
export const buildCountFor = (magnitude: number): number =>
  Math.min(MAX_BUILD_PER_DECREE, Math.max(1, Math.ceil(magnitude / MAGNITUDE_PER_BUILDING)));

const unitCost = (kind: BuildingId, repair: boolean): number =>
  BUILDINGS[kind].cost * BUILD_COST_MULTIPLIER * (repair ? HOLLOW_REPAIR_COST_RATIO : 1);

const resolveEvent = (state: GameState, action: ResolvingAction): { state: GameState; note: EventNote | null } => {
  if (state.event === null || !resolvesEvent(state.event.kind, action)) return { state, note: null };
  return {
    state: {
      ...state,
      event: null,
      eventCooldown: EVENT_COOLDOWN_TURNS,
      params: { ...state.params, happiness: state.params.happiness + EVENT_RESOLVE_HAPPINESS },
    },
    note: { kind: "resolved", event: state.event.kind },
  };
};

/** 前提・上限のチェック（V-09）。満たさなければ理由を返す */
const prerequisiteFailure = (state: GameState, kind: BuildingId): { reason: OrderFailure; detail: BuildingId | null } | null => {
  const def = BUILDINGS[kind];
  const pre = def.prerequisite;
  if (pre?.kind === "minPopulation" && state.params.population < pre.value) return { reason: "population", detail: null };
  if (pre?.kind === "building" && !state.buildings.some((b) => b.kind === pre.building)) {
    return { reason: "prerequisite", detail: pre.building };
  }
  if (def.maxCount !== null) {
    const existing = state.buildings.filter((b) => b.kind === kind).length;
    const queued = state.projects.filter((p) => p.kind === kind && !p.repair).reduce((sum, p) => sum + p.count, 0);
    if (existing + queued >= def.maxCount) return { reason: "maxCount", detail: null };
  }
  return null;
};

const orderConstruction = (
  state: GameState,
  kind: BuildingId,
  magnitude: number,
  budget: number,
  repairFirst: boolean,
  waterDown: boolean,
): DecreeOutcome => {
  const def = BUILDINGS[kind];
  const failure = prerequisiteFailure(state, kind);
  if (failure) return noop(state, { kind: "orderFailed", building: kind, reason: failure.reason, detail: failure.detail });

  const underRepair = new Set(state.projects.flatMap((p) => p.repairSerials));
  const hollow = state.buildings.filter((b) => b.kind === kind && b.hollow && !underRepair.has(b.serial));
  const repair = repairFirst && hollow.length > 0;
  let requested = buildCountFor(magnitude);
  if (repair) requested = Math.min(requested, hollow.length);
  if (!repair && def.maxCount !== null) requested = Math.min(requested, def.maxCount);

  // 勅令の基本コストを引いた後の国庫で買える棟数（A-07）
  const available = state.params.treasury - DECREE_BASE_COST;
  const price = unitCost(kind, repair);
  const limits: [OrderLimit, number][] = [
    ["tiles", repair || !def.occupiesTile ? requested : freeBuildingTiles(state.buildings, state.projects)],
    ["treasury", Math.floor(Math.max(0, available) / price)],
    ["budget", budget > 0 ? Math.floor(budget / price) : requested],
  ];
  const binding = limits.reduce((min, l) => (l[1] < min[1] ? l : min), ["treasury" as OrderLimit, requested] as [OrderLimit, number]);
  const count = Math.min(requested, binding[1]);
  if (count <= 0) return noop(state, { kind: "orderFailed", building: kind, reason: binding[0], detail: null });

  // 区画を確保する（Z-13）
  const occupied = occupiedTiles(state.buildings, state.projects);
  const tiles: Coord[] = [];
  if (!repair && def.occupiesTile) {
    for (let i = 0; i < count; i++) {
      const salt = PROJECT_TILE_SALT + state.nextProjectId * MAX_TILES_PER_PROJECT + i;
      const tile = chooseTile(occupied, kind, placementUnit(state.saveId, salt));
      if (tile === null) break;
      occupied.add(tileKey(tile));
      tiles.push(tile);
    }
  }
  const project = newProject(state.nextProjectId, kind, count, state.turn, {
    repair,
    repairSerials: repair ? hollow.slice(0, count).map((b) => b.serial) : [],
    tiles,
    waterDown,
    costRatio: repair ? HOLLOW_REPAIR_COST_RATIO : 1,
  });
  const cost = price * count;
  const ordered: GameState = {
    ...state,
    params: { ...state.params, treasury: state.params.treasury - cost },
    projects: [...state.projects, project],
    nextProjectId: state.nextProjectId + 1,
  };
  const resolved = resolveEvent(ordered, { kind: "construct", building: kind });
  return {
    state: resolved.state,
    execution: {
      notes: [
        { kind: "ordered", building: kind, requested, count, repair, limitedBy: count < requested ? binding[0] : null, cost },
      ],
      cost,
      baseCostCharged: true,
    },
    eventNote: resolved.note,
  };
};

const changePolicy = (state: GameState, policy: PolicyId, direction: 1 | -1, magnitude: number): DecreeOutcome => {
  const current = state.policies[policy];
  const step = Math.abs(magnitude) >= POLICY_LARGE_MAGNITUDE ? 2 : 1;
  const to = clamp(current.level + direction * step, -POLICY_LEVEL_MAX, POLICY_LEVEL_MAX);
  // 税率を上げた瞬間の幸福の落ち込み（A-08 / X-14）
  const shock = policy === "tax_rate" && to > current.level ? TAX_RATE_SHOCK_PER_LEVEL * (to - current.level) : 0;
  const changed: GameState = {
    ...state,
    params: { ...state.params, happiness: state.params.happiness - shock },
    policies: { ...state.policies, [policy]: { level: to, turnsLeft: POLICY_DURATION_TURNS } },
  };
  const resolved = resolveEvent(changed, { kind: "policy", policy, direction });
  return {
    state: resolved.state,
    execution: { notes: [{ kind: "policyChanged", policy, from: current.level, to }], cost: 0, baseCostCharged: true },
    eventNote: resolved.note,
  };
};

/**
 * 歪み適用後の指示を執行する（自然変化の前）。建物は「発注」（v3.3）、政策は即時。
 * effectFactor < 1 は骨抜き（完成時に半数が空洞。Z-15）。
 * 無効・前提未達・予算不足は国庫を消費しない（基本コストも取らない。W-11）。
 */
export const executeDecree = (state: GameState, intent: DecreeIntent, effectFactor: number): DecreeOutcome => {
  if (intent.action === "appoint" || intent.action === "dismiss") return noop(state, { kind: "noop", reason: "appointDismiss" });
  if (intent.target === null) return noop(state, { kind: "noop", reason: "unknownTarget" });
  if (intent.confidence < LOW_CONFIDENCE_THRESHOLD) return noop(state, { kind: "noop", reason: "lowConfidence" });
  const m = clamp(intent.magnitude, MAGNITUDE_MIN, MAGNITUDE_MAX);
  const resolution = resolveCombination(intent.action, intent.target, m);
  switch (resolution.kind) {
    case "noop":
      return noop(state, { kind: "noop", reason: resolution.reason });
    case "policy":
      return changePolicy(state, resolution.policy, resolution.direction, m);
    case "construct":
      return orderConstruction(state, resolution.building, m, intent.budget, resolution.repairFirst, effectFactor < 1);
  }
};

// --- 自然変化（BALANCE §15, §21〜§25） ---

export interface NaturalOutcome {
  readonly state: GameState;
  readonly construction: ConstructionReport;
  readonly events: readonly EventNote[];
  readonly taxRevenue: number;
  readonly upkeep: number;
}

const completeProjects = (
  state: GameState,
  finished: readonly Project[],
): Effect.Effect<{ buildings: BuildingInstance[]; nextSerial: number; infrastructure: number; completions: Completion[] }, never, Rng> =>
  Effect.gen(function* () {
    let buildings = [...state.buildings];
    let nextSerial = state.nextSerial;
    let infrastructure = state.params.infrastructure;
    const completions: Completion[] = [];
    for (const p of finished) {
      if (p.repair) {
        const serials = new Set(p.repairSerials);
        buildings = buildings.map((b) => (serials.has(b.serial) ? { ...b, hollow: false, disclosed: false } : b));
        completions.push({ building: p.kind, count: p.count, repair: true, hollowCount: 0 });
        continue;
      }
      // 空洞化：汚職（5種のみ）＋無理な命令＋手抜き（BALANCE §24）、骨抜きなら半数（Z-15）
      const probability = hollowChance(p, state.params.corruption);
      const flags: boolean[] = [];
      for (let i = 0; i < p.count; i++) flags.push(yield* chance(probability));
      if (p.waterDown) {
        const minimum = p.count > 1 ? Math.floor(p.count / WATER_DOWN_HOLLOW_DIVISOR) : (yield* chance(COIN)) ? 1 : 0;
        for (let i = 0; flags.filter(Boolean).length < minimum && i < flags.length; i++) flags[i] = true;
      }
      const hollowCount = flags.filter(Boolean).length;
      if (p.kind === "road") {
        const solid = p.count - hollowCount;
        infrastructure += BUILDINGS.road.effects.infrastructure * (solid + hollowCount * HOLLOW_ROAD_INFRA_FACTOR);
      } else {
        for (let i = 0; i < p.count; i++) {
          buildings.push({ serial: nextSerial++, kind: p.kind, builtTurn: state.turn, hollow: flags[i] ?? false, disclosed: false, tile: p.tiles[i] ?? null });
        }
      }
      completions.push({ building: p.kind, count: p.count, repair: false, hollowCount });
    }
    return { buildings, nextSerial, infrastructure, completions };
  });

const tickPolicies = (policies: Readonly<Record<PolicyId, PolicyState>>): Record<PolicyId, PolicyState> =>
  Object.fromEntries(
    POLICY_IDS.map((id) => {
      const p = policies[id];
      if (p.turnsLeft > 0) return [id, { ...p, turnsLeft: p.turnsLeft - 1 }];
      return [id, { ...p, level: p.level === 0 ? 0 : p.level - Math.sign(p.level) }];
    }),
  ) as Record<PolicyId, PolicyState>;

const sumOver = (counts: Readonly<Record<BuildingId, number>>, pick: (id: BuildingId) => number): number =>
  BUILDING_IDS.reduce((total, id) => total + pick(id) * counts[id], 0);

export const naturalUpdate = (state: GameState, aideCount: number): Effect.Effect<NaturalOutcome, never, Rng> =>
  Effect.gen(function* () {
    const p0 = state.params;
    const event = state.event;

    // 1) 工事（労働人口と秘匿資材の割り振り、完成、空洞化。v3.3）
    const labor = laborForce(p0.population);
    const step = advanceConstruction(state.projects, labor, state.materials);
    const done = yield* completeProjects(state, step.finished);
    let corruption = p0.corruption + step.corruptionIncrease;
    const built: GameState = {
      ...state,
      buildings: done.buildings,
      nextSerial: done.nextSerial,
      projects: step.projects,
      params: { ...p0, infrastructure: done.infrastructure, corruption },
    };

    // 2) 派生指標（完成した建物を含む）
    const d = derivedOf(built);
    const functional = countFunctional(done.buildings);
    const all = countBuildings(done.buildings);
    const taxLevel = state.policies.tax_rate.level;
    const welfareLevel = state.policies.welfare_policy.level;
    const securityLevel = state.policies.security_policy.level;

    // 3) 人口
    const h = p0.happiness;
    const shortfall = Math.max(0, d.foodDemand - d.food) / Math.max(1, d.foodDemand);
    let rate =
      h >= HAPPINESS_GROWTH_THRESHOLD
        ? POPULATION_GROWTH_BASE + (h - HAPPINESS_NEUTRAL) * POPULATION_GROWTH_PER_HAPPINESS
        : (h - HAPPINESS_NEUTRAL) * POPULATION_OUTFLOW_PER_HAPPINESS;
    const blocked = p0.population > d.housingCapacity || shortfall > 0 || event?.kind === "epidemic";
    if (blocked && rate > 0) rate = 0;
    rate -=
      FAMINE_OUTFLOW_RATE * shortfall +
      (d.sanitation < SANITATION_LOW ? DISEASE_OUTFLOW_RATE : 0) +
      (event?.kind === "epidemic" ? EPIDEMIC_POPULATION_LOSS : 0);
    let population = p0.population * (1 + rate);
    const overcrowded = population > d.housingCapacity;
    if (overcrowded) population -= (population - d.housingCapacity) * OVERCROWD_OUTFLOW_RATE;
    population = stableFloor(Math.max(0, population));

    // 4) 国庫（税は毎年、維持費は毎年・完成した建物から。V-14, Z-12）
    const roadTiles = roadTileCount(built.params.infrastructure);
    const buildingTax = sumOver(functional, (id) => BUILDINGS[id].effects.tax) + ROAD_TILE_TAX * roadTiles;
    const taxRevenue =
      (population * TAX_PER_CAPITA * (1 + TAX_RATE_INCOME_PER_LEVEL * taxLevel) + buildingTax) * (1 - Math.min(PERCENT, corruption) / PERCENT);
    const upkeep =
      (sumOver(all, (id) => BUILDINGS[id].upkeep) + ROAD_TILE_UPKEEP * roadTiles) * UPKEEP_MULTIPLIER +
      AIDE_SALARY * aideCount +
      Math.max(0, welfareLevel) * WELFARE_COST_PER_CAPITA_PER_LEVEL * population +
      Math.max(0, securityLevel) * SECURITY_POLICY_COST_PER_LEVEL +
      (event?.kind === "bandits" ? BANDIT_TREASURY_LOSS : 0);

    // 5) 幸福度
    const buildingHappiness =
      sumOver(functional, (id) => BUILDINGS[id].effects.happiness) * (HAPPINESS_REF_POP / Math.max(HAPPINESS_REF_POP, population));
    const penalty =
      (overcrowded ? CROWDING_HAPPINESS_PENALTY : 0) +
      (corruption > NEGLECTED_CORRUPTION_THRESHOLD ? NEGLECTED_CORRUPTION_PENALTY : 0) +
      (d.sanitation < SANITATION_LOW ? SANITATION_PENALTY : 0) +
      (d.security < SECURITY_LOW ? SECURITY_PENALTY : 0) +
      FAMINE_HAPPINESS_PENALTY * shortfall +
      (event?.kind === "epidemic" ? EPIDEMIC_HAPPINESS_PENALTY : 0) +
      (event?.kind === "bandits" ? BANDIT_HAPPINESS_PENALTY : 0);
    const equilibrium =
      HAPPINESS_EQUILIBRIUM_BASE +
      buildingHappiness +
      built.params.infrastructure * HAPPINESS_PER_INFRA -
      corruption * HAPPINESS_PENALTY_PER_CORRUPTION -
      TAX_RATE_HAPPINESS_PER_LEVEL * taxLevel +
      WELFARE_HAPPINESS_PER_LEVEL * welfareLevel -
      SECURITY_POLICY_HAPPINESS_PER_LEVEL * securityLevel -
      penalty / HAPPINESS_REVERT_RATE;
    let happiness = h + (equilibrium - h) * HAPPINESS_REVERT_RATE;

    // 6) インフラの劣化・汚職
    const decayed = yield* chance(INFRA_DECAY_CHANCE);
    corruption += CORRUPTION_DRIFT_PER_TURN + sumOver(functional, (id) => BUILDINGS[id].effects.corruptionPerTurn);

    // 7) 資材（秘匿）
    let materials = addMaterials(step.materials, WOOD_INCOME + WORKSHOP_WOOD * functional.workshop, STONE_INCOME + WORKSHOP_STONE * functional.workshop);
    if (event?.kind === "bandits") materials = addMaterials(materials, -materials.wood * BANDIT_WOOD_LOSS, 0);

    // 8) イベント（Z-08, Z-09 / BALANCE §25）
    const events: EventNote[] = [];
    let nextEvent: ActiveEvent | null = event;
    let cooldown = state.eventCooldown;
    if (event !== null) {
      if (event.turns + 1 >= EVENT_MAX_TURNS) {
        if (event.kind === "epidemic") happiness -= EPIDEMIC_AFTERMATH_HAPPINESS;
        if (event.kind === "famine") population = stableFloor(population * (1 - FAMINE_EVENT_AFTERMATH_POPULATION));
        if (event.kind === "bandits") corruption += BANDIT_AFTERMATH_CORRUPTION;
        events.push({ kind: "expired", event: event.kind });
        nextEvent = null;
        cooldown = EVENT_COOLDOWN_TURNS;
      } else {
        nextEvent = { ...event, turns: event.turns + 1 };
        events.push({ kind: "ongoing", event: event.kind, turns: event.turns + 1 });
      }
    } else if (cooldown > 0) {
      cooldown -= 1;
    } else {
      const granary = functional.granary > 0;
      for (const kind of EVENT_KINDS) {
        if (yield* chance(eventChance(kind, d, granary))) {
          nextEvent = { kind, turns: 0, startedTurn: state.turn };
          events.push({ kind: "started", event: kind });
          break;
        }
      }
    }

    const params: Params = {
      population,
      treasury: p0.treasury + taxRevenue - upkeep,
      happiness,
      infrastructure: built.params.infrastructure - (decayed ? INFRA_DECAY_AMOUNT : 0),
      corruption,
    };
    return {
      state: { ...built, params, materials, policies: tickPolicies(state.policies), event: nextEvent, eventCooldown: cooldown },
      construction: {
        laborForce: labor,
        laborDemand: step.laborDemand,
        overload: step.overload,
        materialShortage: step.shortage,
        completions: done.completions,
        materialsAfter: materials,
      },
      events,
      taxRevenue,
      upkeep,
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
