import { Cause, Effect, Exit } from "effect";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { TEMPLATES } from "../content/newspaper/ja";
import { NEWSPAPER_MAX_ARTICLES, NEWSPAPER_MIN_ARTICLES } from "../domain/constants";
import { createInitialState, type GameState, type Params } from "../domain/GameState";
import { SLOT_NAMES } from "../domain/News";
import { derivedOf } from "./DerivedCalculator";
import { fillSlots, generateNewspaper, newspaperSeed, type NewsContext } from "./NewspaperGenerator";

// 新聞（v3.2 §1.5〜§1.10 / CLAUDE.md §4-12, §4-16）

const contextOf = (state: GameState, after: Partial<Params> = {}, turn = 5): NewsContext => ({
  turn,
  saveId: state.saveId,
  before: state.params,
  after: { ...state.params, ...after },
  derived: derivedOf(state),
  buildings: state.buildings,
  projects: state.projects,
  aides: state.aides,
  event: state.event,
  materialShortage: 0,
  overload: 0,
  taxRevenue: 150,
  previousTaxRevenue: 140,
  state: state.newspaperState,
});

const generate = (c: NewsContext) => Effect.runSync(generateNewspaper(c));
const PLACEHOLDER = /\{(\w+)\}/g;
const placeholders = (text: string) => [...text.matchAll(PLACEHOLDER)].map((m) => m[1]);

describe("スロット充填", () => {
  it("全テンプレートの文面のスロットは宣言済みで、既知のスロット名", () => {
    for (const t of TEMPLATES) {
      const texts = [t.headline, ...t.body, ...(t.praise ? [t.praise.headline, ...t.praise.body] : [])];
      for (const name of texts.flatMap(placeholders)) {
        expect(SLOT_NAMES).toContain(name);
        expect(t.slots, `${t.id} の {${name}}`).toContain(name);
      }
    }
  });

  it("値を埋め、値のないスロットは Effect.die", () => {
    expect(Effect.runSync(fillSlots("{place}で{num}人", { place: "東の丘", num: "120" }))).toBe("東の丘で120人");
    const exit = Effect.runSyncExit(fillSlots("{place}で{num}人", { place: "東の丘" }));
    expect(Exit.isFailure(exit) && Cause.isDie(exit.cause)).toBe(true);
  });

  it("生成された記事に未充填のスロットが残らない", () => {
    const paper = generate(contextOf(createInitialState(3), { population: 130 }));
    for (const a of paper.newspaper.articles) {
      expect(a.headline).not.toMatch(PLACEHOLDER);
      for (const line of a.body) expect(line).not.toMatch(PLACEHOLDER);
    }
  });
});

describe("決定論（seed = hash(saveId, turn)）", () => {
  it("同じ入力なら同じ紙面、ターンが違えば seed が変わる", () => {
    const c = contextOf(createInitialState(7), { population: 128, corruption: 35 });
    expect(generate(c)).toEqual(generate(c));
    expect(generate(c).newspaper.seed).toBe(newspaperSeed(c.saveId, c.turn));
    expect(newspaperSeed(c.saveId, 5)).not.toBe(newspaperSeed(c.saveId, 6));
  });
});

describe("偏向後の紙面（v3.2 §1.5）", () => {
  const paramsArb = fc.record({
    population: fc.integer({ min: 0, max: 600 }),
    happiness: fc.integer({ min: 0, max: 100 }),
    corruption: fc.integer({ min: 0, max: 100 }),
    treasury: fc.integer({ min: -50, max: 2000 }),
    infrastructure: fc.integer({ min: 0, max: 100 }),
  });

  it("どの状態・どの年でも5〜7本、本文は空でなく、truthfulness は 0..1", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1000 }), fc.integer({ min: 1, max: 50 }), paramsArb, (seed, turn, after) => {
        const paper = generate(contextOf(createInitialState(seed), after, turn)).newspaper;
        expect(paper.articles.length).toBeGreaterThanOrEqual(NEWSPAPER_MIN_ARTICLES);
        expect(paper.articles.length).toBeLessThanOrEqual(NEWSPAPER_MAX_ARTICLES);
        for (const a of paper.articles) {
          expect(a.headline.length).toBeGreaterThan(0);
          expect(a.body.length).toBeGreaterThan(0);
          for (const line of a.body) expect(line.trim().length).toBeGreaterThan(0);
          expect(a.truthfulness).toBeGreaterThanOrEqual(0);
          expect(a.truthfulness).toBeLessThanOrEqual(1);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("検閲で消えた記事は紙面に出ず、統計にだけ残る", () => {
    let censored = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const paper = generate(contextOf(createInitialState(seed), { population: 90, happiness: 20, corruption: 60 })).newspaper;
      for (const id of paper.stats.censoredIds) expect(paper.articles.some((a) => a.id === id && !a.isFollowUp)).toBe(false);
      censored += paper.stats.censoredIds.length;
    }
    expect(censored).toBeGreaterThan(0);
  });
});

describe("連載（v3.2 §1.7）", () => {
  it("連載が始まると状態に残り、翌年に続報が出る", () => {
    let state = { ...createInitialState(1), params: { ...createInitialState(1).params, corruption: 60 } };
    let followUp = false;
    for (let turn = 1; turn <= 8 && !followUp; turn++) {
      const result = generate({ ...contextOf(state, {}, turn), state: state.newspaperState });
      followUp = result.newspaper.articles.some((a) => a.isFollowUp);
      state = { ...state, newspaperState: result.state };
    }
    expect(followUp).toBe(true);
  });

  it("直近のテンプレートは3年分だけ保持する", () => {
    let state = createInitialState(2);
    for (let turn = 1; turn <= 10; turn++) {
      const result = generate({ ...contextOf(state, {}, turn), state: state.newspaperState });
      state = { ...state, newspaperState: result.state };
    }
    for (const entry of state.newspaperState.recentTemplates) expect(entry.turn).toBeGreaterThan(10 - 3);
  });
});
