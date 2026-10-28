import { describe, expect, it } from "vitest";
import { PLAYER_NOTE_MAX_CHARS, PLAYER_NOTES_MAX_COUNT } from "./constants";
import { addNote, normalizeNoteText, notesAt, parseNotes, removeNote } from "./PlayerNotes";

// プレイヤーのメモ（AA-11）：ロジック非依存の純関数。

describe("PlayerNotes", () => {
  it("足す・消す・区画ごとに引く。ID は乱数を使わず一意", () => {
    let notes = addNote([], 12, "水はけが悪い", 3);
    notes = addNote(notes, 12, "盗賊の噂", 3);
    notes = addNote(notes, 40, "市場の候補", 4);
    expect(notes.map((n) => n.id)).toEqual(["3-12-0", "3-12-1", "4-40-2"]);
    expect(notesAt(notes, 12).map((n) => n.text)).toEqual(["水はけが悪い", "盗賊の噂"]);
    const removed = removeNote(notes, "3-12-1");
    expect(removed.map((n) => n.id)).toEqual(["3-12-0", "4-40-2"]);
    // 消した後に足しても既存の ID と重ならない
    const again = addNote(removed, 12, "再び", 5);
    expect(new Set(again.map((n) => n.id)).size).toBe(again.length);
  });

  it("空・範囲外の区画は足さず、本文は上限の文字数（コードポイント）で切る", () => {
    expect(addNote([], 3, "   ", 1)).toEqual([]);
    expect(addNote([], 100, "x", 1)).toEqual([]);
    expect(addNote([], -1, "x", 1)).toEqual([]);
    const long = "𠮷".repeat(PLAYER_NOTE_MAX_CHARS + 5);
    expect([...(normalizeNoteText(long) ?? "")].length).toBe(PLAYER_NOTE_MAX_CHARS);
    expect(normalizeNoteText("  a \n b  ")).toBe("a b");
  });

  it("数の上限を超えて足さない", () => {
    let notes = addNote([], 0, "x", 1);
    for (let k = 0; k < PLAYER_NOTES_MAX_COUNT + 5; k++) notes = addNote(notes, k % 100, `n${k}`, 1);
    expect(notes.length).toBe(PLAYER_NOTES_MAX_COUNT);
  });

  it("保存から読んだ壊れた値は捨てる", () => {
    expect(parseNotes("x")).toEqual([]);
    expect(parseNotes([{ id: "a", gridIndex: 5, text: "ok", turn: 2 }, { id: 1 }, null, { id: "b", gridIndex: 500, text: "x", turn: 1 }])).toEqual([
      { id: "a", gridIndex: 5, text: "ok", turn: 2 },
    ]);
  });
});
