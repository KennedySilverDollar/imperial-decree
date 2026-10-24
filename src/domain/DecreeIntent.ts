import type { Action, Target } from "./Vocabulary";

/** 参謀(LLM)またはテンプレートパーサーの解釈結果（検証・clamp 済み） */
export interface DecreeIntent {
  readonly action: Action;
  /** 許可リスト外の値は null（no-op＋「意味が取れなかった」） */
  readonly target: Target | null;
  readonly magnitude: number;
  readonly budget: number;
  readonly confidence: number;
}

export type IntentSource = "llm" | "template";
