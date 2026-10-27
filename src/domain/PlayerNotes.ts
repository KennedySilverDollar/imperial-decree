import { NOTE_CHAR_LIMIT, NOTES_SCHEMA_VERSION } from "./constants";

// プレイヤーのメモ（SPEC_v3.3 §7・§11.1）。ゲームのロジックには一切影響しない。
// GameState とは別に保存し（DECISIONS AA-11）、参謀（LLM）にも新聞にも渡さない。
// domain は Effect 非依存のため、SPEC の Option の代わりに null を使う（I-01）。

/** 留め先。地図の区画（parcel）は U3 で足す */
export type NoteAttachment =
  | { readonly kind: "article"; readonly turn: number; readonly articleId: string }
  | { readonly kind: "aideReport"; readonly turn: number; readonly aideId: string };

export interface PlayerNote {
  readonly id: string;
  /** NOTE_CHAR_LIMIT 字まで */
  readonly text: string;
  readonly turnCreated: number;
  readonly attachedTo: NoteAttachment | null;
}

export interface PlayerNotes {
  readonly schemaVersion: typeof NOTES_SCHEMA_VERSION;
  /** どの領地のメモか。始め直した領地には前の領地のメモを持ち込まない */
  readonly saveId: string;
  readonly notes: readonly PlayerNote[];
}

export type NoteIssue = { readonly kind: "empty" } | { readonly kind: "tooLong"; readonly length: number; readonly limit: number };

export const emptyNotes = (saveId: string): PlayerNotes => ({ schemaVersion: NOTES_SCHEMA_VERSION, saveId, notes: [] });

/** 文字数はコードポイントで数える（勅令の本文と同じ。D-31） */
export const noteLength = (text: string): number => [...text].length;

export const validateNoteText = (text: string): NoteIssue | null => {
  if (text.trim() === "") return { kind: "empty" };
  const length = noteLength(text);
  return length > NOTE_CHAR_LIMIT ? { kind: "tooLong", length, limit: NOTE_CHAR_LIMIT } : null;
};

export const sameAttachment = (a: NoteAttachment | null, b: NoteAttachment | null): boolean => {
  if (a === null || b === null) return a === b;
  if (a.kind === "article" && b.kind === "article") return a.turn === b.turn && a.articleId === b.articleId;
  if (a.kind === "aideReport" && b.kind === "aideReport") return a.turn === b.turn && a.aideId === b.aideId;
  return false;
};

/** メモをちぎって足す。本文が空・長すぎるときは足さずに理由を返す */
export const addNote = (
  notes: PlayerNotes,
  note: PlayerNote,
): { readonly notes: PlayerNotes; readonly issue: null } | { readonly notes: PlayerNotes; readonly issue: NoteIssue } => {
  const issue = validateNoteText(note.text);
  if (issue !== null) return { notes, issue };
  return { notes: { ...notes, notes: [...notes.notes, { ...note, text: note.text.trim() }] }, issue: null };
};

export const attachNote = (notes: PlayerNotes, id: string, attachedTo: NoteAttachment | null): PlayerNotes => ({
  ...notes,
  notes: notes.notes.map((n) => (n.id === id ? { ...n, attachedTo } : n)),
});

export const removeNote = (notes: PlayerNotes, id: string): PlayerNotes => ({ ...notes, notes: notes.notes.filter((n) => n.id !== id) });

export const notesAttachedTo = (notes: PlayerNotes, target: NoteAttachment): readonly PlayerNote[] =>
  notes.notes.filter((n) => sameAttachment(n.attachedTo, target));

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

const parseAttachment = (raw: unknown): NoteAttachment | null | undefined => {
  if (raw === null) return null;
  if (!isRecord(raw) || typeof raw.turn !== "number" || !Number.isInteger(raw.turn)) return undefined;
  if (raw.kind === "article" && typeof raw.articleId === "string") return { kind: "article", turn: raw.turn, articleId: raw.articleId };
  if (raw.kind === "aideReport" && typeof raw.aideId === "string") return { kind: "aideReport", turn: raw.turn, aideId: raw.aideId };
  return undefined;
};

const parseNote = (raw: unknown): PlayerNote | null => {
  if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.text !== "string" || typeof raw.turnCreated !== "number") return null;
  if (validateNoteText(raw.text) !== null) return null;
  const attachedTo = parseAttachment(raw.attachedTo ?? null);
  if (attachedTo === undefined) return null;
  return { id: raw.id, text: raw.text, turnCreated: raw.turnCreated, attachedTo };
};

/**
 * 保存されていた値を読む。無い・壊れている・版が違う・別の領地のものは空として扱い、
 * 個々の壊れたメモは捨てて残りを読む（既存のセーブを持つ人は、メモが空の状態から始まる）。
 */
export const parsePlayerNotes = (raw: unknown, saveId: string): PlayerNotes => {
  if (!isRecord(raw) || raw.schemaVersion !== NOTES_SCHEMA_VERSION || raw.saveId !== saveId || !Array.isArray(raw.notes)) {
    return emptyNotes(saveId);
  }
  return { ...emptyNotes(saveId), notes: raw.notes.map(parseNote).filter((n): n is PlayerNote => n !== null) };
};
