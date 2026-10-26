// 机上オブジェクトの目録（SPEC_v3.3 §3.2・§4.7）。位置は机の単位で、紙の「上辺の中央」の置き場所。
// メモ帳（§7）・既決箱は U2〜U4 で足す。

export const DESK_OBJECT_IDS = ["lamp", "ledger", "map", "letters", "newspaper", "result", "decree", "stamp"] as const;
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
}

export const DESK_OBJECTS: Readonly<Record<DeskObjectId, DeskObjectSpec>> = {
  lamp: { id: "lamp", width: 200, home: { x: -1040, y: -720, z: 40, rotate: 0 }, shadow: "drop" },
  ledger: { id: "ledger", width: 560, home: { x: -680, y: -660, z: 6, rotate: -3 }, shadow: "box" },
  map: { id: "map", width: 470, home: { x: 60, y: -690, z: 2, rotate: 0.6 }, shadow: "box" },
  letters: { id: "letters", width: 600, home: { x: 800, y: -650, z: 5, rotate: 2.2 }, shadow: "box" },
  newspaper: { id: "newspaper", width: 720, home: { x: -700, y: -40, z: 4, rotate: -4 }, shadow: "box" },
  result: { id: "result", width: 580, home: { x: -40, y: 110, z: 8, rotate: -2 }, shadow: "box" },
  decree: { id: "decree", width: 620, home: { x: 540, y: 20, z: 3, rotate: 1.5 }, shadow: "box" },
  stamp: { id: "stamp", width: 150, home: { x: 1010, y: 140, z: 24, rotate: 0 }, shadow: "drop" },
};

/** §4.7：数字キーで手に取る順（7 のメモ帳は U4） */
export const PICK_KEYS: Readonly<Record<string, PickableId>> = {
  "1": "map",
  "2": "newspaper",
  "3": "letters",
  "4": "decree",
  "5": "ledger",
  "6": "result",
};

export const isPickable = (id: DeskObjectId): id is PickableId => id !== "stamp" && id !== "lamp";

/** 並べ読み（§4.6）ができる書類 */
export const SIDE_BY_SIDE_READERS: readonly PickableId[] = ["newspaper", "letters"];
