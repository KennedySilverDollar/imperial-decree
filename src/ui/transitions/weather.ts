import { VOCABULARY } from "../../content/newspaper/ja";
import type { Newspaper } from "../../domain/News";

// 窓の光の天候（SPEC_v3.3 §4.5-3）：その年の新聞の天候欄（N-19「{season}の便り」）の季節に合わせる。
// 凶作の年（E-02「日照りと長雨」）は雨。新聞を読むだけで、ゲームの状態には触れない。

export type Season = "spring" | "summer" | "autumn" | "winter";
export type Sky = "clear" | "rain";

export interface Weather {
  readonly season: Season;
  readonly sky: Sky;
}

const SEASON_IDS: readonly Season[] = ["spring", "summer", "autumn", "winter"];

/** 着任時（新聞が無い年）の天候 */
export const DEFAULT_WEATHER: Weather = { season: "spring", sky: "clear" };

export const weatherOf = (newspaper: Newspaper | null): Weather => {
  if (newspaper === null) return DEFAULT_WEATHER;
  const weatherArticle = newspaper.articles.find((a) => a.id === "N-19");
  const famine = newspaper.articles.find((a) => a.id === "E-02");
  // 季節の語は VOCABULARY.seasons（春・夏・秋・冬）の順。見出し「{season}の便り」から取る
  const text = weatherArticle?.headline ?? famine?.headline ?? "";
  const index = VOCABULARY.seasons.findIndex((s) => text.startsWith(s));
  return { season: SEASON_IDS[index] ?? DEFAULT_WEATHER.season, sky: famine ? "rain" : "clear" };
};
