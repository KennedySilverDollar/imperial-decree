import { BUILDINGS } from "../../domain/Buildings";
import { GRID_SIZE } from "../../domain/constants";
import type { GameState } from "../../domain/GameState";
import { ROAD_TILES } from "../../domain/Map";
import { mapOf } from "../../engine/MapUpdater";
import type { PlayerNote } from "../../domain/PlayerNotes";
import type { BuildingView, ConstructionView, MapViewModel, ParcelView } from "../map/MapViewModel";

// GameState → MapViewModel（SPEC_v3.4 §5.2、DECISIONS BB-11）。地図の描画層はこの結果だけを受け取る。
// 読むのは見た目に出てよいものだけ：ターン、saveId、区画の割当（MapState）、完成した建物の種類・区画・完成した年、
// 普請中の案件の種別・区画・棟数。空洞・資材・工事の進捗と工期・イベント・派生指標・労働人口は読まない。

type Visible = Pick<GameState, "saveId" | "turn" | "params" | "buildings" | "projects">;

const indexOf = (x: number, y: number) => y * GRID_SIZE + x;

export const projectMapView = (state: Visible): MapViewModel => {
  // 区画の割当と道路の本数は MapState のまま（W-09, I-16, I-39）。修繕の工事は地図に出さない（MapState と同じ）
  const map = mapOf({ params: state.params, buildings: state.buildings, projects: state.projects });
  const roadPlan = ROAD_TILES.map(([x, y]) => indexOf(x, y));
  const cross = new Set(roadPlan);
  const parcels: ParcelView[] = map.tiles.flatMap((row) =>
    row.map((t) => ({ gridIndex: indexOf(t.x, t.y), x: t.x, y: t.y, use: t.kind, onCross: cross.has(indexOf(t.x, t.y)) })),
  );
  const roads = roadPlan.slice(0, map.roads).map((gridIndex) => ({ gridIndex }));
  const buildings: BuildingView[] = state.buildings
    .flatMap((b) =>
      b.tile === null
        ? []
        : [{ id: b.serial, kind: b.kind, category: BUILDINGS[b.kind].category, gridIndex: indexOf(b.tile[0], b.tile[1]), count: 1, builtTurn: b.builtTurn }],
    )
    .sort((a, b) => a.id - b.id);
  const construction: ConstructionView[] = state.projects
    .filter((p) => !p.repair && p.tiles.length > 0)
    .map((p) => ({
      id: p.id,
      kind: p.kind,
      category: BUILDINGS[p.kind].category,
      gridIndices: p.tiles.map(([x, y]) => indexOf(x, y)),
      count: p.count,
    }))
    .sort((a, b) => a.id - b.id);
  return {
    saveId: state.saveId,
    turn: state.turn,
    parcels,
    roadPlan,
    roads,
    buildings,
    construction,
    notes: [],
    surveyedUntil: state.turn,
  };
};

/** 書き付け（PlayerNotes）を地図に載せる。ゲームの状態とは別に保存しているもの（AA-11） */
export const withNotes = (view: MapViewModel, notes: readonly PlayerNote[]): MapViewModel =>
  notes.length === 0 && view.notes.length === 0 ? view : { ...view, notes: notes.map((n) => ({ id: n.id, gridIndex: n.gridIndex, text: n.text })) };
