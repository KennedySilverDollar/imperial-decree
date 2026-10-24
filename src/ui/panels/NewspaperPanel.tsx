import type { NewspaperArticle } from "../../domain/TurnRecord";
import { renderNewspaper } from "../../engine/Newspaper";
import { messages } from "../../i18n/messages";

export function NewspaperPanel({ article }: { readonly article: NewspaperArticle | null }) {
  const n = messages.ui.newspaper;
  const rendered = article === null ? null : renderNewspaper(article);
  return (
    <section className="panel paper newspaper" aria-label={messages.ui.panels.newspaper}>
      {/* key で号ごとに紙をフェードさせる */}
      <div className="fade-in" key={article?.turn ?? 0}>
        <header className="newspaper-masthead">{rendered?.title ?? n.firstIssueTitle}</header>
        <h3 className="newspaper-headline">{rendered === null ? n.firstIssueHeadline : (rendered.headline ?? rendered.title)}</h3>
        <div className="newspaper-body">
          {rendered === null ? <p>{n.firstIssueBody}</p> : rendered.lines.map((line) => <p key={line}>{line}</p>)}
        </div>
        <p className="newspaper-note">{n.biasNote}</p>
      </div>
    </section>
  );
}
