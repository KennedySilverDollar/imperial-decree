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
  | { readonly type: "flip"; readonly turn: number; readonly to: number; readonly sheetCount: number };

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
    case "newSheet":
      return action.key === state.draftKey ? state : { ...state, draft: EMPTY_DRAFT, draftKey: action.key, stamping: false };
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
  }
};
