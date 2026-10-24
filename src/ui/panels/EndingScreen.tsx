import type { Ending } from "../../domain/Ending";
import { messages } from "../../i18n/messages";

// エンディング（SPEC §7.2）：ゲームオーバー / 成功 / 時間切れ と、リスタート。

export function EndingScreen({ ending, turns, onRestart }: { readonly ending: Ending; readonly turns: number; readonly onRestart: () => void }) {
  const e = messages.ui.ending;
  const n = messages.newspaper.endings;
  const title = ending.kind === "gameover" ? e.gameoverTitle : ending.kind === "success" ? e.successTitle : e.timeoutTitle;
  const headline = ending.kind === "gameover" ? n.gameover[ending.reason] : n[ending.kind];
  const words = ending.kind === "gameover" ? e.lastWords[ending.reason] : e.lastWords[ending.kind];
  return (
    <div className="overlay fade-in" role="dialog" aria-modal="true" aria-label={title}>
      <article className={`paper ending ending-${ending.kind}`} data-testid="ending">
        <p className="ending-kicker">{title}</p>
        <h2 className="ending-headline">{headline}</h2>
        <p className="ending-words">{words}</p>
        <p className="ending-turns">{e.turns(turns)}</p>
        <div className="seal-imprint visible" aria-hidden>
          {messages.ui.decree.stamp}
        </div>
        <button className="button primary" onClick={onRestart} data-testid="restart">
          {e.restart}
        </button>
      </article>
    </div>
  );
}
