import type { PlayerNote } from "../../domain/PlayerNotes";
import type { TurnRecord } from "../../domain/TurnRecord";
import { messages } from "../../i18n/messages";
import { ReportLetter } from "./AidePanel";
import { NewspaperPanel, type NewspaperReading } from "./NewspaperPanel";
import { ResultStack } from "./ResultStack";

// 既決箱（SPEC_v3.3 §3.2）：過ぎた年の新聞・側近書簡・結果の書類束を取り出して読み返す。
// 年と書類を選ぶと、机の上と同じ部品で読める（書簡は既に開封済み、結果の束は机に戻すボタンなし）。

const t = messages.ui.archive;

export type ArchiveDoc = "newspaper" | "letters" | "result";
const DOCS: readonly ArchiveDoc[] = ["newspaper", "letters", "result"];

interface Props {
  readonly history: readonly TurnRecord[];
  /** 取り出している年（null はまだ選んでいない） */
  readonly turn: number | null;
  readonly doc: ArchiveDoc;
  readonly onSelect: (turn: number | null, doc: ArchiveDoc) => void;
  /** 取り出した書類のめくり位置 */
  readonly page: number;
  readonly onPage: (page: number, count: number) => void;
  readonly interactive: boolean;
  readonly articleNotes: (turn: number, articleId: string) => readonly PlayerNote[];
  readonly letterNotes: (turn: number, aideId: string) => readonly PlayerNote[];
  readonly onRead: (reading: NewspaperReading) => void;
  readonly onLettersRead: (issueTurn: number, articleIds: readonly string[], dwellMs: number) => void;
}

export function ArchivePanel({ history, turn, doc, onSelect, page, onPage, interactive, articleNotes, letterNotes, onRead, onLettersRead }: Props) {
  const record = turn === null ? undefined : history.find((r) => r.turn === turn);
  const years = [...history].reverse();
  return (
    <section className="panel archive" aria-label={t.title} data-testid="archive">
      <h2 className="panel-title">{t.title}</h2>
      <div className="archive-box">
        {years.length === 0 ? (
          <p className="panel-note">{t.empty}</p>
        ) : (
          <>
            <p className="archive-count">{t.count(years.length)}</p>
            <div className="archive-years" role="group" aria-label={t.yearsLabel}>
              {years.map((r) => (
                <button
                  key={r.turn}
                  className={`archive-year ${r.turn === turn ? "is-selected" : ""}`}
                  aria-pressed={r.turn === turn}
                  disabled={!interactive}
                  onClick={() => onSelect(r.turn === turn ? null : r.turn, doc)}
                  data-testid={`archive-year-${r.turn}`}
                >
                  {t.year(r.turn)}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      {record !== undefined && (
        <div className="archive-reader">
          <div className="archive-docs" role="group" aria-label={t.docsLabel}>
            {DOCS.map((d) => (
              <button
                key={d}
                className={`button ${d === doc ? "is-selected" : ""}`}
                aria-pressed={d === doc}
                disabled={!interactive}
                onClick={() => onSelect(record.turn, d)}
                data-testid={`archive-doc-${d}`}
              >
                {t.docs[d]}
              </button>
            ))}
          </div>
          {doc === "newspaper" && (
            <NewspaperPanel
              newspaper={record.newspaper}
              page={page}
              onPage={onPage}
              interactive={interactive}
              notesFor={(articleId) => articleNotes(record.newspaper.turn, articleId)}
              onRead={onRead}
              onLettersRead={onLettersRead}
            />
          )}
          {doc === "letters" && (
            <div className="archive-letters">
              {record.aideReports.length === 0 ? (
                <p className="panel-note">{t.noLetters}</p>
              ) : (
                record.aideReports.map((report) => (
                  <div className="paper letter" key={report.aideId}>
                    <ReportLetter report={report} notes={letterNotes(record.turn, report.aideId)} />
                  </div>
                ))
              )}
            </div>
          )}
          {doc === "result" && <ResultStack record={record} top={page} onFlip={onPage} inHand={interactive} archived />}
        </div>
      )}
    </section>
  );
}
