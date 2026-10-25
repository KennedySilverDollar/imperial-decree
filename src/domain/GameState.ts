import { makeAide, INITIAL_AIDE_PROFILES, type Aide } from "./Aide";
import { BUILDINGS, INITIAL_BUILDINGS, POLICY_IDS, type BuildingId, type PolicyId } from "./Buildings";
import type { Materials, Project } from "./Construction";
import {
  EVENT_COOLDOWN_TURNS,
  INITIAL_CORRUPTION,
  INITIAL_HAPPINESS,
  INITIAL_INFRASTRUCTURE,
  INITIAL_POLITICAL_CAPITAL,
  INITIAL_POPULATION,
  INITIAL_STONE,
  INITIAL_TREASURY,
  INITIAL_WOOD,
  SAVE_SCHEMA_VERSION,
} from "./constants";
import type { BuildingInstance } from "./DerivedStats";
import type { Ending } from "./Ending";
import type { ActiveEvent } from "./Events";
import { chooseTile, placementUnit, tileKey } from "./Map";
import { EMPTY_NEWSPAPER_STATE, type NewspaperState } from "./News";
import { normalizeSeed, type PrngState } from "./Prng";
import type { TurnRecord } from "./TurnRecord";
import type { ParamKey } from "./Vocabulary";

// ゲーム状態（SPEC §11.4 ＋ v3.2 ＋ v3.3 / DECISIONS V-13, W-09, Z-13）。不変オブジェクトとして扱う。

/** 台帳（v3.2 §2.2：常時表示。労働人口は人口から導出して表示する） */
export type Params = Readonly<Record<ParamKey, number>>;

export interface PolicyState {
  /** −POLICY_LEVEL_MAX〜+POLICY_LEVEL_MAX */
  readonly level: number;
  /** 最後の勅令から効き続ける残り年数。0 になったら毎年1段階ずつ 0 に戻る */
  readonly turnsLeft: number;
}

export interface GameState {
  readonly schemaVersion: typeof SAVE_SCHEMA_VERSION;
  readonly seed: number;
  /** 新聞の seed と地図の配置に使う（V-13） */
  readonly saveId: string;
  readonly rngState: PrngState;
  /** 次に処理するターン番号（1始まり） */
  readonly turn: number;
  readonly stage: "village" | "town";
  readonly params: Params;
  readonly buildings: readonly BuildingInstance[];
  readonly nextSerial: number;
  /** 工事台帳（v3.3） */
  readonly projects: readonly Project[];
  readonly nextProjectId: number;
  readonly policies: Readonly<Record<PolicyId, PolicyState>>;
  /** 秘匿の資材（UI に出さない。v3.3） */
  readonly materials: Materials;
  readonly event: ActiveEvent | null;
  /** 次のイベントが起きうるまでの年数 */
  readonly eventCooldown: number;
  readonly newspaperState: NewspaperState;
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

export const INITIAL_POLICIES: Readonly<Record<PolicyId, PolicyState>> = Object.fromEntries(
  POLICY_IDS.map((id) => [id, { level: 0, turnsLeft: 0 }]),
) as Record<PolicyId, PolicyState>;

export const saveIdFor = (seed: number): string => `save-${normalizeSeed(seed).toString(36)}`;

/** 初期建物（BALANCE §13）を区画に置く */
export const placeInitialBuildings = (saveId: string): { buildings: BuildingInstance[]; nextSerial: number } => {
  const buildings: BuildingInstance[] = [];
  const occupied = new Set<string>();
  let serial = 1;
  for (const [kind, count] of Object.entries(INITIAL_BUILDINGS) as [BuildingId, number][]) {
    for (let i = 0; i < count; i++) {
      const tile = BUILDINGS[kind].occupiesTile ? chooseTile(occupied, kind, placementUnit(saveId, serial)) : null;
      if (tile) occupied.add(tileKey(tile));
      buildings.push({ serial, kind, builtTurn: 0, hollow: false, disclosed: false, tile });
      serial++;
    }
  }
  return { buildings, nextSerial: serial };
};

export const createInitialState = (seed: number): GameState => {
  const saveId = saveIdFor(seed);
  const { buildings, nextSerial } = placeInitialBuildings(saveId);
  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    seed: normalizeSeed(seed),
    saveId,
    rngState: normalizeSeed(seed),
    turn: 1,
    stage: "village",
    params: INITIAL_PARAMS,
    buildings,
    nextSerial,
    projects: [],
    nextProjectId: 1,
    policies: INITIAL_POLICIES,
    materials: { wood: INITIAL_WOOD, stone: INITIAL_STONE },
    event: null,
    eventCooldown: EVENT_COOLDOWN_TURNS,
    newspaperState: EMPTY_NEWSPAPER_STATE,
    aides: INITIAL_AIDE_PROFILES.map((profile) => makeAide(profile, 0)),
    politicalCapital: INITIAL_POLITICAL_CAPITAL,
    history: [],
    ending: null,
  };
};

export type ParamDelta = Params;

export const diffParams = (after: Params, before: Params): ParamDelta => ({
  population: after.population - before.population,
  treasury: after.treasury - before.treasury,
  happiness: after.happiness - before.happiness,
  infrastructure: after.infrastructure - before.infrastructure,
  corruption: after.corruption - before.corruption,
});

export const hasBuilding = (state: Pick<GameState, "buildings">, kind: BuildingId): boolean =>
  state.buildings.some((b) => b.kind === kind);
