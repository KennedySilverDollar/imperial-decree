import { describe, expect, it } from "vitest";
import { BUILDING_IDS } from "../../domain/Buildings";
import { gridIndexOf } from "../../domain/Landscape";
import { roadTileCount } from "../../domain/Map";
import { addNote, emptyNotes, parsePlayerNotes, sameAttachment } from "../../domain/PlayerNotes";
import { gazetteerFor } from "../../engine/Gazetteer";
import { playedState } from "../../test/gameApi";
import { SURVEY_INTERVAL_YEARS } from "./mapConstants";
import { relatedToParcel, RELATED_LIMIT } from "./parcelRecords";
import { PICTOGRAMS } from "./pictograms";
import { buildSurveyModel } from "./surveyModel";

// 測量図の毎年のレイヤ（SPEC_v3.3 §5.4・§5.7〜§5.9）、区画の記録の検索（§5.6）、絵記号（§10.2）、区画へのメモ（§7）

describe("毎年描き込む中身（surveyModel）", () => {
  it("区画の中身は domain の割り振り（deriveMap）どおりで、100区画", async () => {
    const game = await playedState(3, ["家を建てよ", "畑を開け", "道を造れ"]);
    const model = buildSurveyModel({ game, notes: null, surveyDelay: false });
    expect(model.parcels).toHaveLength(100);
    expect(model.roads).toBe(roadTileCount(game.params.infrastructure));
    for (const b of game.buildings) {
      if (!b.tile) continue;
      const view = model.parcels[gridIndexOf(b.tile[0], b.tile[1])];
      expect(view?.kind).toBe("building");
      expect(view?.building).toBe(b.kind);
    }
  });

  it("直近の1年に建った・発注した区画だけ新しいインク", async () => {
    const game = await playedState(5, ["家を建てよ", "畑を開け", "井戸を掘れ", "家を建てよ"]);
    const model = buildSurveyModel({ game, notes: null, surveyDelay: false });
    const lastYear = game.turn - 1;
    for (const view of model.parcels) {
      if (!view.fresh) continue;
      const [x, y] = [view.gridIndex % 10, Math.floor(view.gridIndex / 10)];
      const built = game.buildings.find((b) => b.tile?.[0] === x && b.tile?.[1] === y);
      const ordered = game.projects.find((p) => p.tiles.some(([px, py]) => px === x && py === y));
      expect(built?.builtTurn === lastYear || ordered?.orderedTurn === lastYear).toBe(true);
    }
  });

  it("亀裂印は側近報告で開示された空洞だけ（開示されていない空洞は地図に出ない：不変条件21）", async () => {
    const game = await playedState(7, ["家を建てよ", "家を建てよ", "倉を建てよ"]);
    const placed = game.buildings.filter((b) => b.tile !== null && b.kind !== "office");
    expect(placed.length).toBeGreaterThanOrEqual(2);
    const [shown, hidden] = placed as [(typeof placed)[number], (typeof placed)[number]];
    const buildings = game.buildings.map((b) =>
      b === shown ? { ...b, hollow: true, disclosed: true } : b === hidden ? { ...b, hollow: true, disclosed: false } : { ...b, hollow: false, disclosed: false },
    );
    const model = buildSurveyModel({ game: { ...game, buildings }, notes: null, surveyDelay: false });
    const at = (b: typeof shown) => model.parcels[gridIndexOf((b.tile as [number, number])[0], (b.tile as [number, number])[1])];
    expect(at(shown)?.crack).toBe(true);
    expect(at(hidden)?.crack).toBe(false);
    expect(model.parcels.filter((p) => p.crack)).toHaveLength(1);
  });

  it("区画に留めたメモが、その区画の書き込みになる", async () => {
    const game = await playedState(9, ["家を建てよ"]);
    const notes = addNote(emptyNotes(game.saveId), { id: "n1", text: "井戸が遠い", turnCreated: 2, attachedTo: { kind: "parcel", gridIndex: 44 } }).notes;
    const model = buildSurveyModel({ game, notes, surveyDelay: false });
    expect(model.parcels[44]?.notes).toEqual(["井戸が遠い"]);
    expect(model.parcels.filter((p) => p.notes.length > 0)).toHaveLength(1);
  });

  it("測量の遅れ（既定は無効）：表題の測量年は数年ごと、それ以後に変わった区画は前の状態のまま「未測」", async () => {
    const decrees = ["家を建てよ", "畑を開け", "家を建てよ", "井戸を掘れ", "家を建てよ"];
    const game = await playedState(11, decrees);
    const off = buildSurveyModel({ game, notes: null, surveyDelay: false });
    expect(off.surveyYear).toBe(game.turn - 1);
    expect(off.parcels.some((p) => p.unsurveyed)).toBe(false);
    const on = buildSurveyModel({ game, notes: null, surveyDelay: true });
    const lastYear = game.turn - 1;
    expect(on.surveyYear).toBe(lastYear - (lastYear % SURVEY_INTERVAL_YEARS));
    for (const view of on.parcels) {
      if (!view.unsurveyed) continue;
      expect(view).not.toEqual(off.parcels[view.gridIndex]);
      expect(view.fresh).toBe(false);
    }
  });
});

describe("区画に関係する記事と報告（既決箱から検索）", () => {
  it("区域の名が書かれた記事、区画の建物を扱った記事と報告。新しい年から、上限まで", async () => {
    const game = await playedState(13, ["家を建てよ", "畑を開け", "家を建てよ", "市場を開け", "家を建てよ", "倉を建てよ"]);
    const g = gazetteerFor(game.saveId);
    const house = game.buildings.find((b) => b.kind === "residential" && b.tile !== null);
    if (!house?.tile) throw new Error("no house");
    const index = gridIndexOf(house.tile[0], house.tile[1]);
    const related = relatedToParcel(game.history, g, index, "residential");
    expect(related.length).toBeLessThanOrEqual(RELATED_LIMIT);
    const turns = related.map((r) => r.turn);
    expect([...turns].sort((a, b) => b - a)).toEqual(turns);
    const zone = g.parcels[index]?.split(" ")[0] ?? "";
    for (const r of related) {
      if (r.kind !== "article") continue;
      const record = game.history.find((h) => h.newspaper.turn === r.turn);
      const article = record?.newspaper.articles.find((a) => a.id === r.articleId);
      const text = [article?.headline, ...(article?.body ?? [])].join("");
      expect(text.includes(zone) || article?.relatedEntity?.id === "residential").toBe(true);
    }
  });
});

describe("建物の絵記号（17種）", () => {
  it("建物の一覧（単一情報源）の全てに、線だけの記号がある", () => {
    expect(Object.keys(PICTOGRAMS).sort()).toEqual([...BUILDING_IDS].sort());
    for (const id of BUILDING_IDS) expect(PICTOGRAMS[id]).toMatch(/^M[\d.\s MLHVCQAZ-]+$/);
    expect(new Set(Object.values(PICTOGRAMS)).size).toBe(BUILDING_IDS.length);
  });
});

describe("区画へのメモ（PlayerNotes）", () => {
  it("区画に留められ、保存した形を読み戻せる。範囲外の区画は捨てる", () => {
    const notes = addNote(emptyNotes("s"), { id: "a", text: "川沿いは湿る", turnCreated: 3, attachedTo: { kind: "parcel", gridIndex: 9 } }).notes;
    const raw = JSON.parse(JSON.stringify(notes));
    expect(parsePlayerNotes(raw, "s")).toEqual(notes);
    raw.notes.push({ id: "b", text: "x", turnCreated: 3, attachedTo: { kind: "parcel", gridIndex: 100 } });
    expect(parsePlayerNotes(raw, "s").notes.map((n) => n.id)).toEqual(["a"]);
    expect(sameAttachment({ kind: "parcel", gridIndex: 9 }, { kind: "parcel", gridIndex: 9 })).toBe(true);
    expect(sameAttachment({ kind: "parcel", gridIndex: 9 }, { kind: "article", turn: 9, articleId: "9" })).toBe(false);
  });
});
