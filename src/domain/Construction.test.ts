import { describe, expect, it } from "vitest";
import { BUILDINGS } from "./Buildings";
import { advanceConstruction, hollowChance, newProject, projectDemand, remainingTurns, type Project } from "./Construction";
import { HOLLOW_CHANCE_CAP, OVERLOAD_SEVERE, SHORTAGE_SEVERE } from "./constants";

// 工期・労働人口・秘匿資材（v3.3 / BALANCE §22〜§24）

const project = (id: number, kind: "well" | "granary" | "market" | "school", count = 1): Project =>
  newProject(id, kind, count, 1, { repair: false, repairSerials: [], tiles: [], waterDown: false, costRatio: 1 });
const plenty = { wood: 10_000, stone: 10_000 };

describe("労働の割り振り", () => {
  it("需要が労働人口以下なら全案件が最短工期のペースで進む", () => {
    const p = project(1, "granary");
    const step = advanceConstruction([p], projectDemand(p) * 2, plenty);
    expect(step.projects[0]?.progress ?? step.finished[0]?.progress).toBeCloseTo(projectDemand(p));
    expect(step.overload).toBeCloseTo(0.5);
    expect(step.corruptionIncrease).toBe(0);
  });

  it("超えたら全案件を同じ割合で遅らせる（バランスよく）", () => {
    const a = project(1, "granary");
    const b = project(2, "market");
    const total = projectDemand(a) + projectDemand(b);
    const step = advanceConstruction([a, b], total / 2, plenty);
    const [pa, pb] = step.projects;
    expect((pa?.progress ?? 0) / projectDemand(a)).toBeCloseTo(0.5);
    expect((pb?.progress ?? 0) / projectDemand(b)).toBeCloseTo(0.5);
  });

  it("最短工期より早くは終わらず、労働が足りなければ見込みが延びる", () => {
    const p = project(1, "school");
    expect(remainingTurns(p, projectDemand(p))).toBe(BUILDINGS.school.recipe.minTurns);
    expect(remainingTurns(p, projectDemand(p) / 2)).toBeGreaterThan(BUILDINGS.school.recipe.minTurns);
    expect(remainingTurns(p, 0)).toBe(Number.POSITIVE_INFINITY);
  });

  it("無理な命令（需要/労働 > 1.5）は汚職を生み、空洞化しやすくなる", () => {
    const p = project(1, "granary", 3);
    const labor = projectDemand(p) / (OVERLOAD_SEVERE + 1);
    const step = advanceConstruction([p], labor, plenty);
    expect(step.overload).toBeCloseTo(OVERLOAD_SEVERE + 1);
    expect(step.corruptionIncrease).toBeGreaterThan(0);
    const after = step.projects[0];
    if (!after) throw new Error("案件が消えた");
    expect(hollowChance(after, 0)).toBeGreaterThan(hollowChance(p, 0));
  });
});

describe("資材（秘匿）", () => {
  it("少しの不足は待ち（遅れる）で、手抜きにはならない", () => {
    const p = project(1, "market");
    const needWood = (p.wood * projectDemand(p)) / p.work;
    const step = advanceConstruction([p], 1000, { wood: needWood * (1 - SHORTAGE_SEVERE / 2), stone: 10_000 });
    expect(step.shortage).toBeCloseTo(SHORTAGE_SEVERE / 2);
    expect(step.projects[0]?.progress).toBeCloseTo(projectDemand(p) * (1 - SHORTAGE_SEVERE / 2));
    expect(step.projects[0]?.worstShortage).toBe(0);
    expect(step.corruptionIncrease).toBe(0);
  });

  it("ひどい不足は足りないまま進め（手抜き）、汚職と空洞化の確率が上がる", () => {
    const p = project(1, "market");
    const step = advanceConstruction([p], 1000, { wood: 0, stone: 0 });
    expect(step.shortage).toBe(1);
    expect(step.projects[0]?.progress).toBeCloseTo(projectDemand(p));
    expect(step.corruptionIncrease).toBeGreaterThan(0);
    const after = step.projects[0];
    if (!after) throw new Error("案件が消えた");
    expect(hollowChance(after, 0)).toBeGreaterThan(0);
    expect(hollowChance({ ...after, worstOverload: 100 }, 100)).toBe(HOLLOW_CHANCE_CAP);
  });

  it("資材は使った分だけ減り、負にならない", () => {
    const p = project(1, "granary");
    const step = advanceConstruction([p], 1000, { wood: 1, stone: 1 });
    expect(step.materials.wood).toBeGreaterThanOrEqual(0);
    expect(step.materials.stone).toBeGreaterThanOrEqual(0);
  });

  it("汚職率そのものによる空洞化は v3.2 の5種だけ", () => {
    expect(hollowChance(project(1, "granary"), 50)).toBeGreaterThan(0);
    expect(hollowChance(project(1, "well"), 50)).toBe(0);
  });
});
