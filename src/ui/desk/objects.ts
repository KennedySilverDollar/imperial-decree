// 机上オブジェクトの目録（SPEC_v3.3 §3.2・§4.7）。位置は机の単位で、紙の「上辺の中央」の置き場所。
// 並びの順が俯瞰での初めの重なり順（後ろほど上）。

export const DESK_OBJECT_IDS = ["lamp", "ledger", "map", "letters", "notepad", "archive", "newspaper", "result", "decree", "stamp"] as const;
export type DeskObjectId = (typeof DESK_OBJECT_IDS)[number];

/** 手に取れる書類（判子は勅令用紙と一緒に手元へ来る。ランプは飾り） */
export type PickableId = Exclude<DeskObjectId, "stamp" | "lamp">;

export interface HomePosition {
  readonly x: number;
  readonly y: number;
  /** 机からの高さ（紙の厚み・物の背丈） */
  readonly z: number;
  /** 机の上での向き（度） */
  readonly rotate: number;
}

export interface DeskObjectSpec {
  readonly id: DeskObjectId;
  /** 手元で正対させたときの幅（px） */
  readonly width: number;
  readonly home: HomePosition;
  /** 影の付け方：紙は矩形の影、小物は輪郭の影 */
  readonly shadow: "box" | "drop";
  /** 俯瞰での高さの上限（新聞は二つ折りで置く。§3.2）。無ければ手元と同じ */
  readonly overviewMaxHeight?: number;
}

export const DESK_OBJECTS: Readonly<Record<DeskObjectId, DeskObjectSpec>> = {
  lamp: { id: "lamp", width: 200, home: { x: -1130, y: -720, z: 40, rotate: 0 }, shadow: "drop" },
  ledger: { id: "ledger", width: 680, home: { x: -640, y: -690, z: 6, rotate: -2.5 }, shadow: "box" },
  map: { id: "map", width: 680, home: { x: 90, y: -720, z: 2, rotate: 0.6 }, shadow: "box", overviewMaxHeight: 760 },
  letters: { id: "letters", width: 600, home: { x: 790, y: -680, z: 5, rotate: 2.2 }, shadow: "box" },
  notepad: { id: "notepad", width: 380, home: { x: 1000, y: -250, z: 6, rotate: 4 }, shadow: "box", overviewMaxHeight: 340 },
  archive: { id: "archive", width: 760, home: { x: 560, y: 470, z: 26, rotate: -1 }, shadow: "box", overviewMaxHeight: 260 },
  newspaper: { id: "newspaper", width: 720, home: { x: -700, y: -50, z: 4, rotate: -4 }, shadow: "box", overviewMaxHeight: 470 },
  result: { id: "result", width: 580, home: { x: -90, y: 90, z: 8, rotate: -2 }, shadow: "box" },
  decree: { id: "decree", width: 620, home: { x: 520, y: 0, z: 3, rotate: 1.5 }, shadow: "box" },
  stamp: { id: "stamp", width: 150, home: { x: 990, y: 190, z: 24, rotate: 0 }, shadow: "drop" },
};

/** §4.7：数字キーで手に取る順。8 の既決箱は §4.7 に無いので足した（DECISIONS） */
export const PICK_KEYS: Readonly<Record<string, PickableId>> = {
  "1": "map",
  "2": "newspaper",
  "3": "letters",
  "4": "decree",
  "5": "ledger",
  "6": "result",
  "7": "notepad",
  "8": "archive",
};

/** ← → でめくれる書類（§4.7「紙面・書類・台帳をめくる」） */
export const PAGED_OBJECTS: readonly PickableId[] = ["newspaper", "ledger", "result", "archive"];

export const isPickable = (id: DeskObjectId): id is PickableId => id !== "stamp" && id !== "lamp";

/** 並べ読み（§4.6）ができる書類 */
export const SIDE_BY_SIDE_READERS: readonly PickableId[] = ["newspaper", "letters"];
