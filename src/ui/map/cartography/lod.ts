import type { Point, VillageFrame } from "../terrain/types";

// 手元の地図の縮尺（SPEC_v3.4 §7.1）。ズームは連続で、表示の幅（m）から段階 L0〜L3 を決める。
// 段階はレイヤと注記の出し分けに使う（線の太さは段階ごとに調整）。

export type Lod = 0 | 1 | 2 | 3;

/** 各段階の表示の幅の目安（m） */
export const LOD_WIDTH_M: Readonly<Record<Lod, number>> = { 0: 4000, 1: 1500, 2: 600, 3: 120 };
/** 段階の境目（表示の幅がこれ以上ならその段階） */
const LOD_EDGES: readonly [Lod, number][] = [
  [0, 2500],
  [1, 900],
  [2, 250],
];
export const MIN_VIEW_M = 90;
export const MAX_VIEW_M = 4000;

/** 地図の表示：中心（地図座標）と、表示の一辺（m） */
export interface MapView {
  readonly center: Point;
  readonly widthM: number;
}

export const lodOf = (widthM: number): Lod => {
  for (const [lod, edge] of LOD_EDGES) if (widthM >= edge) return lod;
  return 3;
};

/** 俯瞰（スナップショット）と手元の初期表示：L1（村域と周辺） */
export const defaultView = (F: VillageFrame): MapView => ({ center: F.center, widthM: LOD_WIDTH_M[1] });

export const clampView = (v: MapView, worldM: number): MapView => {
  const widthM = Math.min(MAX_VIEW_M, Math.max(MIN_VIEW_M, v.widthM));
  const half = Math.min(widthM / 2, worldM / 2);
  return {
    widthM,
    center: [Math.min(worldM - half, Math.max(half, v.center[0])), Math.min(worldM - half, Math.max(half, v.center[1]))],
  };
};

/** ホイールのズーム：画面上の点（0..1）を固定したまま、表示の幅を factor 倍にする */
export const zoomAt = (v: MapView, factor: number, at: Point, worldM: number): MapView => {
  const widthM = Math.min(MAX_VIEW_M, Math.max(MIN_VIEW_M, v.widthM * factor));
  const k = widthM / v.widthM;
  const px = v.center[0] + (at[0] - 0.5) * v.widthM;
  const py = v.center[1] + (at[1] - 0.5) * v.widthM;
  return clampView({ widthM, center: [px + (v.center[0] - px) * k, py + (v.center[1] - py) * k] }, worldM);
};

/** ドラッグのパン：画面上の移動（0..1 の割合）だけ動かす */
export const panBy = (v: MapView, dx: number, dy: number, worldM: number): MapView =>
  clampView({ widthM: v.widthM, center: [v.center[0] - dx * v.widthM, v.center[1] - dy * v.widthM] }, worldM);

/** 画面上の点（0..1）→ 地図座標 */
export const screenToWorld = (v: MapView, at: Point): Point => [v.center[0] + (at[0] - 0.5) * v.widthM, v.center[1] + (at[1] - 0.5) * v.widthM];
