import type { BuildingId } from "../../domain/Buildings";
import type { GameState } from "../../domain/GameState";
import { gridIndexOf } from "../../domain/Landscape";
import { deriveMap, roadTileCount, type TileKind } from "../../domain/Map";
import type { PlayerNotes } from "../../domain/PlayerNotes";
import { SURVEY_INTERVAL_YEARS } from "./mapConstants";

// 毎年描き込むレイヤ（区画・道路・建物・書き込み）の中身（SPEC_v3.3 §5.4・§5.7〜§5.9）。
// GameState を読むだけで書き込まない（不変条件17）。区画の割り振りは domain/Map の deriveMap をそのまま使う（配置ロジックは変えない）。
// 地図に描くのは見た目（visual_state）だけ。空洞は側近報告で開示された建物（disclosed）にだけ亀裂印を付ける（不変条件21）。

export interface ParcelView {
  readonly gridIndex: number;
  readonly kind: TileKind;
  readonly building: BuildingId | null;
  /** 直近の1年に描き込んだ（新しい濃いインク） */
  readonly fresh: boolean;
  /** 側近報告で空洞が開示された（朱の亀裂印と鉛筆の注記） */
  readonly crack: boolean;
  /** 測量の遅れ（§5.9）：測量のあとに変わったが、図はまだ前の状態のまま */
  readonly unsurveyed: boolean;
  /** この区画に留めたメモ（本文） */
  readonly notes: readonly string[];
}

export interface SurveyModel {
  /** 表題の測量年（0 は着任時） */
  readonly surveyYear: number;
  /** 描く道路の本数（論理の道路区画の数） */
  readonly roads: number;
  /** この番号より後の道路は直近の1年に伸びた（新しいインク） */
  readonly freshRoadsFrom: number;
  readonly parcels: readonly ParcelView[];
}

export interface SurveyModelInput {
  readonly game: Pick<GameState, "turn" | "params" | "buildings" | "projects" | "history">;
  readonly notes: PlayerNotes | null;
  /** 測量の遅れ（既定は無効） */
  readonly surveyDelay: boolean;
}

/** その年の暮れのインフラ（0 年は着任時） */
const infrastructureAt = (game: SurveyModelInput["game"], year: number): number => {
  if (year <= 0) return game.history[0]?.before.infrastructure ?? game.params.infrastructure;
  return game.history.find((r) => r.turn === year)?.after.infrastructure ?? game.params.infrastructure;
};

export const buildSurveyModel = ({ game, notes, surveyDelay }: SurveyModelInput): SurveyModel => {
  const lastYear = game.turn - 1;
  const surveyYear = surveyDelay ? lastYear - (lastYear % SURVEY_INTERVAL_YEARS) : lastYear;
  const delayed = surveyYear < lastYear;

  const current = deriveMap(game.params.infrastructure, game.buildings, game.projects);
  const shown = delayed
    ? deriveMap(
        infrastructureAt(game, surveyYear),
        game.buildings.filter((b) => b.builtTurn <= surveyYear),
        game.projects.filter((p) => p.orderedTurn <= surveyYear),
      )
    : current;

  const notesByParcel = new Map<number, string[]>();
  for (const note of notes?.notes ?? []) {
    if (note.attachedTo?.kind !== "parcel") continue;
    const list = notesByParcel.get(note.attachedTo.gridIndex) ?? [];
    list.push(note.text);
    notesByParcel.set(note.attachedTo.gridIndex, list);
  }

  const parcels: ParcelView[] = [];
  for (const row of shown.tiles)
    for (const tile of row) {
      const gridIndex = gridIndexOf(tile.x, tile.y);
      const now = current.tiles[tile.y]?.[tile.x];
      const instance = game.buildings.find((b) => b.tile !== null && b.tile[0] === tile.x && b.tile[1] === tile.y);
      const project = game.projects.find((p) => p.tiles.some(([x, y]) => x === tile.x && y === tile.y));
      const fresh =
        !delayed &&
        lastYear > 0 &&
        ((tile.kind === "building" && instance?.builtTurn === lastYear) || (tile.kind === "construction" && project?.orderedTurn === lastYear));
      parcels.push({
        gridIndex,
        kind: tile.kind,
        building: tile.building,
        fresh,
        crack: tile.kind === "building" && instance !== undefined && instance.disclosed && instance.hollow,
        unsurveyed: delayed && (now?.kind !== tile.kind || now?.building !== tile.building),
        notes: notesByParcel.get(gridIndex) ?? [],
      });
    }

  const previousRoads = roadTileCount(infrastructureAt(game, lastYear - 1));
  return {
    surveyYear,
    roads: shown.roads,
    freshRoadsFrom: delayed || lastYear <= 0 ? shown.roads : Math.min(previousRoads, shown.roads),
    parcels,
  };
};
