import type { PlayerNote } from "../../domain/PlayerNotes";
import { messages } from "../../i18n/messages";

// 書類に留めたメモ（SPEC_v3.3 §7）：記事・書簡の下に小さな紙片として貼り、中身（60字まで）をそのまま見せる。
// かざさないと読めない畳み方は、キー操作や読み上げで引っかかるのでやめた。

export function PinnedNotes({ notes }: { readonly notes: readonly PlayerNote[] }) {
  if (notes.length === 0) return null;
  return (
    <ul className="pinned-notes" aria-label={messages.ui.notes.pinnedLabel}>
      {notes.map((note) => (
        <li key={note.id} className="pinned-note" tabIndex={0} data-testid="pinned-note">
          <span className="pinned-tab">{messages.ui.notes.slip}</span>
          <span className="pinned-text">{note.text}</span>
        </li>
      ))}
    </ul>
  );
}
