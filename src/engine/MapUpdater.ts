import type { GameState } from "../domain/GameState";
import { deriveMap, type MapState } from "../domain/Map";

// 地図は状態から毎回導出する（DECISIONS D-52）。UI はこれを呼んで描画する。
export const mapOf = (state: Pick<GameState, "params" | "buildings" | "projects">): MapState =>
  deriveMap(state.params.infrastructure, state.buildings, state.projects);
