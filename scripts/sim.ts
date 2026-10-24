// ヘッドレスシミュレーション（CLAUDE.md §7 / A-02 / BALANCE §9）。
// 使い方: npm run sim -- [ゲーム数]
// LLM はモック：Bot が決めた DecreeIntent をそのまま「参謀の出力」として返し、検証・歪み・ルールエンジンは本番と同じ経路を通す。

import { Effect, Layer } from "effect";
import {
  HEURISTIC_NOISE,
  MAX_TURNS,
  OFFICE_COST,
  OFFICE_MIN_INFRASTRUCTURE,
  OFFICE_MIN_POPULATION,
  SIM_GAMES,
  SIM_RANDOM_MAGNITUDE_MAX,
  SIM_RANDOM_MAGNITUDE_MIN,
  SIM_RANDOM_NEGATIVE_CHANCE,
  SUCCESS_INFRASTRUCTURE,
} from "../src/domain/constants";
import type { GameState } from "../src/domain/GameState";
import { deriveSeed } from "../src/domain/Prng";
import { SWAPPABLE_TARGETS, type Action, type Target } from "../src/domain/Vocabulary";
import { housingCapacity } from "../src/engine/RuleEngine";
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

// --- 方策 ---

const RANDOM_ACTIONS: readonly Action[] = ["build", "tax", "invest", "reform"];

const randomPolicy: Policy = (_state, rng) =>
  Effect.gen(function* () {
    const action = RANDOM_ACTIONS[Math.floor((yield* rng.next) * RANDOM_ACTIONS.length)] ?? "build";
    const targets: readonly Target[] = action === "tax" ? ["tax"] : SWAPPABLE_TARGETS[action];
    const target = targets[Math.floor((yield* rng.next) * targets.length)] ?? "road";
    const size = SIM_RANDOM_MAGNITUDE_MIN + (SIM_RANDOM_MAGNITUDE_MAX - SIM_RANDOM_MAGNITUDE_MIN) * (yield* rng.next);
    const sign = (yield* rng.next) < SIM_RANDOM_NEGATIVE_CHANCE ? -1 : 1;
    return { action, target, magnitude: sign * size };
  });

/** BALANCE §9 のヒューリスティック（真の状態を見る優先順位ルール）。しきい値は方策の定義そのもの */
const HEURISTIC = {
  lowHappiness: 45,
  lowTreasury: 150,
  crowdedRatio: 0.9,
  targetInfrastructure: SUCCESS_INFRASTRUCTURE + 1,
  highCorruption: 20,
  welfareMagnitude: 40,
  officeMagnitude: 50,
  levyMagnitude: 30,
  residentialMagnitude: 40,
  roadMagnitude: 40,
  securityMagnitude: 40,
  wellMagnitude: 30,
} as const;

const heuristicCore = (state: GameState): BotIntent => {
  const p = state.params;
  const f = state.facilities;
  if (p.happiness < HEURISTIC.lowHappiness) return { action: "invest", target: "welfare", magnitude: HEURISTIC.welfareMagnitude };
  if (!f.officeBuilt && p.population >= OFFICE_MIN_POPULATION && p.infrastructure >= OFFICE_MIN_INFRASTRUCTURE && p.treasury >= OFFICE_COST) {
    return { action: "build", target: "office", magnitude: HEURISTIC.officeMagnitude };
  }
  if (p.treasury < HEURISTIC.lowTreasury) return { action: "tax", target: "tax", magnitude: HEURISTIC.levyMagnitude };
  if (p.population > housingCapacity(f) * HEURISTIC.crowdedRatio) {
    return { action: "build", target: "residential", magnitude: HEURISTIC.residentialMagnitude };
  }
  if (p.infrastructure < HEURISTIC.targetInfrastructure) return { action: "build", target: "road", magnitude: HEURISTIC.roadMagnitude };
  if (p.corruption > HEURISTIC.highCorruption) return { action: "reform", target: "security", magnitude: HEURISTIC.securityMagnitude };
  return { action: "invest", target: "well", magnitude: HEURISTIC.wellMagnitude };
};

const heuristicPolicy: Policy = (state, rng) =>
  Effect.flatMap(rng.next, (roll) => (roll < HEURISTIC_NOISE ? randomPolicy(state, rng) : Effect.succeed(heuristicCore(state))));

const cleanHeuristicPolicy: Policy = (state) => Effect.succeed(heuristicCore(state));

// --- 1ゲーム ---

interface GameResult {
  readonly outcome: string;
  readonly turns: number;
}

const playGame = (seed: number, policy: Policy): Promise<GameResult> => {
  let pending: BotIntent = { action: "build", target: "road", magnitude: 0 };
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
    return { outcome, turns: state.turn - 1 };
  });
  return Effect.runPromise(program.pipe(Effect.provide(layer)));
};

// --- 集計 ---

const pct = (n: number, total: number) => `${((n / total) * 100).toFixed(1)}%`;

const runPolicy = async (name: string, policy: Policy, games: number) => {
  const counts = new Map<string, number>();
  let turnSum = 0;
  let successTurnSum = 0;
  for (let seed = 1; seed <= games; seed++) {
    const result = await playGame(seed, policy);
    counts.set(result.outcome, (counts.get(result.outcome) ?? 0) + 1);
    turnSum += result.turns;
    if (result.outcome === "success") successTurnSum += result.turns;
  }
  const success = counts.get("success") ?? 0;
  const gameover = [...counts].filter(([k]) => k.startsWith("gameover")).reduce((sum, [, v]) => sum + v, 0);
  const timeout = counts.get("timeout") ?? 0;
  const breakdown = [...counts]
    .filter(([k]) => k.startsWith("gameover"))
    .sort()
    .map(([k, v]) => `${k.replace("gameover:", "")} ${pct(v, games)}`)
    .join(" / ");
  return { name, games, success, gameover, timeout, breakdown, avgTurns: turnSum / games, avgSuccessTurns: success ? successTurnSum / success : 0 };
};

const TARGET_SUCCESS = [0.7, 0.9] as const;
const TARGET_GAMEOVER = [0.2, 0.4] as const;
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
  const main = rows[0];
  if (main) {
    const ok = within(main.success / main.games, TARGET_SUCCESS) && within(main.gameover / main.games, TARGET_GAMEOVER);
    console.log(`A-02 target (heuristic success 70-90%, gameover 20-40%): ${ok ? "PASS" : "FAIL"}`);
  }
};

void main();
