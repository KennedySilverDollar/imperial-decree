import { describe, expect, it } from "vitest";
import type { Newspaper, NewspaperArticle } from "../../domain/News";
import { partialPolyline, lostBetween } from "../map/SurveyRenderer";
import type { SurveyModel } from "../map/surveyModel";
import { endingStyleOf, planSequence, REDUCED_SEQUENCE_MS, SEQUENCE_MS, sequenceSteps, sequenceTotal } from "./TurnSequence";
import { DEFAULT_WEATHER, weatherOf } from "./weather";

// ターン遷移シーケンス（SPEC_v3.3 §4.5・§8.2）、窓の光の天候、地図の描き込み（§5.7）

describe("ターン遷移シーケンスの時間割", () => {
  it("通常の年：押印 → 既決箱 → 窓の光 → 地図 → 配達 → 台帳。合計4〜6秒", () => {
    const plan = planSequence({ reduced: false, ending: null });
    expect(plan.map((p) => p.step)).toEqual(["stamp", "file", "weather", "map", "delivery", "ledger"]);
    expect(sequenceTotal(plan)).toBeGreaterThanOrEqual(4000);
    expect(sequenceTotal(plan)).toBeLessThanOrEqual(6000);
    // 段は隙間なく続く
    plan.forEach((p, i) => i > 0 && expect(p.start).toBe((plan[i - 1]?.start ?? 0) + (plan[i - 1]?.duration ?? 0)));
    expect(plan.find((p) => p.step === "map")?.duration).toBeGreaterThanOrEqual(1000);
    expect(plan.find((p) => p.step === "map")?.duration).toBeLessThanOrEqual(1500);
  });

  it("エンディングの年は地図の更新の後に専用の演出へ分岐する（成功は印章、それ以外はランプ）。合計4〜6秒", () => {
    expect(sequenceSteps("seal")).toEqual(["stamp", "file", "weather", "map", "ending"]);
    const plan = planSequence({ reduced: false, ending: "lampOut" });
    expect(sequenceTotal(plan)).toBeGreaterThanOrEqual(4000);
    expect(sequenceTotal(plan)).toBeLessThanOrEqual(6000);
    expect(endingStyleOf({ kind: "success", stage: "town" })).toBe("seal");
    expect(endingStyleOf({ kind: "timeout" })).toBe("lampOut");
    expect(endingStyleOf({ kind: "gameover", reason: "treasury" })).toBe("lampOut");
    expect(endingStyleOf(null)).toBeNull();
  });

  it("動きを減らす：各段を短くし、合計は通常の 1/3 以下（約1秒）", () => {
    for (const step of Object.keys(SEQUENCE_MS) as (keyof typeof SEQUENCE_MS)[]) expect(REDUCED_SEQUENCE_MS[step]).toBeLessThan(SEQUENCE_MS[step]);
    const reduced = sequenceTotal(planSequence({ reduced: true, ending: null }));
    expect(reduced).toBeLessThanOrEqual(sequenceTotal(planSequence({ reduced: false, ending: null })) / 3);
    expect(reduced).toBeLessThanOrEqual(1500);
  });
});

const article = (id: string, headline: string): NewspaperArticle => ({
  id,
  section: "weather",
  headline,
  body: [],
  threadKey: null,
  isFollowUp: false,
  biasApplied: { hedged: false, euphemism: false, praised: false } as unknown as NewspaperArticle["biasApplied"],
  truthfulness: 1,
  relatedEntity: null,
});
const paper = (articles: NewspaperArticle[]): Newspaper => ({ turn: 3, articles } as unknown as Newspaper);

describe("窓の光の天候（N-19 に連動）", () => {
  it("天候欄の季節で決まり、凶作の年は雨。新聞が無ければ着任時の天候", () => {
    expect(weatherOf(paper([article("N-19", "秋の便り")]))).toEqual({ season: "autumn", sky: "clear" });
    expect(weatherOf(paper([article("N-19", "冬の便り"), article("E-02", "冬の凶作、…")]))).toEqual({ season: "winter", sky: "rain" });
    expect(weatherOf(null)).toEqual(DEFAULT_WEATHER);
  });
});

describe("地図の描き込み", () => {
  const empty = (): SurveyModel => ({
    surveyYear: 1,
    roads: 0,
    freshRoadsFrom: 0,
    parcels: Array.from({ length: 100 }, (_, gridIndex) => ({ gridIndex, kind: "empty", building: null, fresh: false, crack: false, unsurveyed: false, notes: [] })),
  });

  it("失われた建物：建物があった区画が空き地になったときだけ（普請中・別の建物への入れ替わりは除く）", () => {
    const before = empty();
    const after = empty();
    (before.parcels as SurveyModel["parcels"][number][])[3] = { ...before.parcels[3]!, kind: "building", building: "granary" };
    (before.parcels as SurveyModel["parcels"][number][])[4] = { ...before.parcels[4]!, kind: "building", building: "residential" };
    (after.parcels as SurveyModel["parcels"][number][])[4] = { ...after.parcels[4]!, kind: "construction", building: "residential" };
    expect(lostBetween(before, after)).toEqual([{ gridIndex: 3, building: "granary", fresh: true }]);
    expect(lostBetween(after, after)).toEqual([]);
  });

  it("道は線が伸びる：進みに応じた長さの部分だけを描く", () => {
    const line = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    expect(partialPolyline(line, 0.5)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);
    expect(partialPolyline(line, 0.25)).toEqual([
      { x: 0, y: 0 },
      { x: 5, y: 0 },
    ]);
    expect(partialPolyline(line, 1)).toEqual(line);
  });
});
