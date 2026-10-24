import { Effect } from "effect";
import { NEWSPAPER_BIAS, NEWSPAPER_TONE_CHANCE, PERCENT, REPORT_MIN_DELTA } from "../domain/constants";
import type { Ending } from "../domain/Ending";
import type { Params } from "../domain/GameState";
import type { NewspaperArticle, NewspaperLine, NewspaperTone } from "../domain/TurnRecord";
import { PARAM_KEYS, type ParamKey } from "../domain/Vocabulary";
import { messages } from "../i18n/messages";
import { chance, randRange, type Rng } from "../services/Rng";

// 新聞（SPEC §4.1 / BALANCE §7）。LLM は使わずテンプレート＋スロットで生成する。
// 偏向度 NEWSPAPER_BIAS：数値に ±BIAS% の対称ノイズ、論調は政府寄り（悪化は控えめ、改善は誇張）。

const NOISE_RATIO = NEWSPAPER_BIAS / PERCENT;

const trendOf = (delta: number): NewspaperLine["trend"] =>
  delta >= REPORT_MIN_DELTA ? "up" : delta <= -REPORT_MIN_DELTA ? "down" : "flat";

const isImprovement = (param: ParamKey, trend: NewspaperLine["trend"]): boolean =>
  param === "corruption" ? trend === "down" : trend === "up";

export const generateNewspaper = (
  turn: number,
  before: Params,
  after: Params,
  ending: Ending | null,
): Effect.Effect<NewspaperArticle, never, Rng> =>
  Effect.gen(function* () {
    const lines: NewspaperLine[] = [];
    for (const param of PARAM_KEYS) {
      const noise = yield* randRange(-NOISE_RATIO, NOISE_RATIO);
      const trend = trendOf(after[param] - before[param]);
      const biased = trend !== "flat" && (yield* chance(NEWSPAPER_TONE_CHANCE));
      const tone: NewspaperTone = !biased ? "neutral" : isImprovement(param, trend) ? "boast" : "euphemism";
      lines.push({ param, reportedValue: after[param] * (1 + noise), trend, tone });
    }
    // 見出し：前年比の変化率が最も大きい項目
    const ranked = [...lines].sort(
      (a, b) => relativeChange(b.param, before, after) - relativeChange(a.param, before, after),
    );
    const top = ranked[0];
    return { turn, headline: top !== undefined && top.trend !== "flat" ? top : null, lines, ending };
  });

const relativeChange = (param: ParamKey, before: Params, after: Params): number =>
  Math.abs(after[param] - before[param]) / Math.max(1, Math.abs(before[param]));

export interface RenderedNewspaper {
  readonly title: string;
  readonly headline: string | null;
  readonly lines: readonly string[];
}

export const renderNewspaper = (article: NewspaperArticle): RenderedNewspaper => {
  const n = messages.newspaper;
  const endingHeadline =
    article.ending === null
      ? null
      : article.ending.kind === "gameover"
        ? n.endings.gameover[article.ending.reason]
        : n.endings[article.ending.kind];
  const headline =
    endingHeadline ??
    (article.headline === null
      ? null
      : n.headline[article.headline.tone][article.headline.trend](messages.params[article.headline.param]));
  return {
    title: n.title(article.turn),
    headline,
    lines: article.lines.map((line) =>
      n.line(messages.params[line.param], line.reportedValue, n.trendWords[line.tone][line.trend]),
    ),
  };
};
