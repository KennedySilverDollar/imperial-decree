import type { SelectionReason } from "./Aide";
import type { Decree } from "./Decree";
import type { DecreeIntent, IntentSource } from "./DecreeIntent";
import type { Ending } from "./Ending";
import type { Facilities, ParamDelta, Params } from "./GameState";
import type { IntentDeclaration, IntentEvaluation } from "./IntentDeclaration";
import type { ParamKey, Target } from "./Vocabulary";

// 1ターンの記録（SPEC §11.4 TurnRecord）。3段表示＋意図比較はここから組み立てる。

/** ① 参謀の解釈 */
export interface Interpretation {
  readonly intent: DecreeIntent;
  readonly source: IntentSource;
  /** メタ命令を取り除いたか（DECISIONS D-34） */
  readonly metaRemoved: boolean;
  /** 範囲外で clamp したフィールド（P-03） */
  readonly clampedFields: readonly string[];
  /** LLM が使えずテンプレートに切り替えた理由 */
  readonly fallbackReason: LLMFailureReason | null;
}

export type LLMFailureReason = "timeout" | "network" | "invalidJson" | "schemaViolation";

export type Distortion =
  | { readonly kind: "misread"; readonly factor: number; readonly from: number; readonly to: number }
  | { readonly kind: "targetSwap"; readonly from: Target; readonly to: Target }
  | { readonly kind: "waterDown"; readonly factor: number };

/** ② 側近による補正 */
export interface AideAdjustment {
  readonly aideId: string;
  readonly reason: SelectionReason;
  readonly accuracy: number;
  readonly specialtyMatch: boolean;
  readonly factionConflict: boolean;
  readonly distortions: readonly Distortion[];
  /** 誤読・取り違えを反映した指示 */
  readonly adjustedIntent: DecreeIntent;
  /** 骨抜きによる効果倍率（コストには掛からない） */
  readonly effectFactor: number;
}

export type NoopReason = "unknownTarget" | "lowConfidence" | "appointDismiss" | "invalidCombination" | "nonPositive";
export type FixedCostFailure = "alreadyBuilt" | "population" | "infrastructure" | "treasury" | "budget" | "max";

export type ExecutionNote =
  | { readonly kind: "noAide" }
  | { readonly kind: "noop"; readonly reason: NoopReason }
  | { readonly kind: "applied" }
  | { readonly kind: "budgetScaled"; readonly ratio: number; readonly cause: "treasury" | "budget" }
  | { readonly kind: "nothingAffordable" }
  | { readonly kind: "officeBuilt" }
  | { readonly kind: "officeFailed"; readonly reason: FixedCostFailure }
  | { readonly kind: "marketBuilt" }
  | { readonly kind: "marketFailed"; readonly reason: FixedCostFailure };

/** 勅令の実行結果（自然変化の前） */
export interface Execution {
  readonly notes: readonly ExecutionNote[];
  /** 勅令による国庫支出（DECREE_BASE_COST を除く） */
  readonly cost: number;
  /** 予算による縮小率（1=縮小なし） */
  readonly scale: number;
  /** 骨抜きで失われ「空洞」になったインフラ量 */
  readonly hollowAdded: number;
}

export interface ReportItem {
  readonly param: ParamKey;
  readonly delta: number;
}

export type ReportNote =
  | { readonly kind: "execution"; readonly note: ExecutionNote }
  | { readonly kind: "metaIgnored" }
  | { readonly kind: "hollowDisclosed"; readonly amount: number };

/** 側近報告（実数値の変化を報告。欠落・隠蔽あり。DECISIONS D-28） */
export interface AideReport {
  readonly aideId: string;
  readonly items: readonly ReportItem[];
  readonly notes: readonly ReportNote[];
  /** 隠蔽・欠落で報告から消えた項目。分析用でプレイヤーには見せない */
  readonly hiddenItems: readonly ReportItem[];
  /** 隠蔽が起きたか。分析用でプレイヤーには見せない（3段表示にも出さない） */
  readonly concealed: boolean;
}

export type NewspaperTone = "neutral" | "euphemism" | "boast";

export interface NewspaperLine {
  readonly param: ParamKey;
  /** 偏向ノイズ込みの報道値 */
  readonly reportedValue: number;
  readonly trend: "up" | "down" | "flat";
  readonly tone: NewspaperTone;
}

export interface NewspaperArticle {
  readonly turn: number;
  readonly headline: NewspaperLine | null;
  readonly lines: readonly NewspaperLine[];
  readonly ending: Ending | null;
}

export interface TurnRecord {
  readonly turn: number;
  readonly decree: Decree;
  readonly intentDeclaration: IntentDeclaration | null;
  /** 側近不在で勅令が実行されなかった場合は null */
  readonly interpretation: Interpretation | null;
  readonly aideAdjustment: AideAdjustment | null;
  readonly execution: Execution;
  readonly before: Params;
  readonly after: Params;
  /** ③ 実際の結果（ボーナス込みのターン全体の変化） */
  readonly actualResult: ParamDelta;
  readonly facilitiesBefore: Facilities;
  readonly facilitiesAfter: Facilities;
  /** ④ 意図比較（宣言時のみ） */
  readonly intentEvaluation: IntentEvaluation | null;
  readonly bonusHappiness: number;
  readonly newspaper: NewspaperArticle;
  readonly aideReports: readonly AideReport[];
  readonly ending: Ending | null;
}
