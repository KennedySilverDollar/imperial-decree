import { makeAide, INITIAL_AIDE_PROFILES, type Aide } from "./Aide";
import {
  INITIAL_CORRUPTION,
  INITIAL_HAPPINESS,
  INITIAL_HOUSING_UNITS,
  INITIAL_INFRASTRUCTURE,
  INITIAL_POLITICAL_CAPITAL,
  INITIAL_POPULATION,
  INITIAL_TREASURY,
  SAVE_SCHEMA_VERSION,
} from "./constants";
import type { Ending } from "./Ending";
import { normalizeSeed, type PrngState } from "./Prng";
import type { TurnRecord } from "./TurnRecord";
import type { ParamKey } from "./Vocabulary";

// ゲーム状態（SPEC §11.4 ＋ DECISIONS D-52, N-01）。不変オブジェクトとして扱う。

export type Params = Readonly<Record<ParamKey, number>>;

export interface Facilities {
  /** 住宅区画数（実数。容量は floor して使う。DECISIONS N-01） */
  readonly housingUnits: number;
  readonly marketCount: number;
  readonly officeBuilt: boolean;
  /** 骨抜きで「見かけだけ」になったインフラ量（BALANCE §6） */
  readonly hollowInfrastructure: number;
  /** 空洞が側近報告で開示済みか（地図の亀裂アイコン） */
  readonly hollowDisclosed: boolean;
}

export interface GameState {
  readonly schemaVersion: typeof SAVE_SCHEMA_VERSION;
  readonly seed: number;
  readonly rngState: PrngState;
  /** 次に処理するターン番号（1始まり） */
  readonly turn: number;
  readonly stage: "village" | "town";
  readonly params: Params;
  readonly facilities: Facilities;
  readonly aides: readonly Aide[];
  readonly politicalCapital: number;
  readonly history: readonly TurnRecord[];
  readonly ending: Ending | null;
}

export const INITIAL_PARAMS: Params = {
  population: INITIAL_POPULATION,
  treasury: INITIAL_TREASURY,
  happiness: INITIAL_HAPPINESS,
  infrastructure: INITIAL_INFRASTRUCTURE,
  corruption: INITIAL_CORRUPTION,
};

export const INITIAL_FACILITIES: Facilities = {
  housingUnits: INITIAL_HOUSING_UNITS,
  marketCount: 0,
  officeBuilt: false,
  hollowInfrastructure: 0,
  hollowDisclosed: false,
};

export const createInitialState = (seed: number): GameState => ({
  schemaVersion: SAVE_SCHEMA_VERSION,
  seed: normalizeSeed(seed),
  rngState: normalizeSeed(seed),
  turn: 1,
  stage: "village",
  params: INITIAL_PARAMS,
  facilities: INITIAL_FACILITIES,
  aides: INITIAL_AIDE_PROFILES.map((profile) => makeAide(profile, 0)),
  politicalCapital: INITIAL_POLITICAL_CAPITAL,
  history: [],
  ending: null,
});

export type ParamDelta = Params;

export const diffParams = (after: Params, before: Params): ParamDelta => ({
  population: after.population - before.population,
  treasury: after.treasury - before.treasury,
  happiness: after.happiness - before.happiness,
  infrastructure: after.infrastructure - before.infrastructure,
  corruption: after.corruption - before.corruption,
});
