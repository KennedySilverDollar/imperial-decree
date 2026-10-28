import { useCallback, useEffect, useState } from "react";
import { PLAYER_NOTES_STORAGE_KEY } from "../../domain/constants";
import { addNote, parseNotes, removeNote, type PlayerNote } from "../../domain/PlayerNotes";

// プレイヤーのメモの保存（DECISIONS AA-11）。セーブとは別のキーに、saveId ごとの配列を JSON で置く。
// 表現層が書き込めるのはメモと設定だけ（不変条件17）。保存に失敗しても（容量・プライベートモード）ゲームは止めない。

type Store = Record<string, readonly PlayerNote[]>;

const readStore = (storage: Storage | null): Store => {
  if (!storage) return {};
  try {
    const raw = storage.getItem(PLAYER_NOTES_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const out: Store = {};
    for (const [saveId, notes] of Object.entries(parsed as Record<string, unknown>)) out[saveId] = parseNotes(notes);
    return out;
  } catch {
    return {};
  }
};

const defaultStorage = (): Storage | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

export const loadNotes = (saveId: string, storage: Storage | null = defaultStorage()): readonly PlayerNote[] => readStore(storage)[saveId] ?? [];

export const saveNotes = (saveId: string, notes: readonly PlayerNote[], storage: Storage | null = defaultStorage()): boolean => {
  if (!storage) return false;
  try {
    const store = readStore(storage);
    if (notes.length === 0) delete store[saveId];
    else store[saveId] = notes;
    storage.setItem(PLAYER_NOTES_STORAGE_KEY, JSON.stringify(store));
    return true;
  } catch {
    return false;
  }
};

export interface PlayerNotesApi {
  readonly notes: readonly PlayerNote[];
  readonly add: (gridIndex: number, text: string) => void;
  readonly remove: (id: string) => void;
}

/** saveId のメモを読み書きするフック。turn は書き付けた年として記録する */
export function usePlayerNotes(saveId: string | null, turn: number, storage?: Storage | null): PlayerNotesApi {
  const [state, setState] = useState<{ saveId: string | null; notes: readonly PlayerNote[] }>(() => ({
    saveId,
    notes: saveId === null ? [] : loadNotes(saveId, storage),
  }));
  useEffect(() => {
    if (state.saveId !== saveId) setState({ saveId, notes: saveId === null ? [] : loadNotes(saveId, storage) });
  }, [saveId, state.saveId, storage]);
  const notes = state.saveId === saveId ? state.notes : [];
  const update = useCallback(
    (next: (prev: readonly PlayerNote[]) => readonly PlayerNote[]) => {
      if (saveId === null) return;
      setState((prev) => {
        const notesNext = next(prev.saveId === saveId ? prev.notes : []);
        saveNotes(saveId, notesNext, storage);
        return { saveId, notes: notesNext };
      });
    },
    [saveId, storage],
  );
  return {
    notes,
    add: useCallback((gridIndex: number, text: string) => update((prev) => addNote(prev, gridIndex, text, turn)), [update, turn]),
    remove: useCallback((id: string) => update((prev) => removeNote(prev, id)), [update]),
  };
}
