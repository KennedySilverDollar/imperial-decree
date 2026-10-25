import type { EventKind } from "./Events";

// 新聞 v2 の型（v3.2 §1.4, §1.10）。生成は engine/NewspaperGenerator、テンプレートは content/newspaper。
// domain は Effect 非依存のため、Option の代わりに null を使う（I-01）。

export const SECTIONS = ["front", "social", "economy", "administration", "security", "letters", "advertisement", "weather"] as const;
export type Section = (typeof SECTIONS)[number];

export const SLOT_NAMES = ["num", "pct", "place", "aide", "building", "faction", "season", "hedge", "euphemism", "event"] as const;
export type SlotName = (typeof SLOT_NAMES)[number];

export const THREAD_KEYS = ["corruption", "granary_hollow", "aide_ambition", "housing_crisis"] as const;
export type ThreadKey = (typeof THREAD_KEYS)[number];

export interface BiasApplied {
  readonly ideological: number;
  readonly censorship: number;
  readonly bureaucratic: number;
}

export interface NewspaperArticle {
  readonly id: string;
  readonly section: Section;
  readonly headline: string;
  readonly body: readonly string[];
  readonly threadKey: ThreadKey | null;
  readonly isFollowUp: boolean;
  readonly biasApplied: BiasApplied;
  /** 0..1。内部保持のみ（UI 非表示。CLAUDE.md §4-13） */
  readonly truthfulness: number;
  readonly relatedEntity: { readonly kind: "building" | "aide" | "param" | "event"; readonly id: string } | null;
}

/** 生成の過程（分析・sim 用。UI には出さない） */
export interface NewspaperStats {
  /** 検閲で削除された負の記事 */
  readonly censoredIds: readonly string[];
  /** 官僚圧力で称賛に転じた記事 */
  readonly praisedIds: readonly string[];
  readonly hedgedCount: number;
}

export interface Newspaper {
  readonly turn: number;
  readonly seed: number;
  readonly articles: readonly NewspaperArticle[];
  readonly stats: NewspaperStats;
}

export interface Thread {
  readonly key: ThreadKey;
  readonly startedTurn: number;
  /** 残りの継続年数（housing_crisis は解消まで続くので null） */
  readonly remaining: number | null;
  readonly entity: string | null;
  /** 終わった年（同じ話題がすぐ再燃しないよう、THREAD_MAX_TURNS 年は再開しない） */
  readonly endedTurn: number | null;
}

/** 決定論のために GameState に保存するもの（V-13） */
export interface NewspaperState {
  readonly threads: readonly Thread[];
  readonly recentTemplates: readonly { readonly id: string; readonly turn: number }[];
}

export const EMPTY_NEWSPAPER_STATE: NewspaperState = { threads: [], recentTemplates: [] };

export type { EventKind };
