import { useCallback, useEffect, useState } from "react";
import { NOTES_STORAGE_KEY } from "../../domain/constants";
import { emptyNotes, parsePlayerNotes, type PlayerNotes } from "../../domain/PlayerNotes";

// メモの保存（DECISIONS AA-11）：ゲームのセーブ（SaveService・imperial-decree/save）とは別のキーに置く。
// 既存のセーブには手を触れず、キーが無ければ空のメモ帳から始まる。表現層が書き込めるのはメモと設定だけ（不変条件17）。

export type NotesStorage = Pick<Storage, "getItem" | "setItem">;

export const loadNotes = (storage: NotesStorage | null, saveId: string): PlayerNotes => {
  if (storage === null) return emptyNotes(saveId);
  try {
    const raw = storage.getItem(NOTES_STORAGE_KEY);
    return raw === null ? emptyNotes(saveId) : parsePlayerNotes(JSON.parse(raw), saveId);
  } catch {
    return emptyNotes(saveId);
  }
};

export const saveNotes = (storage: NotesStorage | null, notes: PlayerNotes): void => {
  try {
    storage?.setItem(NOTES_STORAGE_KEY, JSON.stringify(notes));
  } catch {
    // 保存できなくても、この画面の間はメモが残る
  }
};

/** 今の領地のメモ帳。領地（saveId）が替わったら、その領地のメモを読み直す */
export const usePlayerNotes = (
  storage: NotesStorage | null,
  saveId: string | null,
): readonly [PlayerNotes | null, (update: (notes: PlayerNotes) => PlayerNotes) => void] => {
  const [notes, setNotes] = useState<PlayerNotes | null>(() => (saveId === null ? null : loadNotes(storage, saveId)));
  useEffect(() => {
    setNotes(saveId === null ? null : loadNotes(storage, saveId));
  }, [storage, saveId]);
  const update = useCallback(
    (fn: (notes: PlayerNotes) => PlayerNotes) =>
      setNotes((current) => {
        if (current === null) return current;
        const next = fn(current);
        saveNotes(storage, next);
        return next;
      }),
    [storage],
  );
  return [notes !== null && notes.saveId === saveId ? notes : null, update];
};
