import { PAGED_OBJECTS, PICK_KEYS, SIDE_BY_SIDE_READERS, type PickableId } from "./objects";

// キーボード操作（SPEC_v3.3 §4.7）。キーと状況から「何をするか」だけを決める純粋関数。
// 文字を打っている最中（入力欄・IME 変換中）は、Esc 以外は横取りしない。

export type KeyCommand =
  | { readonly kind: "pickUp"; readonly id: PickableId }
  | { readonly kind: "putDown" }
  | { readonly kind: "toggleSideBySide" }
  | { readonly kind: "page"; readonly delta: -1 | 1 }
  | { readonly kind: "stamp" }
  | { readonly kind: "skip" };

/** キーを受けた要素の種類：文字入力欄 / ボタン・選択肢などの部品 / それ以外（紙・机） */
export type KeyTarget = "text" | "control" | "other";

export interface KeyContext {
  readonly mode: "3d" | "flat";
  readonly focused: PickableId | null;
  /** 押印や手に取る動きの最中 */
  readonly animating: boolean;
}

export interface KeyInput {
  readonly key: string;
  readonly isComposing: boolean;
  readonly target: KeyTarget;
  readonly modifiers: boolean;
}

export const commandForKey = (input: KeyInput, ctx: KeyContext): KeyCommand | null => {
  if (input.isComposing) return null;
  if (input.key === "Escape") return ctx.focused === null ? null : { kind: "putDown" };
  if (input.modifiers || input.target === "text") return null;

  if (input.key === " " && ctx.animating) return { kind: "skip" };

  const pick = PICK_KEYS[input.key];
  if (pick !== undefined) return { kind: "pickUp", id: pick };

  // Tab（移動）・矢印（選択肢）・Enter（押下）は部品の上では部品に任せる
  if (input.target === "control") return null;
  switch (input.key) {
    case "Tab":
      return ctx.mode === "3d" && ctx.focused !== null && SIDE_BY_SIDE_READERS.includes(ctx.focused) ? { kind: "toggleSideBySide" } : null;
    case "ArrowLeft":
      return ctx.focused !== null && PAGED_OBJECTS.includes(ctx.focused) ? { kind: "page", delta: -1 } : null;
    case "ArrowRight":
      return ctx.focused !== null && PAGED_OBJECTS.includes(ctx.focused) ? { kind: "page", delta: 1 } : null;
    case "Enter":
      return ctx.focused === "decree" ? { kind: "stamp" } : null;
    default:
      return null;
  }
};

/** イベントの発生元を KeyTarget に分ける */
export const keyTargetOf = (el: EventTarget | null): KeyTarget => {
  if (!(el instanceof HTMLElement)) return "other";
  if (el.isContentEditable) return "text";
  const tag = el.tagName;
  if (tag === "TEXTAREA") return "text";
  if (tag === "INPUT") {
    const type = (el as HTMLInputElement).type;
    return type === "button" || type === "checkbox" || type === "radio" || type === "submit" ? "control" : "text";
  }
  if (tag === "SELECT" || tag === "BUTTON" || tag === "A" || el.getAttribute("role") === "button") return "control";
  return "other";
};
