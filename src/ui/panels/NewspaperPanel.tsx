import type { Newspaper } from "../../domain/News";
import { renderNewspaper } from "../../engine/Newspaper";
import { messages } from "../../i18n/messages";

// 新聞（v3.2 §1）。紙面の生成はエンジン側で済んでおり、ここは並べて描くだけ。
// 記事の truthfulness や偏向の内訳は出さない（CLAUDE.md §4-13）。

export function NewspaperPanel({ newspaper }: { readonly newspaper: Newspaper | null }) {
  const n = messages.ui.newspaper;
  const rendered = newspaper === null ? null : renderNewspaper(newspaper);
  return (
    <section className="panel paper newspaper" aria-label={messages.ui.panels.newspaper}>
      {/* key で号ごとに紙をフェードさせる */}
      <div className="fade-in" key={newspaper?.turn ?? 0}>
        <header className="newspaper-masthead">{rendered?.title ?? n.firstIssueTitle}</header>
        {rendered === null ? (
          <>
            <h3 className="newspaper-headline">{n.firstIssueHeadline}</h3>
            <div className="newspaper-body">
              <p>{n.firstIssueBody}</p>
            </div>
          </>
        ) : (
          rendered.articles.map((article, i) => (
            <article className="newspaper-article" key={i}>
              <div className="newspaper-section">{article.section}</div>
              <h3 className={i === 0 ? "newspaper-headline" : "newspaper-subhead"}>{article.headline}</h3>
              <div className="newspaper-body">
                {article.body.map((line, j) => (
                  <p key={j}>{line}</p>
                ))}
              </div>
            </article>
          ))
        )}
        <p className="newspaper-note">{n.biasNote}</p>
      </div>
    </section>
  );
}
