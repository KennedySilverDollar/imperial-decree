import { Data } from "effect";
import type { DecreeValidationIssue } from "../domain/Decree";
import type { LLMFailureReason } from "../domain/TurnRecord";

// エラー型（SPEC §11.5：ValidationError | LLMError | SaveError | GameOverError）

export type ValidationIssue =
  | DecreeValidationIssue
  | { readonly kind: "noPoliticalCapital" }
  | { readonly kind: "invalidIntent" }
  | { readonly kind: "aidesFull" }
  | { readonly kind: "unknownCandidate" }
  | { readonly kind: "unknownAide" };

export class ValidationError extends Data.TaggedError("ValidationError")<{ readonly issue: ValidationIssue }> {}

export class LLMError extends Data.TaggedError("LLMError")<{ readonly reason: LLMFailureReason; readonly detail?: string }> {}

export class SaveError extends Data.TaggedError("SaveError")<{ readonly operation: "save" | "load" | "clear"; readonly detail: string }> {}

export class GameOverError extends Data.TaggedError("GameOverError") {}
