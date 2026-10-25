import { POLITICAL_CAPITAL_MAX } from "../../domain/constants";
import type { ParamDelta, Params } from "../../domain/GameState";
import { PARAM_KEYS, type ParamKey } from "../../domain/Vocabulary";
import { messages } from "../../i18n/messages";

// 領主の台帳（v3.2 §2.2 / X-02）：人口・国庫・幸福度・インフラ・汚職率・政治資本の6項目だけを常時表示する。
// 派生指標・労働人口・資材は出さない（CLAUDE.md §4-13 / DECISIONS I-31）。

const t = messages.ui.ledger;

const shown = (param: ParamKey, value: number): string => t.value[param](Math.round(value));
const signed = (n: number): string => (n > 0 ? `+${n}` : String(n));

interface Props {
  readonly params: Params;
  /** 前年からの変化（初年は null） */
  readonly delta: ParamDelta | null;
  readonly politicalCapital: number;
}

export function LedgerPanel({ params, delta, politicalCapital }: Props) {
  return (
    <section className="ledger paper" aria-label={t.title} data-testid="ledger">
      <h2 className="ledger-title">{t.title}</h2>
      <dl className="ledger-items">
        {PARAM_KEYS.map((param) => {
          const change = delta === null ? 0 : Math.round(delta[param]);
          return (
            <div key={param} className="ledger-item" data-testid={`ledger-${param}`}>
              <dt>{messages.params[param]}</dt>
              <dd>
                {shown(param, params[param])}
                {change !== 0 && <span className="ledger-delta">{signed(change)}</span>}
              </dd>
            </div>
          );
        })}
        <div className="ledger-item">
          <dt>{messages.ui.politicalCapital}</dt>
          <dd>
            <span className="pips" data-testid="capital" aria-label={t.capital(politicalCapital, POLITICAL_CAPITAL_MAX)}>
              {Array.from({ length: POLITICAL_CAPITAL_MAX }, (_, i) => (
                <span key={i} className={i < politicalCapital ? "pip filled" : "pip"} />
              ))}
            </span>
          </dd>
        </div>
      </dl>
    </section>
  );
}
