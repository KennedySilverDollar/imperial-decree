// 地図の確認用に、本番と同じ経路（モックの参謀 → 検証 → 側近の歪み → ルールエンジン）でゲームを数年進め、
// その時点の GameState を JSON で書き出す（開発用。scripts/map-browser.mjs が読む）。
// 使い方: npx tsx scripts/map-states.ts <出力ファイル> [シード,...] [年数,...]
import { writeFileSync } from "node:fs";
import { Effect, Layer } from "effect";
import type { Target } from "../src/domain/Buildings";
import type { GameState } from "../src/domain/GameState";
import { defaultActionFor } from "../src/domain/Vocabulary";
import { newGame, playTurn } from "../src/engine/TurnMachine";
import { LLMServiceMock } from "../src/services/LLMService";
import { LogServiceSilent } from "../src/services/LogService";
import { RngLive } from "../src/services/Rng";
import { SaveServiceInMemory } from "../src/services/SaveService";

/** 村が育つように、住まい・畑・道・市場などを順に発注する（地図の見た目を確かめるための簡単な手順。バランスの方策ではない） */
const PLAN: readonly Target[] = [
  "residential", "farm", "road", "residential", "well", "farm", "market", "road", "residential", "granary",
  "farm", "office", "road", "residential", "workshop", "tenement", "farm", "school", "road", "temple",
  "residential", "clinic", "watchtower", "courthouse", "farm", "road", "residential", "manor", "taxoffice", "jail",
];
const DECREE = { text: "map", tags: [] } as const;

const [out = "map-states.json", seedsArg = "1,2,3", yearsArg = "8,20"] = process.argv.slice(2);
const seeds = seedsArg.split(",").map(Number);
const years = yearsArg.split(",").map(Number);
const maxYear = Math.max(...years);

const play = (seed: number): Promise<{ year: number; state: GameState }[]> => {
  let next: Target = "road";
  const llm = LLMServiceMock(() => Effect.sync(() => ({ action: defaultActionFor(next), target: next, magnitude: 60, budget: 0, confidence: 1 })));
  const layer = Layer.mergeAll(llm, LogServiceSilent, SaveServiceInMemory, RngLive(seed));
  return Effect.runPromise(
    Effect.gen(function* () {
      let state = newGame(seed);
      const snaps: { year: number; state: GameState }[] = [];
      for (let year = 1; year <= maxYear && state.ending === null; year++) {
        next = PLAN[(year - 1) % PLAN.length] ?? "road";
        state = yield* playTurn(state, DECREE, null);
        if (years.includes(year)) snaps.push({ year, state });
      }
      return snaps;
    }).pipe(Effect.provide(layer)),
  );
};

const rows: { label: string; state: GameState }[] = [];
for (const seed of seeds) {
  for (const { year, state } of await play(seed)) {
    rows.push({ label: `${state.saveId}-y${year}`, state });
    const built = state.buildings.filter((b) => b.tile).length;
    console.log(`${state.saveId} ${year}年目: 建物 ${built}・普請中 ${state.projects.length}・インフラ ${state.params.infrastructure}・空洞 ${state.buildings.filter((b) => b.hollow).length}`);
  }
}
writeFileSync(out, JSON.stringify(rows));
