import {
  remainingChars,
  validateDecree,
  type DeadlineTagValue,
  type Decree,
  type DecreeTag,
  type PriorityTagValue,
  type ScaleTagValue,
  type DecreeValidationIssue,
} from "../../domain/Decree";
import { isValidIntentDeclaration, type IntentDeclaration, type IntentDirection } from "../../domain/IntentDeclaration";
import type { ParamKey, Target } from "../../domain/Vocabulary";

// 勅令用紙の書きかけ（UI ストアの値。セーブしない）。手に取る／置く・平面モードの切替をまたいで保つ。

export interface TagDraft {
  readonly target: Target | "";
  readonly scale: ScaleTagValue | "";
  readonly deadline: DeadlineTagValue | "";
  readonly priority: PriorityTagValue | "";
}

export interface IntentDraft {
  readonly param: ParamKey | "";
  readonly direction: IntentDirection;
  readonly value: string;
}

export interface DecreeDraft {
  readonly text: string;
  readonly tags: TagDraft;
  readonly intent: IntentDraft;
}

export const EMPTY_TAGS: TagDraft = { target: "", scale: "", deadline: "", priority: "" };
export const EMPTY_INTENT: IntentDraft = { param: "", direction: "increase", value: "" };
export const EMPTY_DRAFT: DecreeDraft = { text: "", tags: EMPTY_TAGS, intent: EMPTY_INTENT };

export const toDecree = ({ text, tags: draft }: DecreeDraft): Decree => {
  const tags: DecreeTag[] = [];
  if (draft.target !== "") tags.push({ kind: "target", value: draft.target });
  if (draft.scale !== "") tags.push({ kind: "scale", value: draft.scale });
  if (draft.deadline !== "") tags.push({ kind: "deadline", value: draft.deadline });
  if (draft.priority !== "") tags.push({ kind: "priority", value: draft.priority });
  return { text, tags };
};

export const toIntent = (draft: IntentDraft): IntentDeclaration | null | "invalid" => {
  if (draft.param === "") return null;
  const declaration: IntentDeclaration = { targetParam: draft.param, direction: draft.direction, targetValue: Number(draft.value) };
  return draft.value !== "" && isValidIntentDeclaration(declaration) ? declaration : "invalid";
};

export interface DraftCheck {
  readonly decree: Decree;
  readonly remaining: number;
  readonly issue: DecreeValidationIssue | null;
  readonly declaration: IntentDeclaration | null | "invalid";
  /** 判を押せるか（文字数・意図の形・政治資本・受付中） */
  readonly ready: boolean;
}

export const checkDraft = (draft: DecreeDraft, opts: { readonly canIssue: boolean; readonly locked: boolean }): DraftCheck => {
  const decree = toDecree(draft);
  const issue = validateDecree(decree);
  const declaration = toIntent(draft.intent);
  return {
    decree,
    remaining: remainingChars(decree),
    issue,
    declaration,
    ready: issue === null && declaration !== "invalid" && opts.canIssue && !opts.locked,
  };
};
