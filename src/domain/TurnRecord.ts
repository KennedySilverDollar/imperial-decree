import type { SelectionReason } from "./Aide";
import type { BuildingId, PolicyId, Target } from "./Buildings";
import type { Decree } from "./Decree";
import type { DecreeIntent, IntentSource } from "./DecreeIntent";
import type { DerivedStats } from "./DerivedStats";
import type { Ending } from "./Ending";
import type { EventKind } from "./Events";
import type { ParamDelta, Params } from "./GameState";
import type { IntentDeclaration, IntentEvaluation } from "./IntentDeclaration";
import type { Newspaper } from "./News";
import type { NoopReason, ParamKey } from "./Vocabulary";

export type { NoopReason } from "./Vocabulary";

// 1ターンの記録（SPEC §11.4 TurnRecord ＋ v3.2 ＋ v3.3）。3段表示＋意図比較はここから組み立てる。
// 派生指標・新聞の truthfulness・資材などの秘匿値も分析用に入っているが、UI には出さない（CLAUDE.md §4-13）。

/** ① 参謀の解釈 */
export interface Interpretation {
  readonly intent: DecreeIntent;
  readonly source: IntentSource;
  readonly metaRemoved: boolean;
  readonly clampedFields: readonly string[];
  readonly fallbackReason: LLMFailureReason | null;
}

export type LLMFailureReason = "timeout" | "network" | "invalidJson" | "schemaViolation" | "rateLimited" | "rejected";

export type Distortion =
  | { readonly kind: "misread"; readonly factor: number; readonly from: number; readonly to: number }
  | { readonly kind: "targetSwap"; readonly from: Target; readonly to: Target }
  | { readonly kind: "waterDown"; readonly factor: number };

/** ② 側近による補正 */
export interface AideAdjustment {
  readonly aideId: string;
  readonly reason: SelectionReason;
  readonly accuracy: number;
  /** 行政能力による精度の加算（v3.2 §2.5） */
  readonly adminBonus: number;
  readonly specialtyMatch: boolean;
  readonly factionConflict: boolean;
  readonly distortions: readonly Distortion[];
  readonly adjustedIntent: DecreeIntent;
  /** 骨抜きによる効果倍率（1 または WATER_DOWN_EFFECT_FACTOR） */
  readonly effectFactor: number;
}

/** 発注できなかった理由（V-09） */
export type OrderFailure =
  | "prerequisite"
  | "population"
  | "maxCount"
  | "treasury"
  | "budget"
  | "tiles"
  | "nothingToRepair";

/** 棟数を減らした理由（A-07 / V-07） */
export type OrderLimit = "treasury" | "budget" | "tiles";

export type ExecutionNote =
  | { readonly kind: "noAide" }
  | { readonly kind: "noop"; readonly reason: NoopReason }
  | {
      readonly kind: "ordered";
      readonly building: BuildingId;
      readonly requested: number;
      readonly count: number;
      readonly repair: boolean;
      readonly limitedBy: OrderLimit | null;
      readonly cost: number;
    }
  | { readonly kind: "orderFailed"; readonly building: BuildingId; readonly reason: OrderFailure; readonly detail: BuildingId | null }
  | { readonly kind: "policyChanged"; readonly policy: PolicyId; readonly from: number; readonly to: number };

/** 勅令の実行結果（自然変化の前） */
export interface Execution {
  readonly notes: readonly ExecutionNote[];
  /** 勅令による国庫支出（DECREE_BASE_COST を除く） */
  readonly cost: number;
  /** 基本コストを取ったか（無効・前提未達は取らない。W-11） */
  readonly baseCostCharged: boolean;
}

/** その年に完成した工事（v3.3） */
export interface Completion {
  readonly building: BuildingId;
  readonly count: number;
  readonly repair: boolean;
  /** 完成時に空洞になった棟数（分析用。プレイヤーには見せない） */
  readonly hollowCount: number;
}

/** その年の工事の状況（分析用。秘匿値を含む） */
export interface ConstructionReport {
  readonly laborForce: number;
  readonly laborDemand: number;
  readonly overload: number;
  readonly materialShortage: number;
  readonly completions: readonly Completion[];
  readonly materialsAfter: { readonly wood: number; readonly stone: number };
}

export type EventNote =
  | { readonly kind: "started"; readonly event: EventKind }
  | { readonly kind: "ongoing"; readonly event: EventKind; readonly turns: number }
  | { readonly kind: "resolved"; readonly event: EventKind }
  | { readonly kind: "expired"; readonly event: EventKind };

export interface ReportItem {
  readonly param: ParamKey;
  readonly delta: number;
}

export type ReportNote =
  | { readonly kind: "execution"; readonly note: ExecutionNote }
  | { readonly kind: "metaIgnored" }
  | { readonly kind: "hollowDisclosed"; readonly building: BuildingId; readonly count: number }
  | { readonly kind: "constructionEstimate"; readonly building: BuildingId; readonly count: number; readonly turns: number | null }
  | { readonly kind: "completed"; readonly building: BuildingId; readonly count: number; readonly repair: boolean }
  | { readonly kind: "materialShortage"; readonly severe: boolean }
  | { readonly kind: "overload" }
  | { readonly kind: "event"; readonly note: EventNote };

/** 側近報告（実数値の変化を報告。欠落・隠蔽あり。DECISIONS D-28） */
export interface AideReport {
  readonly aideId: string;
  readonly items: readonly ReportItem[];
  readonly notes: readonly ReportNote[];
  /** 隠蔽・欠落で報告から消えた項目。分析用でプレイヤーには見せない */
  readonly hiddenItems: readonly ReportItem[];
  /** 隠蔽が起きたか。分析用でプレイヤーには見せない */
  readonly concealed: boolean;
}

export interface TurnRecord {
  readonly turn: number;
  readonly decree: Decree;
  readonly intentDeclaration: IntentDeclaration | null;
  readonly interpretation: Interpretation | null;
  readonly aideAdjustment: AideAdjustment | null;
  readonly execution: Execution;
  readonly before: Params;
  readonly after: Params;
  /** ③ 実際の結果（ボーナス込みのターン全体の変化） */
  readonly actualResult: ParamDelta;
  readonly construction: ConstructionReport;
  readonly events: readonly EventNote[];
  /** 年末の派生指標（UI 非表示） */
  readonly derived: DerivedStats;
  /** その年の税収と支出（新聞の「税収増」判定にも使う） */
  readonly finance: { readonly taxRevenue: number; readonly upkeep: number };
  /** ④ 意図比較（宣言時のみ） */
  readonly intentEvaluation: IntentEvaluation | null;
  readonly bonusHappiness: number;
  readonly newspaper: Newspaper;
  readonly aideReports: readonly AideReport[];
  readonly ending: Ending | null;
}
