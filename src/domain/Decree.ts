import { DECREE_CHAR_LIMIT, MAX_TAGS, TAG_CHAR_COST } from "./constants";
import type { Target } from "./Vocabulary";

// 勅令（SPEC §6.1 / v3.2 の指示で A-06 を改定：DECISIONS I-30）。
// タグは「対象」「規模」「期限」「優先度」の4種、各1個まで、1つ5文字。
// 期限・優先度は参謀への添え書きで、ゲーム上の効果はない（DecreeIntent に対応する項目がない）。

export const SCALE_TAG_VALUES = ["small", "medium", "large"] as const;
export type ScaleTagValue = (typeof SCALE_TAG_VALUES)[number];
export const DEADLINE_TAG_VALUES = ["thisYear", "fewYears", "noRush"] as const;
export type DeadlineTagValue = (typeof DEADLINE_TAG_VALUES)[number];
export const PRIORITY_TAG_VALUES = ["high", "normal", "low"] as const;
export type PriorityTagValue = (typeof PRIORITY_TAG_VALUES)[number];

export type DecreeTag =
  | { readonly kind: "target"; readonly value: Target }
  | { readonly kind: "scale"; readonly value: ScaleTagValue }
  | { readonly kind: "deadline"; readonly value: DeadlineTagValue }
  | { readonly kind: "priority"; readonly value: PriorityTagValue };

export const TAG_KINDS = ["target", "scale", "deadline", "priority"] as const satisfies readonly DecreeTag["kind"][];

export interface Decree {
  readonly text: string;
  readonly tags: readonly DecreeTag[];
}

export type DecreeValidationIssue =
  | { readonly kind: "empty" }
  | { readonly kind: "tooLong"; readonly used: number; readonly limit: number }
  | { readonly kind: "tooManyTags"; readonly count: number }
  | { readonly kind: "duplicateTag"; readonly tagKind: DecreeTag["kind"] };

/** 本文の文字数。前後の空白を除いたコードポイント数（DECISIONS D-31） */
export const countTextChars = (text: string): number => [...text.trim()].length;

/** 消費文字数 = 本文 + タグ数 × TAG_CHAR_COST */
export const usedChars = (decree: Decree): number =>
  countTextChars(decree.text) + decree.tags.length * TAG_CHAR_COST;

export const remainingChars = (decree: Decree): number => DECREE_CHAR_LIMIT - usedChars(decree);

export const validateDecree = (decree: Decree): DecreeValidationIssue | null => {
  if (countTextChars(decree.text) === 0) return { kind: "empty" };
  if (decree.tags.length > MAX_TAGS) return { kind: "tooManyTags", count: decree.tags.length };
  const seen = new Set<DecreeTag["kind"]>();
  for (const tag of decree.tags) {
    if (seen.has(tag.kind)) return { kind: "duplicateTag", tagKind: tag.kind };
    seen.add(tag.kind);
  }
  const used = usedChars(decree);
  if (used > DECREE_CHAR_LIMIT) return { kind: "tooLong", used, limit: DECREE_CHAR_LIMIT };
  return null;
};

export const findTag = <K extends DecreeTag["kind"]>(
  decree: Decree,
  kind: K,
): Extract<DecreeTag, { kind: K }> | undefined =>
  decree.tags.find((tag): tag is Extract<DecreeTag, { kind: K }> => tag.kind === kind);
