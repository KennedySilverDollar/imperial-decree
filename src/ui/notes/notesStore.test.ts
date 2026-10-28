import { describe, expect, it } from "vitest";
import { PLAYER_NOTES_STORAGE_KEY, SAVE_STORAGE_KEY } from "../../domain/constants";
import { addNote } from "../../domain/PlayerNotes";
import { loadNotes, saveNotes } from "./notesStore";

// メモの保存（AA-11）：セーブとは別のキーに saveId ごと。保存できなくてもゲームを止めない。

const memoryStorage = (): Storage => {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, v),
  };
};

describe("notesStore", () => {
  it("セーブとは別のキーに、saveId ごとに保存して読み戻す", () => {
    const storage = memoryStorage();
    expect(PLAYER_NOTES_STORAGE_KEY).not.toBe(SAVE_STORAGE_KEY);
    const a = addNote([], 7, "井戸の水が濁る", 2);
    const b = addNote([], 9, "別のセーブ", 1);
    expect(saveNotes("save-a", a, storage)).toBe(true);
    expect(saveNotes("save-b", b, storage)).toBe(true);
    expect(loadNotes("save-a", storage)).toEqual(a);
    expect(loadNotes("save-b", storage)).toEqual(b);
    expect(storage.getItem(SAVE_STORAGE_KEY)).toBeNull();
    // 空にしたら、そのセーブの項目を消す
    saveNotes("save-a", [], storage);
    expect(JSON.parse(storage.getItem(PLAYER_NOTES_STORAGE_KEY) ?? "{}")).not.toHaveProperty("save-a");
  });

  it("壊れた JSON・使えない保存先でも例外を出さない", () => {
    const storage = memoryStorage();
    storage.setItem(PLAYER_NOTES_STORAGE_KEY, "{not json");
    expect(loadNotes("save-a", storage)).toEqual([]);
    const broken = { ...memoryStorage(), getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("full"); } } as Storage;
    expect(loadNotes("save-a", broken)).toEqual([]);
    expect(saveNotes("save-a", addNote([], 1, "x", 1), broken)).toBe(false);
    expect(saveNotes("save-a", [], null)).toBe(false);
  });
});
