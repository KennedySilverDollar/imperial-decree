import { useEffect, useRef } from "react";
import { LETTERS_DWELL_MS } from "../../domain/constants";
import type { Newspaper, Section } from "../../domain/News";
import type { PlayerNote } from "../../domain/PlayerNotes";
import { renderNewspaper } from "../../engine/Newspaper";
import type { BuildingId } from "../../domain/Buildings";
import { RefText } from "../reading/RefText";
import type { MapRefTerm } from "../reading/mapRefs";

/** 記事が扱う建物の名を、地図の区画のしるしに結ぶ（並べ読み） */
const buildingTerms = (building: BuildingId | null): readonly MapRefTerm[] =>
  building === null ? [] : [{ term: messages.targets[building], ref: { kind: "building", building } }];
import { messages } from "../../i18n/messages";
import { PinnedNotes } from "./PinnedNotes";

// 新聞（v3.2 §1.2 / SPEC_v3.3 §3.2）：広げて読み、紙面をめくる。第一面（第一面・社会・経済・行政）と二面（治安・投書・広告・天候）。
// 第一面の下に「二面へ続く」として二面の欄を書き出し、投書などを見落とさないようにする。
// 紙面の生成はエンジン側で済んでいる。真実度や偏向の内訳は出さない（CLAUDE.md §4-13）。
// 計測（v3.2 §3.2）：号ごとの閲覧時間（ポインタかフォーカスが紙面にあった時間）と、投書欄の参照。

export interface NewspaperReading {
  readonly issueTurn: number;
  readonly dwellMs: number;
  readonly articleCount: number;
  readonly hasLetters: boolean;
}

const FIRST_PAGE_SECTIONS: readonly Section[] = ["front", "social", "economy", "administration"];

/** 紙面を面に分ける（第一面に載らない欄は二面へ）。二面が空なら1面だけ */
export const newspaperPages = <A extends { readonly sectionId: Section }>(articles: readonly A[]): readonly (readonly A[])[] => {
  const first = articles.filter((a) => FIRST_PAGE_SECTIONS.includes(a.sectionId));
  const second = articles.filter((a) => !FIRST_PAGE_SECTIONS.includes(a.sectionId));
  return second.length === 0 ? [first] : [first, second];
};

interface Props {
  readonly newspaper: Newspaper | null;
  /** いま開いている面（0 始まり。机の UI ストアが号ごとに持つ） */
  readonly page: number;
  readonly onPage: (page: number, pageCount: number) => void;
  /** 手元にある（めくれる）か */
  readonly interactive: boolean;
  /** 記事に留めたメモ */
  readonly notesFor: (articleId: string) => readonly PlayerNote[];
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

export function NewspaperPanel({ newspaper, page, onPage, interactive, notesFor, onRead, onLettersRead }: Props) {
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

  const articles = (rendered?.articles ?? []).map((a, i) => ({ ...a, id: newspaper?.articles[i]?.id ?? String(i) }));
  const pages = newspaperPages(articles);
  const current = Math.min(page, pages.length - 1);
  const shown = pages[current] ?? [];
  const [front, ...rest] = current === 0 ? shown : [undefined, ...shown];
  const nextSections = pages[1]?.map((a) => a.section) ?? [];

  return (
    <section
      className="panel paper newspaper"
      aria-label={messages.ui.panels.newspaper}
      data-testid="newspaper"
      data-page={current}
      onPointerEnter={reading.start}
      onPointerLeave={reading.stop}
      onFocus={reading.start}
      onBlur={reading.stop}
    >
      {/* key で号・面ごとに紙をフェードさせる */}
      <div className="fade-in" key={`${issueTurn}-${current}`}>
        <header className="newspaper-masthead">
          <span>{rendered?.title ?? n.firstIssueTitle}</span>
          {pages.length > 1 && <span className="newspaper-page">{n.pageName(current)}</span>}
        </header>
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
                <h3 className="newspaper-headline">
                  <RefText text={front.headline} buildings={buildingTerms(front.relatedBuilding)} />
                </h3>
                {front.body.map((line, j) => (
                  <p className="news-body" key={j}>
                    <RefText text={line} buildings={buildingTerms(front.relatedBuilding)} />
                  </p>
                ))}
                <PinnedNotes notes={notesFor(front.id)} />
              </article>
            )}
            <div className="news-columns">
              {rest.map((article) => {
                if (article === undefined) return null;
                const isLetter = article.sectionId === "letters";
                return (
                  <article
                    className={`news-article news-${article.sectionId}`}
                    key={article.id}
                    data-section={article.sectionId}
                    data-testid={isLetter ? "news-letter" : undefined}
                    tabIndex={isLetter ? 0 : undefined}
                    onPointerEnter={isLetter ? letters.start : undefined}
                    onPointerLeave={isLetter ? leaveLetters : undefined}
                    onFocus={isLetter ? letters.start : undefined}
                    onBlur={isLetter ? leaveLetters : undefined}
                  >
                    <div className="newspaper-section">{article.section}</div>
                    <h4 className="newspaper-subhead">
                      <RefText text={article.headline} buildings={buildingTerms(article.relatedBuilding)} />
                    </h4>
                    {article.body.map((line, j) => (
                      <p className="news-body" key={j}>
                        <RefText text={line} buildings={buildingTerms(article.relatedBuilding)} />
                      </p>
                    ))}
                    <PinnedNotes notes={notesFor(article.id)} />
                  </article>
                );
              })}
            </div>
            {current === 0 && nextSections.length > 0 && <p className="newspaper-continued">{n.continued(nextSections)}</p>}
          </>
        )}
        <footer className="newspaper-footer">
          <p className="newspaper-note">{n.biasNote}</p>
          {pages.length > 1 && (
            <div className="newspaper-paging">
              <button className="button" disabled={!interactive || current === 0} onClick={() => onPage(current - 1, pages.length)}>
                {n.prevPage}
              </button>
              <button
                className="button"
                disabled={!interactive || current >= pages.length - 1}
                onClick={() => onPage(current + 1, pages.length)}
                data-testid="newspaper-next"
              >
                {n.nextPage}
              </button>
            </div>
          )}
        </footer>
      </div>
    </section>
  );
}
