import { hashString } from "../../../domain/Prng";
import { messages } from "../../../i18n/messages";
import { createRandom, type RandomFn } from "./rng";
import { TOPONYM_COUNTS } from "./terrainConstants";
import type { Point, Toponym, ToponymKind } from "./types";

// 地名（SPEC_v3.4 §6.5、DECISIONS BB-12）。
// 名前の一覧は saveId だけから決める（地形に依存しない）。地形の生成が終わる前でも、ヘッドレスの sim でも
// 同じ一覧が得られ、新聞（NewspaperGenerator）の {place} はこの一覧の小字から埋める（不変条件20）。
// 地形側は、出来上がった川・山・湖などへこの一覧の名前を順に割り当てるだけ。すべての名前は互いに異なる。
// 純関数（DOM・Worker に依存しない）なので、engine から import してよい（DECISIONS §17.9）。

export interface ToponymNames {
  readonly region: string;
  /** 本流が先頭 */
  readonly rivers: readonly string[];
  readonly mountains: readonly string[];
  readonly hills: readonly string[];
  readonly lakes: readonly string[];
  readonly wetlands: readonly string[];
  readonly pass: string;
  readonly destination: string;
  /** 小字（村域の区画名。新聞の {place}） */
  readonly districts: readonly string[];
}

const pick = <A>(random: RandomFn, items: readonly A[]): A => items[Math.floor(random() * items.length)]!;

/** saveId から地名の一覧を作る（決定論・一意） */
export const generateToponymNames = (saveId: string): ToponymNames => {
  const t = messages.toponyms;
  const random = createRandom(hashString(`${saveId}:toponyms`));
  const used = new Set<string>();
  const unique = (make: () => string): string => {
    for (let tries = 0; tries < 200; tries++) {
      const name = make();
      if (!used.has(name)) {
        used.add(name);
        return name;
      }
    }
    // 部品の組み合わせが尽きることは実際にはないが、念のため頭を重ねて必ず一意にする
    let name = make();
    while (used.has(name)) name = pick(random, t.heads) + name;
    used.add(name);
    return name;
  };
  const base = (twoChars: boolean) => pick(random, t.heads) + (twoChars ? pick(random, t.roots) : "");
  const many = (count: number, make: () => string) => Array.from({ length: count }, () => unique(make));

  const region = unique(() => base(true) + t.suffix.region);
  const rivers = many(1 + TOPONYM_COUNTS.tributaries, () => base(random() < 0.4) + t.suffix.river);
  const mountains = many(TOPONYM_COUNTS.mountains, () => base(random() < 0.5) + pick(random, t.suffix.mountain));
  const hills = many(TOPONYM_COUNTS.hills, () => base(false) + t.suffix.hill);
  const lakes = many(TOPONYM_COUNTS.lakes, () => base(random() < 0.5) + pick(random, t.suffix.lake));
  const wetlands = many(TOPONYM_COUNTS.wetlands, () => base(random() < 0.5) + t.suffix.wetland);
  const pass = unique(() => base(true) + t.suffix.pass);
  const destination = unique(() => base(true) + t.suffix.destination);
  const districts = many(TOPONYM_COUNTS.districts, () => pick(random, t.districtHeads) + pick(random, t.districtTails));
  return { region, rivers, mountains, hills, lakes, wetlands, pass, destination, districts };
};

const cache = new Map<string, ToponymNames>();

/** 新聞の {place} に使う地名（小字）。saveId ごとに一度だけ作って覚えておく */
export const placeNamesFor = (saveId: string): readonly string[] => {
  let names = cache.get(saveId);
  if (!names) {
    names = generateToponymNames(saveId);
    cache.set(saveId, names);
  }
  return names.districts;
};

/**
 * 区画 (x, y) の小字の番号。十字の本通り（x = 4 の列・y = 4 の行）が0、
 * 十字で分かれた4つの区域を、それぞれ上下2つに分けて 1〜8。
 */
export const districtOf = (x: number, y: number): number => {
  if (x === 4 || y === 4) return 0;
  const quadrant = (x > 4 ? 1 : 0) + (y > 4 ? 2 : 0);
  const half = y < 4 ? (y < 2 ? 0 : 1) : y < 7 ? 0 : 1;
  return 1 + quadrant * 2 + half;
};

export interface ToponymFeatures {
  readonly villageCenter: Point;
  readonly districtAnchors: readonly Point[];
  /** 川（本流が先頭）の注記位置 */
  readonly riverAnchors: readonly Point[];
  /** 頂（高い順）と、それが「山」か「丘」か */
  readonly peaks: readonly { readonly anchor: Point; readonly mountain: boolean }[];
  readonly lakeAnchors: readonly Point[];
  readonly wetlandAnchors: readonly Point[];
  readonly passAnchor: Point | null;
  readonly destinationAnchor: Point;
}

/** 地形の特徴へ名前を割り当てる。割り当てた分だけを Toponym にする */
export const assignToponyms = (names: ToponymNames, f: ToponymFeatures): Toponym[] => {
  const out: Toponym[] = [];
  const add = (kind: ToponymKind, name: string | undefined, anchor: Point) => {
    if (name !== undefined) out.push({ kind, name, anchor });
  };
  add("region", names.region, f.villageCenter);
  f.districtAnchors.forEach((p, k) => add("district", names.districts[k], p));
  f.riverAnchors.forEach((p, k) => add("river", names.rivers[k], p));
  let m = 0;
  let h = 0;
  for (const peak of f.peaks) {
    if (peak.mountain) add("mountain", names.mountains[m++], peak.anchor);
    else add("hill", names.hills[h++], peak.anchor);
  }
  f.lakeAnchors.forEach((p, k) => add("lake", names.lakes[k], p));
  f.wetlandAnchors.forEach((p, k) => add("wetland", names.wetlands[k], p));
  if (f.passAnchor) add("pass", names.pass, f.passAnchor);
  add("destination", names.destination, f.destinationAnchor);
  return out;
};
