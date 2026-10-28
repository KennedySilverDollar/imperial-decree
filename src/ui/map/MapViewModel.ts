import type { BuildingId, Category } from "../../domain/Buildings";

// 地図の描画層が受け取る唯一の入力（SPEC_v3.4 §5.2、不変条件26）。
// 作るのは src/ui/game/projectMapView.ts だけ。ここには見た目（visual_state）しか入らない：
// 空洞・派生指標・資材・工事の進捗と工期・イベント・労働人口は、型の上でも持たない。

/** 区画の使われ方（MapState の割当のまま） */
export type ParcelUse = "empty" | "road" | "building" | "construction";

export interface ParcelView {
  /** 0..99（= y × 10 + x） */
  readonly gridIndex: number;
  readonly x: number;
  readonly y: number;
  readonly use: ParcelUse;
  /** 十字の本通りの区画（整備済みかどうかは use で分かる） */
  readonly onCross: boolean;
}

export interface RoadView {
  readonly gridIndex: number;
}

/** 完成した建物（区画を持つもの）。空洞かどうかは含めない（I-32） */
export interface BuildingView {
  /** 建物の通し番号（細部の決定論 hash(saveId, 建物ID) に使う） */
  readonly id: number;
  readonly kind: BuildingId;
  readonly category: Category;
  readonly gridIndex: number;
  /** その区画に建っている棟数 */
  readonly count: number;
  readonly builtTurn: number;
}

/** 普請中の案件：種別・区画・棟数だけ。進捗・工期・建材は含めない（不変条件13・21） */
export interface ConstructionView {
  readonly id: number;
  readonly kind: BuildingId;
  readonly category: Category;
  readonly gridIndices: readonly number[];
  readonly count: number;
}

/** 地図に留めた書き付け（PlayerNotes。ゲームの状態とは別に保存。AA-11） */
export interface MapNote {
  readonly id: string;
  readonly gridIndex: number;
  readonly text: string;
}

export interface MapViewModel {
  /** 地形の seed と細部の決定論に使う */
  readonly saveId: string;
  /** 測量年 */
  readonly turn: number;
  /** 100区画（gridIndex の順） */
  readonly parcels: readonly ParcelView[];
  /** 十字の本通りの区画（整備される順。最大19） */
  readonly roadPlan: readonly number[];
  /** 整備済みの道路区画（本数 = floor(インフラ/5)、最大19） */
  readonly roads: readonly RoadView[];
  readonly buildings: readonly BuildingView[];
  readonly construction: readonly ConstructionView[];
  readonly notes: readonly MapNote[];
  /** 測量の遅れ（既定無効。AA-05）。無効のときは turn と同じ */
  readonly surveyedUntil: number;
}
