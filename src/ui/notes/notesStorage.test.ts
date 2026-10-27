import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { NOTES_STORAGE_KEY, SAVE_STORAGE_KEY } from "../../domain/constants";
import { createInitialState } from "../../domain/GameState";
import { addNote, attachNote, emptyNotes } from "../../domain/PlayerNotes";
import { makeSaveServiceStorage } from "../../services/SaveService";
import { loadNotes, saveNotes } from "./notesStorage";

const memoryStorage = () => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
};

describe("メモのセーブ・ロード（DECISIONS AA-11）", () => {
  it("保存して読み戻せる", () => {
    const storage = memoryStorage();
    const notes = attachNote(
      addNote(emptyNotes("save-a"), { id: "n1", text: "倉庫が怪しい", turnCreated: 2, attachedTo: null }).notes,
      "n1",
      { kind: "aideReport", turn: 2, aideId: "youngMerchant" },
    );
    saveNotes(storage, notes);
    expect(loadNotes(storage, "save-a")).toEqual(notes);
  });

  it("メモの無い既存のセーブからでも、空のメモ帳で始まり、ゲームのセーブはそのまま読める", async () => {
    const storage = memoryStorage();
    const saveService = makeSaveServiceStorage(storage);
    const state = createInitialState(42);
    await Effect.runPromise(saveService.save(state));
    // U2 より前のセーブ：メモのキーが無い
    expect(storage.getItem(NOTES_STORAGE_KEY)).toBeNull();
    expect(loadNotes(storage, state.saveId)).toEqual(emptyNotes(state.saveId));
    expect(await Effect.runPromise(saveService.load)).toEqual(state);
  });

  it("メモを保存してもゲームのセーブには入らない（GameState と別のキー）", async () => {
    const storage = memoryStorage();
    const saveService = makeSaveServiceStorage(storage);
    const state = createInitialState(7);
    await Effect.runPromise(saveService.save(state));
    const before = storage.getItem(SAVE_STORAGE_KEY);
    saveNotes(storage, addNote(emptyNotes(state.saveId), { id: "n1", text: "役所を急げ", turnCreated: 1, attachedTo: null }).notes);
    expect(storage.getItem(SAVE_STORAGE_KEY)).toBe(before);
    expect(before).not.toContain("役所を急げ");
    expect(await Effect.runPromise(saveService.load)).toEqual(state);
  });

  it("始め直した領地には前の領地のメモを持ち込まない", () => {
    const storage = memoryStorage();
    saveNotes(storage, addNote(emptyNotes("save-old"), { id: "n1", text: "前の領地", turnCreated: 1, attachedTo: null }).notes);
    expect(loadNotes(storage, "save-new").notes).toEqual([]);
  });

  it("壊れた値・読めない保存先でも空のメモ帳で続ける", () => {
    const storage = memoryStorage();
    storage.setItem(NOTES_STORAGE_KEY, "{oops");
    expect(loadNotes(storage, "save-a")).toEqual(emptyNotes("save-a"));
    const throwing = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
    expect(loadNotes(throwing, "save-a")).toEqual(emptyNotes("save-a"));
    expect(() => saveNotes(throwing, emptyNotes("save-a"))).not.toThrow();
  });
});
