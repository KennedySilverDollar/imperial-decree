import { NOTE_CHAR_LIMIT } from "../../domain/constants";
import { noteLength, type NoteAttachment, type PlayerNote, type PlayerNotes } from "../../domain/PlayerNotes";
import { messages } from "../../i18n/messages";

// メモ帳と鉛筆（SPEC_v3.3 §7）。1枚 NOTE_CHAR_LIMIT 字まで書き、ちぎって新聞の記事・側近書簡に留める（地図の区画は U3）。
// 留め先は今年の新聞の記事と書簡から選ぶ。ちぎったメモは下に並び、留め先を替えられる。
// メモは LLM にも新聞にも渡さない（ゲームの状態とは別に保存するだけ）。入力欄は手元でだけ出す（不変条件25）。

const t = messages.ui.notes;

export interface NoteTarget {
  /** 選択肢の値（"none" は留めない） */
  readonly key: string;
  readonly label: string;
  readonly attachment: NoteAttachment | null;
}

export const NO_TARGET: NoteTarget = { key: "none", label: t.noTarget, attachment: null };

export const targetKeyOf = (a: NoteAttachment | null): string =>
  a === null ? "none" : a.kind === "article" ? `article:${a.turn}:${a.articleId}` : `aide:${a.turn}:${a.aideId}`;

export interface NoteDraft {
  readonly text: string;
  readonly target: string;
}

interface Props {
  readonly notes: PlayerNotes;
  readonly draft: NoteDraft;
  readonly onDraft: (draft: NoteDraft) => void;
  /** 今年留められる先（記事と書簡） */
  readonly targets: readonly NoteTarget[];
  /** 留め先の名前（過去の年の記事・書簡も含めて） */
  readonly placeOf: (attachment: NoteAttachment | null) => string;
  readonly onTear: (text: string, attachment: NoteAttachment | null) => void;
  readonly onAttach: (id: string, attachment: NoteAttachment | null) => void;
  readonly interactive: boolean;
}

function TornNote({ note, interactive, targets, placeOf, onAttach }: {
  readonly note: PlayerNote;
  readonly interactive: boolean;
  readonly targets: readonly NoteTarget[];
  readonly placeOf: Props["placeOf"];
  readonly onAttach: Props["onAttach"];
}) {
  const currentKey = targetKeyOf(note.attachedTo);
  const choices = targets.some((target) => target.key === currentKey)
    ? targets
    : [{ key: currentKey, label: placeOf(note.attachedTo), attachment: note.attachedTo }, ...targets];
  return (
    <li className="torn-note" data-testid="torn-note">
      <p className="torn-text">{note.text}</p>
      <p className="torn-where">
        <span>{t.year(note.turnCreated)}</span>
        {interactive ? (
          <select
            aria-label={t.moveTo}
            value={currentKey}
            onChange={(e) => onAttach(note.id, choices.find((c) => c.key === e.target.value)?.attachment ?? null)}
          >
            {choices.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        ) : (
          <span>{placeOf(note.attachedTo)}</span>
        )}
      </p>
    </li>
  );
}

export function NotepadPanel({ notes, draft, onDraft, targets, placeOf, onTear, onAttach, interactive }: Props) {
  const length = noteLength(draft.text);
  const left = NOTE_CHAR_LIMIT - length;
  const canTear = draft.text.trim() !== "" && left >= 0;
  const all = [NO_TARGET, ...targets];
  const target = all.find((c) => c.key === draft.target) ?? NO_TARGET;
  const torn = [...notes.notes].reverse();

  return (
    <section className="panel notepad" aria-label={t.title} data-testid="notepad">
      <h2 className="panel-title">{t.title}</h2>
      <div className="paper notepad-page">
        {interactive ? (
          <>
            <textarea
              className="note-text"
              aria-label={t.title}
              placeholder={t.placeholder}
              rows={3}
              value={draft.text}
              onChange={(e) => onDraft({ ...draft, text: e.target.value })}
            />
            <div className="note-tools">
              <span className={`note-count ${left < 0 ? "over" : ""}`} data-testid="note-count">
                {t.remaining(left)}
              </span>
              <label className="note-target">
                {t.attachTo}
                <select value={target.key} onChange={(e) => onDraft({ ...draft, target: e.target.value })} data-testid="note-target">
                  {all.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="button"
                disabled={!canTear}
                onClick={() => {
                  onTear(draft.text, target.attachment);
                  onDraft({ text: "", target: draft.target });
                }}
                data-testid="tear-note"
              >
                {target.attachment === null ? t.tear : t.tearAndPin}
              </button>
            </div>
          </>
        ) : (
          <p className={`note-text note-preview ${draft.text === "" ? "is-blank" : ""}`}>{draft.text === "" ? t.blank : draft.text}</p>
        )}
      </div>
      <h3 className="notepad-subtitle">{t.tornTitle(notes.notes.length)}</h3>
      {torn.length === 0 ? (
        <p className="panel-note">{t.none}</p>
      ) : (
        <ul className="torn-notes">
          {torn.map((note) => (
            <TornNote key={note.id} note={note} interactive={interactive} targets={all} placeOf={placeOf} onAttach={onAttach} />
          ))}
        </ul>
      )}
    </section>
  );
}
