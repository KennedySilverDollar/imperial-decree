import { GRID_SIZE } from "./constants";
import { deriveSeed, hashString, nextFloat } from "./Prng";

// 測量図の「土地の筋書き」（SPEC_v3.3 §5.2・§5.5）。地形を作る前に、村域の四辺に何があるか
// （川・丘・森・沼または野）と、地名に使う語の番号を saveId だけから決める。
// 地形（ui/map/TerrainGenerator）はこの筋書きどおりに川・丘・森・沼を置き、地名（engine/Gazetteer）も
// この筋書きから作るので、地形を生成しなくても地名一覧が確定する（新聞の生成より前に地名を決める：不変条件20）。
// 文字列は持たない（語は content/toponyms のデータ）。

export const SIDES = ["north", "east", "south", "west"] as const;
export type Side = (typeof SIDES)[number];

export const FEATURE_KINDS = ["river", "hill", "forest", "lake", "plain"] as const;
export type FeatureKind = (typeof FEATURE_KINDS)[number];

/** 村域を 3×3 に分けた区域（北西・北・北東・西・中・東・南西・南・南東） */
export const ZONES = ["northwest", "north", "northeast", "west", "center", "east", "southwest", "south", "southeast"] as const;
export type Zone = (typeof ZONES)[number];

/** 角の区域で、隣り合う二辺のどちらの地形を名に取るか（前ほど目立つ地形） */
const FEATURE_PRIORITY: readonly FeatureKind[] = ["river", "lake", "hill", "forest", "plain"];

/** 沼を置く確率（湖・沼は 0〜1 個。§5.2-4） */
const LAKE_CHANCE = 0.55;

export interface LandscapePlan {
  /** 地形の seed = hash(saveId, "terrain") */
  readonly seed: number;
  /** 村域の各辺の外にある地形（川・丘・森は必ず1辺ずつ。残る1辺は沼か野） */
  readonly sides: Readonly<Record<Side, FeatureKind>>;
  /** 川が流れる向き：辺に沿って時計回りか（高い縁から低い縁へ） */
  readonly riverClockwise: boolean;
  /** 地名の語を選ぶ番号（語の一覧の長さで割った余りを使う） */
  readonly words: Readonly<Record<FeatureKind | "region", number>>;
}

export const terrainSeed = (saveId: string): number => hashString(`${saveId}:terrain`);

/** seed から [0,1) を順に取り出す（筋書き専用の系列。ゲームの Rng は消費しない） */
const stream = (seed: number) => {
  let state = deriveSeed(seed, 0x1a2d);
  return (): number => {
    const [value, next] = nextFloat(state);
    state = next;
    return value;
  };
};

export const landscapePlan = (seed: number): LandscapePlan => {
  const next = stream(seed);
  const features: FeatureKind[] = ["river", "hill", "forest", next() < LAKE_CHANCE ? "lake" : "plain"];
  // Fisher–Yates で四辺に割り振る
  for (let i = features.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    const a = features[i] as FeatureKind;
    features[i] = features[j] as FeatureKind;
    features[j] = a;
  }
  const sides = Object.fromEntries(SIDES.map((side, i) => [side, features[i] as FeatureKind])) as Record<Side, FeatureKind>;
  const riverClockwise = next() < 0.5;
  const word = () => Math.floor(next() * 0x10000);
  return {
    seed,
    sides,
    riverClockwise,
    words: { river: word(), hill: word(), forest: word(), lake: word(), plain: word(), region: word() },
  };
};

export const planHasLake = (plan: LandscapePlan): boolean => SIDES.some((s) => plan.sides[s] === "lake");

export const sideOf = (plan: LandscapePlan, feature: FeatureKind): Side | null => SIDES.find((s) => plan.sides[s] === feature) ?? null;

/** 区画の帯（0..2）：外側の3列・内側の4列・外側の3列 */
const band = (i: number): 0 | 1 | 2 => (i < 3 ? 0 : i < GRID_SIZE - 3 ? 1 : 2);

const ZONE_GRID: readonly (readonly Zone[])[] = [
  ["northwest", "north", "northeast"],
  ["west", "center", "east"],
  ["southwest", "south", "southeast"],
];

/** 区画 (x, y) の区域（y=0 が北） */
export const zoneOf = (x: number, y: number): Zone => ZONE_GRID[band(y)]?.[band(x)] ?? "center";

/** 区域が接する辺（角の区域は2辺、中の区域は無し） */
export const zoneSides = (zone: Zone): readonly Side[] => {
  const sides: Side[] = [];
  if (zone.startsWith("north")) sides.push("north");
  if (zone.startsWith("south")) sides.push("south");
  if (zone.endsWith("east")) sides.push("east");
  if (zone.endsWith("west")) sides.push("west");
  return sides;
};

/** 区域の名に取る地形（中の区域は null） */
export const zoneFeature = (plan: LandscapePlan, zone: Zone): FeatureKind | null => {
  const candidates = zoneSides(zone).map((s) => plan.sides[s]);
  if (candidates.length === 0) return null;
  return FEATURE_PRIORITY.find((f) => candidates.includes(f)) ?? null;
};

/** 区画の番号（区域の中で北から南、西から東の順に 1 から） */
export const parcelOrdinal = (x: number, y: number): number => {
  const zone = zoneOf(x, y);
  let n = 0;
  for (let yy = 0; yy < GRID_SIZE; yy++)
    for (let xx = 0; xx < GRID_SIZE; xx++) {
      if (zoneOf(xx, yy) !== zone) continue;
      n++;
      if (xx === x && yy === y) return n;
    }
  return n;
};

export const gridIndexOf = (x: number, y: number): number => y * GRID_SIZE + x;
export const gridCoordOf = (index: number): readonly [number, number] => [index % GRID_SIZE, Math.floor(index / GRID_SIZE)];
