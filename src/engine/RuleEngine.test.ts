import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { BUILDINGS, type BuildingId } from "../domain/Buildings";
import { newProject } from "../domain/Construction";
import {
  DECREE_BASE_COST,
  EVENT_MAX_TURNS,
  EVENT_RESOLVE_HAPPINESS,
  HOLLOW_REPAIR_COST_RATIO,
  PARAM_MAX,
  POLICY_DURATION_TURNS,
  TAX_RATE_SHOCK_PER_LEVEL,
} from "../domain/constants";
import type { BuildingInstance } from "../domain/DerivedStats";
import { createInitialState, type GameState } from "../domain/GameState";
import { RngScripted, type Rng } from "../services/Rng";
import { intentOf } from "../test/fixtures";
import { buildCountFor, clampParams, executeDecree, naturalUpdate } from "./RuleEngine";

const run = <A>(effect: Effect.Effect<A, never, Rng>, values: readonly number[] = []) =>
  Effect.runSync(effect.pipe(Effect.provide(RngScripted(values))));

const base = (): GameState => createInitialState(1);
const withBuilding = (state: GameState, kind: BuildingId, extra: Partial<BuildingInstance> = {}): GameState => ({
  ...state,
  buildings: [...state.buildings, { serial: state.nextSerial, kind, builtTurn: 0, hollow: false, disclosed: false, tile: null, ...extra }],
  nextSerial: state.nextSerial + 1,
});

describe("組合せ表と無効な指示（v3.2 §2.4 / V-08）", () => {
  it("建物を build すると発注し、棟数は ceil(m/34)（上限3）", () => {
    expect([1, 34, 35, 68, 69, 100].map(buildCountFor)).toEqual([1, 1, 2, 2, 3, 3]);
    const { state, execution } = executeDecree(base(), intentOf({ target: "well", magnitude: 50 }), 1);
    expect(execution.notes).toEqual([
      { kind: "ordered", building: "well", requested: 2, count: 2, repair: false, limitedBy: null, cost: BUILDINGS.well.cost * 2 },
    ]);
    expect(execution.baseCostCharged).toBe(true);
    expect(state.projects).toHaveLength(1);
    expect(state.projects[0]).toMatchObject({ kind: "well", count: 2, progress: 0 });
    expect(state.params.treasury).toBe(base().params.treasury - BUILDINGS.well.cost * 2);
    // 完成するまで建物は増えない（v3.3）
    expect(state.buildings).toHaveLength(base().buildings.length);
  });

  it("建物に reform、負の規模の build は no-op で国庫を消費しない", () => {
    const s = base();
    for (const intent of [intentOf({ action: "reform", target: "market" }), intentOf({ target: "market", magnitude: -30 })]) {
      const outcome = executeDecree(s, intent, 1);
      expect(outcome.state).toBe(s);
      expect(outcome.execution.baseCostCharged).toBe(false);
      expect(outcome.execution.notes[0]?.kind).toBe("noop");
    }
  });

  it("未知の対象・低確信度・任免は no-op", () => {
    const s = base();
    expect(executeDecree(s, intentOf({ target: null }), 1).execution.notes).toEqual([{ kind: "noop", reason: "unknownTarget" }]);
    expect(executeDecree(s, intentOf({ confidence: 0.1 }), 1).execution.notes).toEqual([{ kind: "noop", reason: "lowConfidence" }]);
    expect(executeDecree(s, intentOf({ action: "appoint" }), 1).execution.notes).toEqual([{ kind: "noop", reason: "appointDismiss" }]);
  });
});

describe("前提条件の no-op（v3.2 §2.3 / V-09）", () => {
  it("役所なしの裁判所・物見櫓なしの牢・人口200未満の屋敷は発注されず、国庫も減らない", () => {
    const noTower: GameState = { ...base(), buildings: base().buildings.filter((b) => b.kind !== "watchtower") };
    const cases: [GameState, BuildingId, unknown][] = [
      [base(), "courthouse", { kind: "orderFailed", building: "courthouse", reason: "prerequisite", detail: "office" }],
      [noTower, "jail", { kind: "orderFailed", building: "jail", reason: "prerequisite", detail: "watchtower" }],
      [base(), "manor", { kind: "orderFailed", building: "manor", reason: "population", detail: null }],
    ];
    for (const [state, target, note] of cases) {
      const outcome = executeDecree(state, intentOf({ target }), 1);
      expect(outcome.execution.notes).toEqual([note]);
      expect(outcome.execution.baseCostCharged).toBe(false);
      expect(outcome.state.params.treasury).toBe(state.params.treasury);
      expect(outcome.state.projects).toHaveLength(0);
    }
  });

  it("前提を満たせば発注できる", () => {
    const outcome = executeDecree(withBuilding(base(), "office"), intentOf({ target: "courthouse", magnitude: 10 }), 1);
    expect(outcome.execution.notes[0]).toMatchObject({ kind: "ordered", building: "courthouse", count: 1 });
  });

  it("役所は1つまで（工事中も数える）", () => {
    const first = executeDecree(base(), intentOf({ target: "office", magnitude: 100 }), 1);
    expect(first.execution.notes[0]).toMatchObject({ kind: "ordered", count: 1, requested: 1 });
    const second = executeDecree(first.state, intentOf({ target: "office" }), 1);
    expect(second.execution.notes).toEqual([{ kind: "orderFailed", building: "office", reason: "maxCount", detail: null }]);
  });

  it("国庫が足りなければ棟数を減らし、1棟も買えなければ不成立（A-07）", () => {
    const poor: GameState = { ...base(), params: { ...base().params, treasury: DECREE_BASE_COST + BUILDINGS.market.cost * 1.5 } };
    const limited = executeDecree(poor, intentOf({ target: "market", magnitude: 100 }), 1);
    expect(limited.execution.notes[0]).toMatchObject({ kind: "ordered", requested: 3, count: 1, limitedBy: "treasury" });
    const broke: GameState = { ...base(), params: { ...base().params, treasury: DECREE_BASE_COST } };
    expect(executeDecree(broke, intentOf({ target: "market" }), 1).execution.notes).toEqual([
      { kind: "orderFailed", building: "market", reason: "treasury", detail: null },
    ]);
  });

  it("予算の指定があればそれ以内に収める", () => {
    const outcome = executeDecree(base(), intentOf({ target: "well", magnitude: 100, budget: BUILDINGS.well.cost }), 1);
    expect(outcome.execution.notes[0]).toMatchObject({ requested: 3, count: 1, limitedBy: "budget" });
  });
});

describe("修繕（W-10 / Z-14）", () => {
  it("invest は空洞の建物があれば修繕を優先し、費用は半額", () => {
    const s = withBuilding(base(), "granary", { hollow: true });
    const outcome = executeDecree(s, intentOf({ action: "invest", target: "granary", magnitude: 100 }), 1);
    expect(outcome.execution.notes[0]).toMatchObject({ kind: "ordered", repair: true, count: 1, cost: BUILDINGS.granary.cost * HOLLOW_REPAIR_COST_RATIO });
    expect(outcome.state.projects[0]?.repairSerials).toEqual([s.nextSerial - 1]);
  });
});

describe("政策（v3.2 §2.4 / X-14）", () => {
  it("増税は税率を1段上げ、上げた分だけ幸福が落ち込む。|m|≥60 なら2段", () => {
    const s = base();
    const small = executeDecree(s, intentOf({ action: "tax", target: "tax_rate", magnitude: 30 }), 1);
    expect(small.execution.notes).toEqual([{ kind: "policyChanged", policy: "tax_rate", from: 0, to: 1 }]);
    expect(small.state.policies.tax_rate).toEqual({ level: 1, turnsLeft: POLICY_DURATION_TURNS });
    expect(small.state.params.happiness).toBe(s.params.happiness - TAX_RATE_SHOCK_PER_LEVEL);
    const large = executeDecree(s, intentOf({ action: "tax", target: "tax_rate", magnitude: 80 }), 1);
    expect(large.state.policies.tax_rate.level).toBe(2);
    const cut = executeDecree(s, intentOf({ action: "tax", target: "tax_rate", magnitude: -30 }), 1);
    expect(cut.state.policies.tax_rate.level).toBe(-1);
    expect(cut.state.params.happiness).toBe(s.params.happiness);
  });

  it("政策は ±2 で頭打ち、期間が切れると0へ1段ずつ戻る", () => {
    let s = base();
    for (let i = 0; i < 3; i++) s = executeDecree(s, intentOf({ action: "invest", target: "welfare_policy", magnitude: 80 }), 1).state;
    expect(s.policies.welfare_policy.level).toBe(2);
    for (let i = 0; i < POLICY_DURATION_TURNS; i++) s = run(naturalUpdate(s, 2)).state;
    expect(s.policies.welfare_policy.level).toBe(2);
    s = run(naturalUpdate(s, 2)).state;
    expect(s.policies.welfare_policy.level).toBe(1);
  });
});

describe("工事（v3.3 / BALANCE §22〜§24）", () => {
  it("最短工期より早くは完成しない", () => {
    let s = executeDecree(base(), intentOf({ target: "well", magnitude: 10 }), 1).state;
    const minTurns = BUILDINGS.well.recipe.minTurns;
    for (let i = 0; i < minTurns - 1; i++) {
      const out = run(naturalUpdate(s, 2));
      expect(out.construction.completions).toEqual([]);
      s = out.state;
    }
    const done = run(naturalUpdate(s, 2));
    expect(done.construction.completions).toEqual([{ building: "well", count: 1, repair: false, hollowCount: 0 }]);
    expect(done.state.buildings.filter((b) => b.kind === "well")).toHaveLength(2);
    expect(done.state.projects).toHaveLength(0);
  });

  it("空洞化の判定：乱数が確率を下回れば空洞で完成する", () => {
    const corrupt: GameState = { ...base(), params: { ...base().params, corruption: PARAM_MAX } };
    const ordered = executeDecree(corrupt, intentOf({ target: "granary", magnitude: 10 }), 1).state;
    const project = ordered.projects[0];
    if (!project) throw new Error("発注されていない");
    const ready = { ...ordered, projects: [{ ...project, progress: project.work, elapsed: project.minTurns }] };
    const out = run(naturalUpdate(ready, 2), [0]);
    expect(out.construction.completions[0]?.hollowCount).toBe(1);
    expect(out.state.buildings.at(-1)).toMatchObject({ kind: "granary", hollow: true, disclosed: false });
  });

  it("道路はインフラになり、区画を占めない", () => {
    const s = base();
    const project = newProject(1, "road", 1, 1, { repair: false, repairSerials: [], tiles: [], waterDown: false, costRatio: 1 });
    const ready = { ...s, projects: [{ ...project, progress: project.work, elapsed: project.minTurns }] };
    const out = run(naturalUpdate(ready, 2), [0.99, 0.99]);
    expect(out.state.params.infrastructure).toBeCloseTo(s.params.infrastructure + BUILDINGS.road.effects.infrastructure);
    expect(out.state.buildings).toHaveLength(s.buildings.length);
  });
});

describe("イベント（v3.3 / Z-08, Z-09）", () => {
  const withEvent = (kind: "epidemic" | "famine" | "bandits", turns = 0): GameState => ({
    ...base(),
    event: { kind, turns, startedTurn: 1 },
    eventCooldown: 0,
  });

  it("解決する勅令（側近の歪み後の発注・政策）で収まり、幸福が戻る", () => {
    const s = withEvent("bandits");
    const out = executeDecree(s, intentOf({ action: "reform", target: "security_policy", magnitude: 30 }), 1);
    expect(out.eventNote).toEqual({ kind: "resolved", event: "bandits" });
    expect(out.state.event).toBeNull();
    expect(out.state.params.happiness).toBe(s.params.happiness + EVENT_RESOLVE_HAPPINESS);
    const unrelated = executeDecree(s, intentOf({ target: "market" }), 1);
    expect(unrelated.eventNote).toBeNull();
    expect(unrelated.state.event).not.toBeNull();
  });

  it("前提未達で発注できなければ解決しない", () => {
    const s = withEvent("famine");
    const out = executeDecree({ ...s, params: { ...s.params, treasury: 0 } }, intentOf({ target: "granary" }), 1);
    expect(out.eventNote).toBeNull();
    expect(out.state.event).not.toBeNull();
  });

  it("最長年数で後遺症を残して終わる", () => {
    const s = withEvent("bandits", EVENT_MAX_TURNS - 1);
    const out = run(naturalUpdate(s, 2));
    expect(out.events).toEqual([{ kind: "expired", event: "bandits" }]);
    expect(out.state.event).toBeNull();
  });

  it("冷却期間中は起きない、明けたら乱数で起きる", () => {
    expect(run(naturalUpdate(base(), 2), [0, 0, 0, 0]).events).toEqual([]);
    const ready: GameState = { ...base(), eventCooldown: 0 };
    // 劣化判定 0.99 → 疫病の判定 0 で発生
    const out = run(naturalUpdate(ready, 2), [0.99, 0]);
    expect(out.events).toEqual([{ kind: "started", event: "epidemic" }]);
  });
});

describe("自然変化と clamp", () => {
  it("同じ乱数列なら同じ結果（決定論）", () => {
    const s = executeDecree(base(), intentOf({ target: "market", magnitude: 70 }), 1).state;
    const values = [0.3, 0.7, 0.1, 0.9, 0.5];
    expect(run(naturalUpdate(s, 2), values)).toEqual(run(naturalUpdate(s, 2), values));
  });

  it("clamp：幸福・インフラ・汚職は [0,100]、人口は0以上の整数、国庫はそのまま", () => {
    expect(clampParams({ population: -3.5, treasury: -20, happiness: 120, infrastructure: -1, corruption: 101 })).toEqual({
      population: 0,
      treasury: -20,
      happiness: 100,
      infrastructure: 0,
      corruption: 100,
    });
  });
});
