import { DECREE_CHAR_LIMIT, MAX_TAGS, TAG_CHAR_COST } from "./constants";
import type { Target } from "./Vocabulary";

// 勅令（SPEC §6.1 / A-06）。タグは「対象」「規模」の2種のみ、各1個まで。

export type ScaleTagValue = "small" | "medium" | "large";

export type DecreeTag =
  | { readonly kind: "target"; readonly value: Target }
  | { readonly kind: "scale"; readonly value: ScaleTagValue };

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
