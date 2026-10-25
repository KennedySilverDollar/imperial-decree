import { useEffect, useRef } from "react";
import { LETTERS_DWELL_MS } from "../../domain/constants";
import type { Newspaper } from "../../domain/News";
import { renderNewspaper } from "../../engine/Newspaper";
import { messages } from "../../i18n/messages";

// 新聞（v3.2 §1.2）：第一面を大きく、残りの欄（社会・経済・行政・治安・投書・広告・天候）を2段に組む。1画面に5〜7記事。
// 紙面の生成はエンジン側で済んでいる。真実度や偏向の内訳は出さない（CLAUDE.md §4-13）。
// 計測（v3.2 §3.2）：号ごとの閲覧時間（ポインタかフォーカスが紙面にあった時間）と、投書欄の参照。

export interface NewspaperReading {
  readonly issueTurn: number;
  readonly dwellMs: number;
  readonly articleCount: number;
  readonly hasLetters: boolean;
}

interface Props {
  readonly newspaper: Newspaper | null;
  readonly onRead: (reading: NewspaperReading) => void;
  readonly onLettersRead: (issueTurn: number, articleIds: readonly string[], dwellMs: number) => void;
}

/** 区間の滞在時間を測る小さな時計（開始していなければ 0） */
const useStopwatch = () => {
  const since = useRef<number | null>(null);
  const total = useRef(0);
  return {
    start: () => {
      if (since.current === null) since.current = performance.now();
    },
    stop: () => {
      if (since.current !== null) total.current += performance.now() - since.current;
      since.current = null;
    },
    /** 測った合計を返してゼロに戻す */
    take: () => {
      const running = since.current === null ? 0 : performance.now() - since.current;
      const value = total.current + running;
      total.current = 0;
      since.current = since.current === null ? null : performance.now();
      return Math.round(value);
    },
    peek: () => total.current + (since.current === null ? 0 : performance.now() - since.current),
  };
};

export function NewspaperPanel({ newspaper, onRead, onLettersRead }: Props) {
  const n = messages.ui.newspaper;
  const rendered = newspaper === null ? null : renderNewspaper(newspaper);
  const issueTurn = newspaper?.turn ?? 0;
  const reading = useStopwatch();
  const letters = useStopwatch();
  const lettersLogged = useRef(false);
  const callbacks = useRef({ onRead, onLettersRead });
  callbacks.current = { onRead, onLettersRead };

  const letterIds = newspaper?.articles.filter((a) => a.section === "letters").map((a) => a.id) ?? [];
  const summary = useRef({ articleCount: 0, hasLetters: false, letterIds: [] as readonly string[] });
  summary.current = { articleCount: newspaper?.articles.length ?? 0, hasLetters: letterIds.length > 0, letterIds };

  // 号が替わるとき（と画面を閉じるとき）に、その号の閲覧時間を送る
  useEffect(() => {
    lettersLogged.current = false;
    return () => {
      const dwellMs = reading.take();
      letters.take();
      const s = summary.current;
      callbacks.current.onRead({ issueTurn, dwellMs, articleCount: s.articleCount, hasLetters: s.hasLetters });
    };
    // reading / letters は ref の集まりなので依存に入れない（号が替わるときだけ送る）
  }, [issueTurn]);

  // タブを離れている間は数えない
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        reading.stop();
        letters.stop();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const leaveLetters = () => {
    letters.stop();
    if (!lettersLogged.current && letters.peek() >= LETTERS_DWELL_MS) {
      lettersLogged.current = true;
      callbacks.current.onLettersRead(issueTurn, summary.current.letterIds, letters.take());
    }
  };

  const [front, ...rest] = rendered?.articles ?? [];
  return (
    <section
      className="panel paper newspaper"
      aria-label={messages.ui.panels.newspaper}
      data-testid="newspaper"
      onPointerEnter={reading.start}
      onPointerLeave={reading.stop}
      onFocus={reading.start}
      onBlur={reading.stop}
    >
      {/* key で号ごとに紙をフェードさせる */}
      <div className="fade-in" key={issueTurn}>
        <header className="newspaper-masthead">{rendered?.title ?? n.firstIssueTitle}</header>
        {rendered === null ? (
          <article className="news-article news-front">
            <h3 className="newspaper-headline">{n.firstIssueHeadline}</h3>
            <p className="news-body">{n.firstIssueBody}</p>
          </article>
        ) : (
          <>
            {front && (
              <article className="news-article news-front" data-section={front.sectionId}>
                <div className="newspaper-section">{front.section}</div>
                <h3 className="newspaper-headline">{front.headline}</h3>
                {front.body.map((line, j) => (
                  <p className="news-body" key={j}>
                    {line}
                  </p>
                ))}
              </article>
            )}
            <div className="news-columns">
              {rest.map((article, i) => {
                const isLetter = article.sectionId === "letters";
                return (
                  <article
                    className={`news-article news-${article.sectionId}`}
                    key={i}
                    data-section={article.sectionId}
                    data-testid={isLetter ? "news-letter" : undefined}
                    tabIndex={isLetter ? 0 : undefined}
                    onPointerEnter={isLetter ? letters.start : undefined}
                    onPointerLeave={isLetter ? leaveLetters : undefined}
                    onFocus={isLetter ? letters.start : undefined}
                    onBlur={isLetter ? leaveLetters : undefined}
                  >
                    <div className="newspaper-section">{article.section}</div>
                    <h4 className="newspaper-subhead">{article.headline}</h4>
                    {article.body.map((line, j) => (
                      <p className="news-body" key={j}>
                        {line}
                      </p>
                    ))}
                  </article>
                );
              })}
            </div>
          </>
        )}
        <p className="newspaper-note">{n.biasNote}</p>
      </div>
    </section>
  );
}
