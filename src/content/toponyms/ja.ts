// 地名の語（日本語）。SPEC_v3.3 §5.5。新聞の記事テンプレートと同じく、文面のデータとして content/ に置く（DECISIONS I-15）。
// どの語を使うかは domain/Landscape の筋書き（saveId から決まる番号）で選び、組み立ては engine/Gazetteer が行う。

import type { FeatureKind, Zone } from "../../domain/Landscape";

export const TOPONYM_WORDS = {
  /** 川の名 */
  river: ["鷺川", "葦川", "白瀬川", "小鮎川", "鳴瀬川", "柳川", "笹川", "玉川"],
  /** 丘の名 */
  hill: ["松ヶ丘", "鐘撞丘", "烏丘", "狐丘", "見晴らし丘", "物見丘", "桐ヶ丘"],
  /** 森の名 */
  forest: ["杉の森", "樫の森", "楢林", "檜の森", "栗林", "椎の森", "朴の林"],
  /** 沼の名 */
  lake: ["鴨沼", "菱沼", "蓮沼", "葦沼", "古沼", "鷭沼"],
  /** 野の名（沼の無い辺） */
  plain: ["若草野", "広野", "稲田原", "麦野", "萩原", "菜の原"],
  /** 領地の名（地図の表題） */
  region: ["鷺ノ郷", "葦原郷", "白瀬郷", "柳ヶ郷", "笹野郷", "玉ノ郷", "桐生郷"],
} as const satisfies Record<FeatureKind | "region", readonly string[]>;

/** 区域の方角の語 */
export const ZONE_DIRECTION: Readonly<Record<Zone, string>> = {
  northwest: "北西",
  north: "北",
  northeast: "北東",
  west: "西",
  center: "中",
  east: "東",
  southwest: "南西",
  south: "南",
  southeast: "南東",
};

/** 地形の名から、村域の側の言い方を作る（「鷺川沿い」「松ヶ丘の麓」など） */
export const FEATURE_PHRASE: Readonly<Record<FeatureKind, (name: string) => string>> = {
  river: (name) => `${name}沿い`,
  hill: (name) => `${name}の麓`,
  forest: (name) => `${name}の外れ`,
  lake: (name) => `${name}の手前`,
  plain: (name) => name,
};

/** 区域の名：「北の松ヶ丘の麓」「東の鷺川沿い」。中の区域は「本町」 */
export const zoneName = (direction: string, phrase: string): string => `${direction}の${phrase}`;
export const CENTER_ZONE_NAME = "本町";

/** 区画の名：「北の松ヶ丘の麓 三番」 */
export const parcelName = (zone: string, ordinal: number): string => `${zone} ${kanjiNumber(ordinal)}番`;

const DIGITS = ["〇", "一", "二", "三", "四", "五", "六", "七", "八", "九"] as const;

/** 1〜99 の漢数字（十六、二十 など） */
export const kanjiNumber = (n: number): string => {
  if (n < 10) return DIGITS[n] ?? String(n);
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return `${tens === 1 ? "" : (DIGITS[tens] ?? "")}十${ones === 0 ? "" : (DIGITS[ones] ?? "")}`;
};
