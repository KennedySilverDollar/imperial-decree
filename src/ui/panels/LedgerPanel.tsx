import { POLITICAL_CAPITAL_MAX } from "../../domain/constants";
import type { ParamDelta, Params } from "../../domain/GameState";
import type { TurnRecord } from "../../domain/TurnRecord";
import { PARAM_KEYS, type ParamKey } from "../../domain/Vocabulary";
import { messages } from "../../i18n/messages";

// 領主の台帳（v3.2 §2.2 / X-02 / SPEC_v3.3 §6）：開いた帳簿。1ページ＝1年。
// 左の頁にその年の台帳6項目（人口・国庫・幸福度・インフラ・汚職率・政治資本）と前年比、右の頁に直近10年の鉛筆の折れ線。
// 値は各年の記録（TurnRecord の before / after）をそのまま読むだけで、計算し直さない。
// 政治資本は年ごとの記録が無いので、今の年のページにだけ書く。派生指標・労働人口・資材は載せない（CLAUDE.md §4-13 / I-31）。

const t = messages.ui.ledger;

/** 折れ線に使う年数（§6「直近10年」） */
export const LEDGER_TREND_YEARS = 10;

export interface LedgerPage {
  /** 何年目の暮れの台帳か（0 は着任時） */
  readonly year: number;
  readonly params: Params;
  /** 前年からの変化（着任時は null） */
  readonly delta: ParamDelta | null;
}

/** 着任時（0年）から最新の年までのページ */
export const ledgerPages = (history: readonly TurnRecord[], current: Params): readonly LedgerPage[] => [
  { year: 0, params: history[0]?.before ?? current, delta: null },
  ...history.map((record) => ({ year: record.turn, params: record.after, delta: record.actualResult })),
];

/** そのページまでの直近 LEDGER_TREND_YEARS 年（＋起点）の値 */
export const trendOf = (pages: readonly LedgerPage[], index: number, param: ParamKey): readonly number[] =>
  pages.slice(Math.max(0, index - LEDGER_TREND_YEARS), index + 1).map((p) => p.params[param]);

const shown = (param: ParamKey, value: number): string => t.value[param](Math.round(value));
const signed = (n: number): string => (n > 0 ? `+${n}` : String(n));

const SPARK_W = 120;
const SPARK_H = 26;

/** 鉛筆の手描き風の折れ線：点ごとにわずかに揺らし、薄い2本目を重ねる（揺れは位置で決まる見た目だけのもの） */
function Sparkline({ values, label }: { readonly values: readonly number[]; readonly label: string }) {
  if (values.length < 2) return <span className="spark-empty">{t.trendTooShort}</span>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = SPARK_W / (LEDGER_TREND_YEARS);
  const x0 = SPARK_W - step * (values.length - 1);
  const points = (wobble: number) =>
    values
      .map((v, i) => {
        const x = x0 + i * step;
        const y = SPARK_H - 3 - ((v - min) / span) * (SPARK_H - 6);
        const jitter = Math.sin((i + 1) * 7.3 + wobble) * 0.6;
        return `${x.toFixed(1)},${(y + jitter).toFixed(1)}`;
      })
      .join(" ");
  return (
    <svg
      className="sparkline"
      width={SPARK_W}
      height={SPARK_H}
      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
      <polyline className="spark-ghost" points={points(2.1)} />
      <polyline className="spark-line" points={points(0)} />
    </svg>
  );
}

interface Props {
  readonly params: Params;
  readonly politicalCapital: number;
  readonly history: readonly TurnRecord[];
  /** 開いているページ（null は最新の年） */
  readonly page: number | null;
  readonly onPage: (page: number, pageCount: number) => void;
  /** 手元にある（めくれる）か */
  readonly interactive: boolean;
}

export function LedgerPanel({ params, politicalCapital, history, page, onPage, interactive }: Props) {
  const pages = ledgerPages(history, params);
  const latest = pages.length - 1;
  const index = page === null ? latest : Math.min(Math.max(0, page), latest);
  const current = pages[index] ?? pages[latest];
  if (current === undefined) return null;
  const isLatest = index === latest;

  return (
    <section className="ledger ledger-book paper" aria-label={t.title} data-testid="ledger" data-year={current.year}>
      <div className="ledger-leaf ledger-leaf-left">
        <h2 className="ledger-title">{t.title}</h2>
        <p className="ledger-year">{current.year === 0 ? t.arrival : t.yearPage(current.year)}</p>
        <dl className="ledger-items">
          {PARAM_KEYS.map((param) => {
            const change = current.delta === null ? 0 : Math.round(current.delta[param]);
            return (
              <div key={param} className="ledger-item" data-testid={`ledger-${param}`}>
                <dt>{messages.params[param]}</dt>
                <dd>
                  {shown(param, current.params[param])}
                  {change !== 0 && <span className="ledger-delta">{signed(change)}</span>}
                </dd>
              </div>
            );
          })}
          <div className="ledger-item">
            <dt>{messages.ui.politicalCapital}</dt>
            <dd>
              {isLatest ? (
                <span className="pips" data-testid="capital" aria-label={t.capital(politicalCapital, POLITICAL_CAPITAL_MAX)}>
                  {Array.from({ length: POLITICAL_CAPITAL_MAX }, (_, i) => (
                    <span key={i} className={i < politicalCapital ? "pip filled" : "pip"} />
                  ))}
                </span>
              ) : (
                <span className="ledger-unrecorded">{t.unrecorded}</span>
              )}
            </dd>
          </div>
        </dl>
      </div>
      <div className="ledger-leaf ledger-leaf-right">
        <h3 className="ledger-subtitle">{t.trendTitle(LEDGER_TREND_YEARS)}</h3>
        <ul className="ledger-trends">
          {PARAM_KEYS.map((param) => (
            <li key={param}>
              <span className="trend-label">{messages.params[param]}</span>
              <Sparkline values={trendOf(pages, index, param)} label={t.trendLabel(messages.params[param])} />
            </li>
          ))}
        </ul>
        <div className="ledger-paging">
          <button className="button" disabled={!interactive || index === 0} onClick={() => onPage(index - 1, pages.length)}>
            {t.prevYear}
          </button>
          <span className="ledger-page-count">{t.pageOf(index + 1, pages.length)}</span>
          <button className="button" disabled={!interactive || isLatest} onClick={() => onPage(index + 1, pages.length)}>
            {t.nextYear}
          </button>
        </div>
      </div>
    </section>
  );
}
