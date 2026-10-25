// ヘッドレスシミュレーション（CLAUDE.md §7 / A-02 / BALANCE §27, §28）。
// 使い方: npm run sim -- [ゲーム数]
// LLM はモック：Bot が決めた DecreeIntent をそのまま「参謀の出力」として返し、検証・歪み・ルールエンジン・新聞は本番と同じ経路を通す。

import { Effect, Layer } from "effect";
import { BUILDING_IDS, BUILDINGS, TARGETS, type BuildingId, type Target } from "../src/domain/Buildings";
import {
  HEURISTIC_NOISE,
  MAX_TURNS,
  PEOPLE_PER_FOOD,
  SIM_GAMES,
  SIM_RANDOM_MAGNITUDE_MAX,
  SIM_RANDOM_MAGNITUDE_MIN,
  SIM_RANDOM_NEGATIVE_CHANCE,
  SUCCESS_INFRASTRUCTURE,
} from "../src/domain/constants";
import type { EventKind } from "../src/domain/Events";
import type { GameState } from "../src/domain/GameState";
import { deriveSeed } from "../src/domain/Prng";
import { defaultActionFor, type Action } from "../src/domain/Vocabulary";
import { derivedOf } from "../src/engine/DerivedCalculator";
import { newGame, playTurn } from "../src/engine/TurnMachine";
import { LLMServiceMock } from "../src/services/LLMService";
import { LogServiceSilent } from "../src/services/LogService";
import { makeRng, RngLive, type RngShape } from "../src/services/Rng";
import { SaveServiceInMemory } from "../src/services/SaveService";

interface BotIntent {
  readonly action: Action;
  readonly target: Target;
  readonly magnitude: number;
}

type Policy = (state: GameState, rng: RngShape) => Effect.Effect<BotIntent>;

const BOT_SEED_SALT = 7919;
const DECREE = { text: "sim", tags: [] } as const;

const intentFor = (target: Target, magnitude: number): BotIntent => ({ action: defaultActionFor(target), target, magnitude });

// --- 方策 ---

/** ランダム勅令：20種から一様に選び、規模も一様（参考値。合否に使わない） */
const randomPolicy: Policy = (_state, rng) =>
  Effect.gen(function* () {
    const target = TARGETS[Math.floor((yield* rng.next) * TARGETS.length)] ?? "road";
    const size = SIM_RANDOM_MAGNITUDE_MIN + (SIM_RANDOM_MAGNITUDE_MAX - SIM_RANDOM_MAGNITUDE_MIN) * (yield* rng.next);
    const sign = (yield* rng.next) < SIM_RANDOM_NEGATIVE_CHANCE ? -1 : 1;
    return intentFor(target, sign * size);
  });

/** BALANCE §27 のヒューリスティック（真の状態を見る優先順位ルール）。しきい値は方策の定義そのもの */
const HEURISTIC = {
  lowHappiness: 45,
  foodMargin: 1.2,
  roadFirstPopulation: 180,
  targetInfrastructure: SUCCESS_INFRASTRUCTURE + 2,
  officePopulation: 150,
  officeTreasury: 320,
  housingMargin: 1.2,
  lowSanitation: 4,
  lowSecurity: 4,
  lowTreasury: 150,
  highCorruption: 20,
} as const;

const EVENT_RESPONSE: Readonly<Record<EventKind, readonly [BuildingId, number]>> = {
  epidemic: ["well", 20],
  famine: ["farm", 30],
  bandits: ["watchtower", 20],
};

const queued = (state: GameState, kind: BuildingId): number =>
  state.projects.filter((p) => p.kind === kind && !p.repair).reduce((sum, p) => sum + p.count, 0);
const has = (state: GameState, kind: BuildingId): boolean => state.buildings.some((b) => b.kind === kind);
const functional = (state: GameState, kind: BuildingId): boolean => state.buildings.some((b) => b.kind === kind && !b.hollow);

const heuristicCore = (state: GameState): BotIntent => {
  const p = state.params;
  const d = derivedOf(state);
  const h = HEURISTIC;
  if (state.event !== null) {
    const [kind, magnitude] = EVENT_RESPONSE[state.event.kind];
    return intentFor(kind, magnitude);
  }
  if (p.happiness < h.lowHappiness) return intentFor("welfare_policy", 40);
  if (d.food + BUILDINGS.farm.effects.food * queued(state, "farm") < (p.population / PEOPLE_PER_FOOD) * h.foodMargin) {
    return intentFor("farm", 40);
  }
  const plannedInfra = p.infrastructure + BUILDINGS.road.effects.infrastructure * queued(state, "road");
  if (p.population >= h.roadFirstPopulation && plannedInfra < h.targetInfrastructure) return intentFor("road", 70);
  const officeReady = !has(state, "office") && queued(state, "office") === 0 && p.population >= h.officePopulation && p.treasury >= h.officeTreasury;
  if (officeReady) return intentFor("office", 30);
  if (d.housingCapacity + BUILDINGS.residential.effects.capacity * queued(state, "residential") < p.population * h.housingMargin) {
    return intentFor("residential", 50);
  }
  if (d.sanitation < h.lowSanitation && queued(state, "well") === 0) return intentFor("well", 20);
  if (d.security < h.lowSecurity && queued(state, "watchtower") === 0) return intentFor("watchtower", 20);
  if (p.treasury < h.lowTreasury) return intentFor("tax_rate", 30);
  if (plannedInfra < h.targetInfrastructure) return intentFor("road", 50);
  if (p.corruption > h.highCorruption && functional(state, "office")) return intentFor("courthouse", 20);
  return intentFor("market", 20);
};

const heuristicPolicy: Policy = (state, rng) =>
  Effect.flatMap(rng.next, (roll) => (roll < HEURISTIC_NOISE ? randomPolicy(state, rng) : Effect.succeed(heuristicCore(state))));

const cleanHeuristicPolicy: Policy = (state) => Effect.succeed(heuristicCore(state));

// --- 1ゲーム ---

interface GameResult {
  readonly outcome: string;
  readonly turns: number;
  readonly orders: Readonly<Partial<Record<BuildingId, number>>>;
  readonly articles: number;
  readonly negativeCandidates: number;
  readonly censored: number;
  readonly praised: number;
  readonly eventsStarted: number;
  readonly eventsResolved: number;
  readonly hollow: number;
  readonly maxOverload: number;
}

const playGame = (seed: number, policy: Policy): Promise<GameResult> => {
  let pending: BotIntent = intentFor("road", 0);
  const llm = LLMServiceMock(() => Effect.sync(() => ({ ...pending, budget: 0, confidence: 1 })));
  const layer = Layer.mergeAll(llm, LogServiceSilent, SaveServiceInMemory, RngLive(seed));
  const program = Effect.gen(function* () {
    const botRng = yield* makeRng(deriveSeed(seed, BOT_SEED_SALT));
    let state = newGame(seed);
    while (state.ending === null && state.turn <= MAX_TURNS) {
      pending = yield* policy(state, botRng);
      state = yield* playTurn(state, DECREE, null);
    }
    const ending = state.ending;
    const outcome = ending === null ? "unfinished" : ending.kind === "gameover" ? `gameover:${ending.reason}` : ending.kind;
    const orders: Partial<Record<BuildingId, number>> = {};
    let articles = 0;
    let censored = 0;
    let praised = 0;
    let started = 0;
    let resolved = 0;
    let hollow = 0;
    let maxOverload = 0;
    for (const r of state.history) {
      for (const note of r.execution.notes) if (note.kind === "ordered" && !note.repair) orders[note.building] = (orders[note.building] ?? 0) + 1;
      articles += r.newspaper.articles.length;
      censored += r.newspaper.stats.censoredIds.length;
      praised += r.newspaper.stats.praisedIds.length;
      started += r.events.filter((e) => e.kind === "started").length;
      resolved += r.events.filter((e) => e.kind === "resolved").length;
      hollow += r.construction.completions.reduce((sum, c) => sum + c.hollowCount, 0);
      maxOverload = Math.max(maxOverload, r.construction.overload);
    }
    return {
      outcome,
      turns: state.turn - 1,
      orders,
      articles,
      negativeCandidates: articles + censored,
      censored,
      praised,
      eventsStarted: started,
      eventsResolved: resolved,
      hollow,
      maxOverload,
    };
  });
  return Effect.runPromise(program.pipe(Effect.provide(layer)));
};

// --- 集計 ---

const pct = (n: number, total: number) => (total === 0 ? "-" : `${((n / total) * 100).toFixed(1)}%`);

/** 建物の利用エントロピー（発注した建物の分布のシャノンエントロピーを log2(17) で正規化。1 に近いほど偏りがない） */
const usageEntropy = (orders: Readonly<Partial<Record<BuildingId, number>>>): number => {
  const total = BUILDING_IDS.reduce((sum, id) => sum + (orders[id] ?? 0), 0);
  if (total === 0) return 0;
  const h = BUILDING_IDS.reduce((sum, id) => {
    const q = (orders[id] ?? 0) / total;
    return q > 0 ? sum - q * Math.log2(q) : sum;
  }, 0);
  return h / Math.log2(BUILDING_IDS.length);
};

const runPolicy = async (name: string, policy: Policy, games: number) => {
  const counts = new Map<string, number>();
  const orders: Partial<Record<BuildingId, number>> = {};
  let turnSum = 0;
  let successTurnSum = 0;
  let articles = 0;
  let candidates = 0;
  let censored = 0;
  let praised = 0;
  let started = 0;
  let resolved = 0;
  let hollow = 0;
  let overloadSum = 0;
  for (let seed = 1; seed <= games; seed++) {
    const r = await playGame(seed, policy);
    counts.set(r.outcome, (counts.get(r.outcome) ?? 0) + 1);
    turnSum += r.turns;
    if (r.outcome === "success") successTurnSum += r.turns;
    for (const [id, n] of Object.entries(r.orders) as [BuildingId, number][]) orders[id] = (orders[id] ?? 0) + n;
    articles += r.articles;
    candidates += r.negativeCandidates;
    censored += r.censored;
    praised += r.praised;
    started += r.eventsStarted;
    resolved += r.eventsResolved;
    hollow += r.hollow;
    overloadSum += r.maxOverload;
  }
  const success = counts.get("success") ?? 0;
  const gameover = [...counts].filter(([k]) => k.startsWith("gameover")).reduce((sum, [, v]) => sum + v, 0);
  const timeout = counts.get("timeout") ?? 0;
  const breakdown = [...counts]
    .filter(([k]) => k.startsWith("gameover"))
    .sort()
    .map(([k, v]) => `${k.replace("gameover:", "")} ${pct(v, games)}`)
    .join(" / ");
  return {
    name,
    games,
    success,
    gameover,
    timeout,
    breakdown,
    avgTurns: turnSum / games,
    avgSuccessTurns: success ? successTurnSum / success : 0,
    entropy: usageEntropy(orders),
    orders,
    censorRate: censored / Math.max(1, candidates),
    praiseRate: praised / Math.max(1, articles),
    articlesPerTurn: articles / Math.max(1, turnSum),
    eventsPerGame: started / games,
    resolveRate: resolved / Math.max(1, started),
    hollowPerGame: hollow / games,
    maxOverload: overloadSum / games,
  };
};

const TARGET_SUCCESS = [0.7, 0.9] as const;
const TARGET_GAMEOVER = [0.2, 0.4] as const;
/** v3.2 の指示にあった目安（参考。承認済みの A-02 と食い違うため合否には使わない。DECISIONS I-21） */
const REFERENCE_SUCCESS = [0.3, 0.5] as const;
const within = (value: number, [min, max]: readonly [number, number]) => value >= min && value <= max;

const main = async () => {
  const games = Number(process.argv[2] ?? SIM_GAMES);
  const rows = [
    await runPolicy("heuristic", heuristicPolicy, games),
    await runPolicy("heuristic-clean", cleanHeuristicPolicy, games),
    await runPolicy("random", randomPolicy, games),
  ];
  console.log(`games per policy: ${games}`);
  console.log("| policy | success | gameover | timeout | gameover breakdown | avg turns | avg turns (success) |");
  console.log("|---|---|---|---|---|---|---|");
  for (const r of rows) {
    console.log(
      `| ${r.name} | ${pct(r.success, r.games)} | ${pct(r.gameover, r.games)} | ${pct(r.timeout, r.games)} | ${r.breakdown || "-"} | ${r.avgTurns.toFixed(1)} | ${r.avgSuccessTurns.toFixed(1)} |`,
    );
  }
  console.log("");
  console.log("| policy | building entropy | censored (deleted) | praised | articles/turn | events/game | resolved | hollow/game | max overload |");
  console.log("|---|---|---|---|---|---|---|---|---|");
  for (const r of rows) {
    console.log(
      `| ${r.name} | ${r.entropy.toFixed(2)} | ${pct(r.censorRate, 1)} | ${pct(r.praiseRate, 1)} | ${r.articlesPerTurn.toFixed(2)} | ${r.eventsPerGame.toFixed(1)} | ${pct(r.resolveRate, 1)} | ${r.hollowPerGame.toFixed(1)} | ${r.maxOverload.toFixed(2)} |`,
    );
  }
  console.log("");
  for (const r of rows) {
    const usage = BUILDING_IDS.map((id) => `${id} ${r.orders[id] ?? 0}`).join(", ");
    console.log(`orders (${r.name}): ${usage}`);
  }
  const main = rows[0];
  if (main) {
    const s = main.success / main.games;
    const g = main.gameover / main.games;
    // 合否は到達率だけ。ゲームオーバー率は人間のプレイ（P4）で測る（DECISIONS P-08 / W-15、CLAUDE.md §7）
    console.log(`A-02 gate (heuristic success 70-90%): ${within(s, TARGET_SUCCESS) ? "PASS" : "FAIL"}`);
    console.log(`  gameover 20-40% (reference, measured in P4): ${within(g, TARGET_GAMEOVER) ? "in range" : "out of range"}`);
    console.log(`  v3.2 prompt reference (success 30-50%): ${within(s, REFERENCE_SUCCESS) ? "in range" : "out of range"}`);
  }
};

void main();
