import type { ArchiveDoc } from "../panels/ArchivePanel";
import type { NoteDraft } from "../panels/NotepadPanel";
import { EMPTY_DRAFT, type DecreeDraft } from "./decreeDraft";
import { DESK_OBJECT_IDS, SIDE_BY_SIDE_READERS, type DeskObjectId, type PickableId } from "./objects";

// 机の UI 状態（SPEC_v3.3 §11.1 の DeskUiState に、書きかけの勅令と結果束のめくり位置を足したもの）。
// UI ストアのみ。セーブせず、GameState にも入れない（不変条件17）。

export interface ResultView {
  /** どの年の結果束か */
  readonly turn: number;
  /** いま一番上にある紙（0 始まり） */
  readonly top: number;
  readonly flips: number;
  /** 一番深くまでめくった紙（0 始まり） */
  readonly deepest: number;
}

export interface DeskUiState {
  readonly focused: PickableId | null;
  readonly sideBySide: boolean;
  /** 俯瞰での重なり順（後ろほど上） */
  readonly order: readonly DeskObjectId[];
  readonly draft: DecreeDraft;
  /** 書きかけがどの領地・どの年の用紙か（年が替わる・始め直すと新しい紙にする） */
  readonly draftKey: string;
  readonly stamping: boolean;
  readonly result: ResultView | null;
  /** めくり位置（新聞は号ごと・台帳・既決箱の書類）。無いキーは最初の面（台帳は最新の年） */
  readonly pages: Readonly<Record<string, number>>;
  /** 封蝋を割った書簡（"年:側近"） */
  readonly opened: readonly string[];
  /** 既決箱から取り出している年と書類 */
  readonly archive: { readonly turn: number | null; readonly doc: ArchiveDoc };
  /** メモ帳の書きかけ */
  readonly noteDraft: NoteDraft;
}

export type DeskAction =
  | { readonly type: "pickUp"; readonly id: PickableId }
  | { readonly type: "putDown" }
  | { readonly type: "toggleSideBySide" }
  | { readonly type: "draft"; readonly draft: DecreeDraft }
  | { readonly type: "newSheet"; readonly key: string }
  | { readonly type: "stampStart" }
  | { readonly type: "stampEnd" }
  | { readonly type: "resultArrived"; readonly turn: number }
  | { readonly type: "flip"; readonly turn: number; readonly to: number; readonly sheetCount: number }
  | { readonly type: "page"; readonly key: string; readonly to: number; readonly count: number }
  | { readonly type: "openLetter"; readonly key: string }
  | { readonly type: "archive"; readonly turn: number | null; readonly doc: ArchiveDoc }
  | { readonly type: "noteDraft"; readonly draft: NoteDraft };

/** めくり位置のキー */
export const pageKey = {
  newspaper: (issueTurn: number) => `news:${issueTurn}`,
  ledger: "ledger",
  archive: (turn: number, doc: ArchiveDoc) => `archive:${turn}:${doc}`,
} as const;

export const letterKey = (turn: number, aideId: string): string => `${turn}:${aideId}`;

export const sheetKey = (saveId: string, turn: number): string => `${saveId}:${turn}`;

export const freshResultView = (turn: number): ResultView => ({ turn, top: 0, flips: 0, deepest: 0 });

export const initialDeskState = (draftKey: string): DeskUiState => ({
  focused: null,
  sideBySide: false,
  order: DESK_OBJECT_IDS,
  draft: EMPTY_DRAFT,
  draftKey,
  stamping: false,
  result: null,
  pages: {},
  opened: [],
  archive: { turn: null, doc: "newspaper" },
  noteDraft: { text: "", target: "none" },
});

const toTop = (order: readonly DeskObjectId[], ...ids: DeskObjectId[]): readonly DeskObjectId[] => [
  ...order.filter((id) => !ids.includes(id)),
  ...ids,
];

/** 手に取る。結果の書類束がまだ無いときに呼ばないのは呼ぶ側（机）の責任 */
const pickUp = (state: DeskUiState, id: PickableId): DeskUiState => {
  return {
    ...state,
    focused: id,
    sideBySide: state.sideBySide && SIDE_BY_SIDE_READERS.includes(id),
    order: id === "decree" ? toTop(state.order, "decree", "stamp") : toTop(state.order, id),
  };
};

export const deskReducer = (state: DeskUiState, action: DeskAction): DeskUiState => {
  switch (action.type) {
    case "pickUp":
      return pickUp(state, action.id);
    case "putDown":
      return state.focused === null ? state : { ...state, focused: null, sideBySide: false };
    case "toggleSideBySide":
      return state.focused !== null && SIDE_BY_SIDE_READERS.includes(state.focused)
        ? { ...state, sideBySide: !state.sideBySide }
        : state;
    case "draft":
      return { ...state, draft: action.draft };
    case "newSheet": {
      if (action.key === state.draftKey) return state;
      // 新しい年：台帳は最新の年を開き、メモの留め先は（去年の記事なので）外す
      const pages = Object.fromEntries(Object.entries(state.pages).filter(([key]) => key !== pageKey.ledger));
      return { ...state, draft: EMPTY_DRAFT, draftKey: action.key, stamping: false, pages, noteDraft: { ...state.noteDraft, target: "none" } };
    }
    case "stampStart":
      return { ...state, stamping: true };
    case "stampEnd":
      return { ...state, stamping: false };
    case "resultArrived":
      return {
        ...pickUp({ ...state, result: freshResultView(action.turn) }, "result"),
        sideBySide: false,
      };
    case "flip": {
      // セーブから続けた年の束は、まだ見た記録がないので最初の紙から数える
      const current = state.result?.turn === action.turn ? state.result : freshResultView(action.turn);
      const to = Math.min(Math.max(0, action.to), action.sheetCount - 1);
      if (to === current.top) return state;
      return { ...state, result: { ...current, top: to, flips: current.flips + 1, deepest: Math.max(current.deepest, to) } };
    }
    case "page": {
      const to = Math.min(Math.max(0, action.to), action.count - 1);
      return state.pages[action.key] === to ? state : { ...state, pages: { ...state.pages, [action.key]: to } };
    }
    case "openLetter":
      return state.opened.includes(action.key) ? state : { ...state, opened: [...state.opened, action.key] };
    case "archive":
      return { ...state, archive: { turn: action.turn, doc: action.doc } };
    case "noteDraft":
      return { ...state, noteDraft: action.draft };
  }
};
