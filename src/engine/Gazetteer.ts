import { CENTER_ZONE_NAME, FEATURE_PHRASE, parcelName, TOPONYM_WORDS, ZONE_DIRECTION, zoneName } from "../content/toponyms/ja";
import { GRID_SIZE } from "../domain/constants";
import {
  FEATURE_KINDS,
  landscapePlan,
  parcelOrdinal,
  SIDES,
  terrainSeed,
  zoneFeature,
  zoneOf,
  ZONES,
  type FeatureKind,
  type LandscapePlan,
  type Zone,
} from "../domain/Landscape";

// 地名一覧（SPEC_v3.3 §5.5・§11.2 / 不変条件20）。saveId から決まる土地の筋書き（domain/Landscape）だけで組み立てるので、
// 地形を生成しなくても、新聞の生成より前に確定している。新聞の {place}・地図の地名・区画の名は、すべてここから取る。

export type ToponymKind = "region" | "feature" | "zone" | "parcel";

export interface Toponym {
  readonly kind: ToponymKind;
  readonly name: string;
  /** 地形の地名（川・丘・森・沼・野）のとき */
  readonly feature?: FeatureKind;
  readonly zone?: Zone;
  /** 区画の名のとき（0..99、y*10+x） */
  readonly gridIndex?: number;
}

export interface Gazetteer {
  readonly plan: LandscapePlan;
  /** 領地の名（地図の表題） */
  readonly region: string;
  /** 地図にある地形の名（沼の無い領地は lake が null、沼のある領地は plain が null） */
  readonly features: Readonly<Record<FeatureKind, string | null>>;
  readonly zones: Readonly<Record<Zone, string>>;
  /** 100 区画の名（gridIndex 順） */
  readonly parcels: readonly string[];
  /** すべての地名（一意） */
  readonly all: readonly Toponym[];
}

const pick = (words: readonly string[], n: number): string => words[n % words.length] ?? "";

export const buildGazetteer = (plan: LandscapePlan): Gazetteer => {
  const present = new Set(SIDES.map((s) => plan.sides[s]));
  const features = Object.fromEntries(
    FEATURE_KINDS.map((f) => [f, present.has(f) ? pick(TOPONYM_WORDS[f], plan.words[f]) : null]),
  ) as Record<FeatureKind, string | null>;
  const zones = Object.fromEntries(
    ZONES.map((zone) => {
      const feature = zoneFeature(plan, zone);
      const featureName = feature === null ? null : features[feature];
      return [zone, feature === null || featureName === null ? CENTER_ZONE_NAME : zoneName(ZONE_DIRECTION[zone], FEATURE_PHRASE[feature](featureName))];
    }),
  ) as Record<Zone, string>;
  const parcels: string[] = [];
  for (let y = 0; y < GRID_SIZE; y++) for (let x = 0; x < GRID_SIZE; x++) parcels.push(parcelName(zones[zoneOf(x, y)], parcelOrdinal(x, y)));

  const region = pick(TOPONYM_WORDS.region, plan.words.region);
  const all: Toponym[] = [
    { kind: "region", name: region },
    ...FEATURE_KINDS.flatMap((f): Toponym[] => {
      const name = features[f];
      return name === null ? [] : [{ kind: "feature", name, feature: f }];
    }),
    ...ZONES.map((zone): Toponym => ({ kind: "zone", name: zones[zone], zone })),
    ...parcels.map((name, gridIndex): Toponym => ({ kind: "parcel", name, gridIndex, zone: zoneOf(gridIndex % GRID_SIZE, Math.floor(gridIndex / GRID_SIZE)) })),
  ];
  return { plan, region, features, zones, parcels, all };
};

// 同じ saveId は何度も引かれる（新聞は毎年、地図は描くたび）。直近の数件だけ覚えておく
const CACHE_LIMIT = 8;
const cache = new Map<string, Gazetteer>();

export const gazetteerFor = (saveId: string): Gazetteer => {
  const hit = cache.get(saveId);
  if (hit) return hit;
  const made = buildGazetteer(landscapePlan(terrainSeed(saveId)));
  cache.set(saveId, made);
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return made;
};

/** 新聞の {place} に使う地名：村域の区域の名（区画の番号までは書かない） */
export const newspaperPlaces = (saveId: string): readonly string[] => {
  const g = gazetteerFor(saveId);
  return ZONES.map((z) => g.zones[z]);
};
