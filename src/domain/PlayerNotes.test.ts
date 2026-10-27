import { describe, expect, it } from "vitest";
import { NOTE_CHAR_LIMIT, NOTES_SCHEMA_VERSION } from "./constants";
import {
  addNote,
  attachNote,
  emptyNotes,
  noteLength,
  notesAttachedTo,
  parsePlayerNotes,
  removeNote,
  sameAttachment,
  validateNoteText,
  type PlayerNote,
} from "./PlayerNotes";

const note = (partial: Partial<PlayerNote> = {}): PlayerNote => ({ id: "n1", text: "倉庫が怪しい", turnCreated: 3, attachedTo: null, ...partial });
const article = { kind: "article", turn: 3, articleId: "N-16" } as const;
const report = { kind: "aideReport", turn: 3, aideId: "elderSteward" } as const;

describe("プレイヤーのメモ", () => {
  it("60字まで書ける。空・61字以上はちぎれない", () => {
    expect(validateNoteText("あ".repeat(NOTE_CHAR_LIMIT))).toBeNull();
    expect(validateNoteText("あ".repeat(NOTE_CHAR_LIMIT + 1))).toEqual({ kind: "tooLong", length: 61, limit: 60 });
    expect(validateNoteText("   ")).toEqual({ kind: "empty" });
    // 文字数はコードポイント（サロゲートペアも1字）
    expect(noteLength("𠮷野")).toBe(2);
  });

  it("ちぎって足す。不正なら足さずに理由を返す", () => {
    const start = emptyNotes("save-a");
    const ok = addNote(start, note({ text: "  倉庫が怪しい  " }));
    expect(ok.issue).toBeNull();
    expect(ok.notes.notes).toEqual([note()]);
    const bad = addNote(start, note({ text: "" }));
    expect(bad.issue).toEqual({ kind: "empty" });
    expect(bad.notes).toBe(start);
  });

  it("記事・書簡に留める、外す、捨てる", () => {
    let notes = addNote(emptyNotes("save-a"), note()).notes;
    notes = addNote(notes, note({ id: "n2", text: "代官は隠している", attachedTo: report })).notes;
    notes = attachNote(notes, "n1", article);
    expect(notesAttachedTo(notes, article).map((n) => n.id)).toEqual(["n1"]);
    expect(notesAttachedTo(notes, report).map((n) => n.id)).toEqual(["n2"]);
    notes = attachNote(notes, "n1", null);
    expect(notesAttachedTo(notes, article)).toEqual([]);
    expect(removeNote(notes, "n2").notes.map((n) => n.id)).toEqual(["n1"]);
  });

  it("留め先の比較：種類・年・記事／側近がすべて同じときだけ同じ", () => {
    expect(sameAttachment(article, { ...article })).toBe(true);
    expect(sameAttachment(article, { ...article, turn: 4 })).toBe(false);
    expect(sameAttachment(article, report)).toBe(false);
    expect(sameAttachment(null, null)).toBe(true);
    expect(sameAttachment(article, null)).toBe(false);
  });

  it("保存した形を読み戻せる", () => {
    const notes = attachNote(addNote(emptyNotes("save-a"), note()).notes, "n1", article);
    expect(parsePlayerNotes(JSON.parse(JSON.stringify(notes)), "save-a")).toEqual(notes);
  });

  it("無い・壊れている・版が違う・別の領地のメモは空として読む", () => {
    const saved = addNote(emptyNotes("save-a"), note()).notes;
    expect(parsePlayerNotes(undefined, "save-a")).toEqual(emptyNotes("save-a"));
    expect(parsePlayerNotes("oops", "save-a")).toEqual(emptyNotes("save-a"));
    expect(parsePlayerNotes({ ...saved, schemaVersion: NOTES_SCHEMA_VERSION + 1 }, "save-a")).toEqual(emptyNotes("save-a"));
    expect(parsePlayerNotes(saved, "save-b")).toEqual(emptyNotes("save-b"));
  });

  it("壊れたメモだけを捨てて、残りは読む", () => {
    const raw = {
      schemaVersion: NOTES_SCHEMA_VERSION,
      saveId: "save-a",
      notes: [note(), { id: 1 }, note({ id: "long", text: "あ".repeat(61) }), { ...note({ id: "odd" }), attachedTo: { kind: "parcel", turn: 1 } }],
    };
    expect(parsePlayerNotes(raw, "save-a").notes.map((n) => n.id)).toEqual(["n1"]);
  });
});
