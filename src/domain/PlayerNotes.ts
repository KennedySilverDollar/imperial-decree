import { PLAYER_NOTE_MAX_CHARS, PLAYER_NOTES_MAX_COUNT } from "./constants";

// プレイヤーのメモ（SPEC_v3.3 §5.7・SPEC_v3.4 §7.2、DECISIONS AA-11）。地図の区画に留める書き付け。
// ゲームの状態（GameState）にもセーブ（SAVE_STORAGE_KEY）にも入らず、ロジックに一切影響しない。
// 保存は別のキー（PLAYER_NOTES_STORAGE_KEY）に saveId ごと。ここは純関数だけ（保存は ui/notes/notesStore.ts）。

export interface PlayerNote {
  readonly id: string;
  /** 区画（0..99 = y × 10 + x） */
  readonly gridIndex: number;
  readonly text: string;
  /** 書き付けた年 */
  readonly turn: number;
}

const GRID_CELLS = 100;

/** 本文を整える：前後の空白を除き、上限の文字数（コードポイント）で切る。空なら null */
export const normalizeNoteText = (text: string): string | null => {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length === 0) return null;
  return [...trimmed].slice(0, PLAYER_NOTE_MAX_CHARS).join("");
};

/** 書き付けを足す。本文が空・区画が範囲外・上限に達しているときは元のまま。ID は年と区画と通し番号から決める（乱数を使わない） */
export const addNote = (notes: readonly PlayerNote[], gridIndex: number, text: string, turn: number): readonly PlayerNote[] => {
  const body = normalizeNoteText(text);
  if (body === null || !Number.isInteger(gridIndex) || gridIndex < 0 || gridIndex >= GRID_CELLS) return notes;
  if (notes.length >= PLAYER_NOTES_MAX_COUNT) return notes;
  let n = notes.length;
  let id = `${turn}-${gridIndex}-${n}`;
  const used = new Set(notes.map((x) => x.id));
  while (used.has(id)) id = `${turn}-${gridIndex}-${++n}`;
  return [...notes, { id, gridIndex, text: body, turn }];
};

export const removeNote = (notes: readonly PlayerNote[], id: string): readonly PlayerNote[] => notes.filter((n) => n.id !== id);

export const notesAt = (notes: readonly PlayerNote[], gridIndex: number): readonly PlayerNote[] => notes.filter((n) => n.gridIndex === gridIndex);

/** 保存から読んだ値を検める（壊れた・古い値は捨てる） */
export const parseNotes = (value: unknown): readonly PlayerNote[] => {
  if (!Array.isArray(value)) return [];
  const out: PlayerNote[] = [];
  for (const v of value) {
    if (typeof v !== "object" || v === null) continue;
    const r = v as Record<string, unknown>;
    if (typeof r.id !== "string" || typeof r.text !== "string" || typeof r.gridIndex !== "number" || typeof r.turn !== "number") continue;
    const text = normalizeNoteText(r.text);
    if (text === null || !Number.isInteger(r.gridIndex) || r.gridIndex < 0 || r.gridIndex >= GRID_CELLS) continue;
    out.push({ id: r.id, gridIndex: r.gridIndex, text, turn: r.turn });
    if (out.length >= PLAYER_NOTES_MAX_COUNT) break;
  }
  return out;
};
