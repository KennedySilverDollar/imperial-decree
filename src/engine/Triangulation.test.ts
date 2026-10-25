import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { newProject } from "../domain/Construction";
import type { GameState } from "../domain/GameState";
import { fixedLLMLayer } from "../test/fixtures";
import { mapOf } from "./MapUpdater";
import { newGame, playTurn } from "./TurnMachine";

// 三角測量（v3.2 §1.8）：倉庫が空洞のとき、投書が匂わせ、能力の高い側近は言及し（野心の高い側近は隠すこともある）、地図は変わらない。

/** 今年のうちに完成する倉庫の普請を抱えた状態（資材の手抜きで空洞化の確率は 0.9） */
const withShoddyGranary = (seed: number): GameState => {
  const state = newGame(seed);
  const project = newProject(1, "granary", 1, 1, { repair: false, repairSerials: [], tiles: [[0, 0]], waterDown: false, costRatio: 1 });
  return { ...state, projects: [{ ...project, progress: project.work, elapsed: project.minTurns, worstShortage: 1 }], nextProjectId: 2 };
};

const play = (state: GameState) =>
  Effect.runPromise(playTurn(state, { text: "井戸を掘れ", tags: [] }, null).pipe(Effect.provide(fixedLLMLayer({ target: "well", magnitude: 10 }, state.seed))));

describe("三角測量：空洞の倉庫", () => {
  it("投書（N-16）・能力の高い側近の報告・変わらない地図が同じ年にそろう", async () => {
    const outcomes = [];
    for (let seed = 1; seed <= 30; seed++) {
      const before = withShoddyGranary(seed);
      const after = await play(before);
      const record = after.history.at(-1);
      if (!record || record.construction.completions[0]?.hollowCount !== 1) continue;
      const letter = record.newspaper.articles.some((a) => a.id === "N-16" && a.section === "letters");
      const merchant = record.aideReports.find((r) => r.aideId === "youngMerchant");
      const steward = record.aideReports.find((r) => r.aideId === "elderSteward");
      const mentioned = merchant?.notes.some((n) => n.kind === "hollowDisclosed" && n.building === "granary") ?? false;
      // 能力60の代官は空洞に気づかない
      expect(steward?.notes.some((n) => n.kind === "hollowDisclosed")).toBe(false);
      // 地図：倉庫の区画は普通の倉庫として描かれる
      const tile = mapOf(after).tiles[0]?.[0];
      expect(tile).toMatchObject({ kind: "building", building: "granary" });
      const solid = { ...after, buildings: after.buildings.map((b) => ({ ...b, hollow: false, disclosed: false })) };
      expect(mapOf(after)).toEqual(mapOf(solid));
      outcomes.push({ seed, letter, mentioned, concealed: merchant?.concealed ?? false });
    }
    expect(outcomes.length).toBeGreaterThan(10);
    // 全部そろう年がある
    expect(outcomes.some((o) => o.letter && o.mentioned)).toBe(true);
    // 野心の高い商人が隠した年は、側近報告に出ない（投書だけが手がかり）
    for (const o of outcomes) if (o.concealed) expect(o.mentioned).toBe(false);
    expect(outcomes.some((o) => o.concealed && o.letter)).toBe(true);
    // 投書は検閲で消えることもあるが、たいていは載る
    expect(outcomes.filter((o) => o.letter).length / outcomes.length).toBeGreaterThan(0.6);
  });
});
