import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { TEMPLATES } from "../content/newspaper/ja";
import { kanjiNumber } from "../content/toponyms/ja";
import { GRID_SIZE } from "../domain/constants";
import { createInitialState, type GameState } from "../domain/GameState";
import { FEATURE_KINDS, landscapePlan, SIDES, terrainSeed, zoneFeature, zoneOf, ZONES } from "../domain/Landscape";
import { derivedOf } from "./DerivedCalculator";
import { buildGazetteer, gazetteerFor, newspaperPlaces } from "./Gazetteer";
import { generateNewspaper, type NewsContext } from "./NewspaperGenerator";

// 地名（SPEC_v3.3 §5.5・§13.1 / 不変条件20）

const SAVE_IDS = Array.from({ length: 200 }, (_, i) => `save-${i}-${(i * 7919).toString(36)}`);

describe("土地の筋書き", () => {
  it("同じ saveId なら同じ筋書き。川・丘・森は必ず1辺ずつ、残る1辺は沼か野", () => {
    for (const id of SAVE_IDS) {
      const plan = landscapePlan(terrainSeed(id));
      expect(landscapePlan(terrainSeed(id))).toEqual(plan);
      const kinds = SIDES.map((s) => plan.sides[s]).sort();
      expect(kinds.filter((k) => k === "river")).toHaveLength(1);
      expect(kinds.filter((k) => k === "hill")).toHaveLength(1);
      expect(kinds.filter((k) => k === "forest")).toHaveLength(1);
      expect(kinds.filter((k) => k === "lake" || k === "plain")).toHaveLength(1);
    }
  });

  it("沼のある領地と無い領地の両方が出る（0〜1個）", () => {
    const lakes = SAVE_IDS.map((id) => SIDES.some((s) => landscapePlan(terrainSeed(id)).sides[s] === "lake"));
    expect(lakes.some(Boolean)).toBe(true);
    expect(lakes.some((x) => !x)).toBe(true);
  });

  it("区域：角は2辺、辺は1辺、中は地形なし。100区画が9区域に分かれる", () => {
    const plan = landscapePlan(terrainSeed("x"));
    expect(zoneFeature(plan, "center")).toBeNull();
    const counts = new Map<string, number>();
    for (let y = 0; y < GRID_SIZE; y++) for (let x = 0; x < GRID_SIZE; x++) counts.set(zoneOf(x, y), (counts.get(zoneOf(x, y)) ?? 0) + 1);
    expect([...counts.values()].reduce((a, b) => a + b, 0)).toBe(100);
    expect(counts.get("center")).toBe(16);
    expect(counts.get("northwest")).toBe(9);
    expect(counts.get("north")).toBe(12);
  });
});

describe("地名一覧", () => {
  it("どの saveId でも地名は一意（同じ区画名の重複なし）で、区画名は100個", () => {
    for (const id of SAVE_IDS) {
      const g = gazetteerFor(id);
      const names = g.all.map((t) => t.name);
      expect(new Set(names).size, id).toBe(names.length);
      expect(g.parcels).toHaveLength(GRID_SIZE * GRID_SIZE);
      expect(new Set(g.parcels).size).toBe(100);
      for (const z of ZONES) expect(g.zones[z]).not.toBe("");
    }
  });

  it("区域の名は、その区域が接する辺の地形の名を含む（川沿い・丘の麓…）", () => {
    for (const id of SAVE_IDS.slice(0, 40)) {
      const g = gazetteerFor(id);
      for (const zone of ZONES) {
        const feature = zoneFeature(g.plan, zone);
        if (feature === null) continue;
        expect(g.zones[zone]).toContain(g.features[feature] ?? "?");
      }
    }
  });

  it("地図にある地形だけに名がある（沼か野のどちらか一方）", () => {
    for (const id of SAVE_IDS.slice(0, 40)) {
      const g = gazetteerFor(id);
      const present = new Set(SIDES.map((s) => g.plan.sides[s]));
      for (const f of FEATURE_KINDS) expect(g.features[f] !== null).toBe(present.has(f));
    }
  });

  it("区画名は「区域の名＋番号」。番号は区域の中で 1 から", () => {
    const g = buildGazetteer(landscapePlan(terrainSeed("abc")));
    expect(g.parcels[0]).toBe(`${g.zones.northwest} ${kanjiNumber(1)}番`);
    expect(kanjiNumber(16)).toBe("十六");
    expect(kanjiNumber(20)).toBe("二十");
  });
});

describe("新聞の {place} は地名一覧から埋まる", () => {
  const contextOf = (state: GameState, turn: number): NewsContext => ({
    turn,
    saveId: state.saveId,
    before: state.params,
    after: { ...state.params, population: state.params.population + 15 },
    derived: derivedOf(state),
    buildings: state.buildings,
    projects: state.projects,
    completed: ["residential", "market", "watchtower"],
    aides: state.aides,
    event: { kind: "bandits", turns: 0, startedTurn: turn - 1 },
    materialShortage: 0,
    overload: 0,
    taxRevenue: 150,
    previousTaxRevenue: 140,
    state: state.newspaperState,
  });

  it("{place} を持つ記事には、その領地の区域の名が書かれ、古い固定の語は出ない", () => {
    const placeTypes = new Set(TEMPLATES.filter((t) => t.slots.includes("place")).map((t) => t.type));
    let checked = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const state = createInitialState(seed);
      const places = newspaperPlaces(state.saveId);
      for (let turn = 2; turn <= 8; turn++) {
        const { newspaper } = Effect.runSync(generateNewspaper(contextOf(state, turn)));
        for (const a of newspaper.articles) {
          const variants = TEMPLATES.filter((t) => t.type === a.id);
          if (!variants.every((t) => t.slots.includes("place")) || !placeTypes.has(a.id)) continue;
          const text = [a.headline, ...a.body].join("");
          expect(places.some((p) => text.includes(p)), `${a.id}: ${text}`).toBe(true);
          expect(text).not.toMatch(/北の空き地|南の畑沿い|渡し場の近く/);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("地名一覧は新聞を作る前に saveId だけで決まり、同じ saveId・年・状態なら同じ紙面", () => {
    const state = createInitialState(11);
    expect(newspaperPlaces(state.saveId)).toEqual(newspaperPlaces(state.saveId));
    const a = Effect.runSync(generateNewspaper(contextOf(state, 4)));
    const b = Effect.runSync(generateNewspaper(contextOf(state, 4)));
    expect(b).toEqual(a);
  });
});
