import type { Facilities, ParamDelta } from "../domain/GameState";
import type { IntentEvaluation } from "../domain/IntentDeclaration";
import type { AideAdjustment, Execution, Interpretation, TurnRecord } from "../domain/TurnRecord";
import { PARAM_KEYS } from "../domain/Vocabulary";
import { aideName, messages } from "../i18n/messages";

// 3段表示＋意図比較（SPEC §6.5, §12.6 / A-05, A-07）。TurnRecord から取り出すだけで状態は変えない。

export interface ThreeTierView {
  /** ① 参謀の解釈（側近不在なら null） */
  readonly interpretation: Interpretation | null;
  /** ② 側近による補正：選ばれた側近・理由・歪み・予算縮小などの執行メモ */
  readonly correction: {
    readonly adjustment: AideAdjustment | null;
    readonly execution: Execution;
  };
  /** ③ 実際の結果 */
  readonly result: {
    readonly delta: ParamDelta;
    readonly facilitiesBefore: Facilities;
    readonly facilitiesAfter: Facilities;
  };
  /** ④ 意図比較（宣言時のみ） */
  readonly intentComparison: { readonly evaluation: IntentEvaluation; readonly bonusHappiness: number } | null;
}

export const buildThreeTierView = (record: TurnRecord): ThreeTierView => ({
  interpretation: record.interpretation,
  correction: { adjustment: record.aideAdjustment, execution: record.execution },
  result: {
    delta: record.actualResult,
    facilitiesBefore: record.facilitiesBefore,
    facilitiesAfter: record.facilitiesAfter,
  },
  intentComparison:
    record.intentEvaluation === null
      ? null
      : { evaluation: record.intentEvaluation, bonusHappiness: record.bonusHappiness },
});

// --- 文面化（UI とログ用。文言は messages.ts） ---

export interface RenderedThreeTier {
  readonly interpretation: readonly string[];
  readonly correction: readonly string[];
  readonly result: readonly string[];
  readonly intentComparison: readonly string[] | null;
}

const describeIntent = (intent: { action: keyof typeof messages.actions; target: keyof typeof messages.targets | null; magnitude: number; budget: number }) =>
  messages.interpretation.summary(
    messages.actions[intent.action],
    intent.target === null ? messages.interpretation.unknownTarget : messages.targets[intent.target],
    intent.magnitude,
    intent.budget,
  );

export const renderExecutionNote = (note: Execution["notes"][number]): string => {
  const e = messages.execution;
  switch (note.kind) {
    case "noAide":
      return e.noAide;
    case "noop":
      return e.noop[note.reason];
    case "applied":
      return e.applied;
    case "budgetScaled":
      return e.budgetScaled(note.ratio, note.cause);
    case "nothingAffordable":
      return e.nothingAffordable;
    case "officeBuilt":
      return e.officeBuilt;
    case "officeFailed":
      return e.fixedCostFailed(messages.targets.office, note.reason);
    case "marketBuilt":
      return e.marketBuilt;
    case "marketFailed":
      return e.fixedCostFailed(messages.targets.market, note.reason);
  }
};

export const renderThreeTier = (view: ThreeTierView): RenderedThreeTier => {
  const i = view.interpretation;
  const interpretation =
    i === null
      ? []
      : [
          i.source === "llm" ? messages.interpretation.sourceLlm : messages.interpretation.sourceTemplate,
          describeIntent(i.intent),
          ...(i.fallbackReason === null ? [] : [messages.interpretation.fallback[i.fallbackReason]]),
          ...(i.metaRemoved ? [messages.interpretation.metaRemoved] : []),
          ...(i.clampedFields.length > 0 ? [messages.interpretation.clamped(i.clampedFields)] : []),
        ];

  const a = view.correction.adjustment;
  const distortions =
    a === null
      ? []
      : a.distortions.length === 0
        ? [messages.distortions.none]
        : a.distortions.map((d) =>
            d.kind === "misread"
              ? messages.distortions.misread(d.from, d.to)
              : d.kind === "targetSwap"
                ? messages.distortions.targetSwap(messages.targets[d.from], messages.targets[d.to])
                : messages.distortions.waterDown(d.factor),
          );
  const correction = [
    ...(a === null
      ? []
      : [
          messages.threeTier.chosenAide(aideName(a.aideId), messages.selectionReasons[a.reason]),
          messages.threeTier.accuracy(a.accuracy),
          ...distortions,
        ]),
    ...view.correction.execution.notes.map(renderExecutionNote),
  ];

  const result = PARAM_KEYS.filter((param) => Math.round(view.result.delta[param]) !== 0).map((param) =>
    messages.reports.item(messages.params[param], view.result.delta[param]),
  );

  const c = view.intentComparison;
  const intentComparison =
    c === null
      ? null
      : [
          messages.threeTier.intentLine(
            messages.params[c.evaluation.declaration.targetParam],
            c.evaluation.declaration.targetValue,
            messages.intentDirections[c.evaluation.declaration.direction],
            c.evaluation.measured,
            c.evaluation.achieved,
          ),
          c.bonusHappiness > 0 ? messages.threeTier.bonus(c.bonusHappiness) : messages.threeTier.noBonus,
        ];

  return { interpretation, correction, result, intentComparison };
};
