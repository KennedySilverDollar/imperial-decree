import type { ParamDelta } from "../domain/GameState";
import type { IntentEvaluation } from "../domain/IntentDeclaration";
import type {
  AideAdjustment,
  Completion,
  EventNote,
  Execution,
  ExecutionNote,
  Interpretation,
  ReportNote,
  TurnRecord,
} from "../domain/TurnRecord";
import { PARAM_KEYS } from "../domain/Vocabulary";
import { aideName, messages } from "../i18n/messages";

// 3段表示＋意図比較（SPEC §6.5, §12.6 / A-05, A-07）。TurnRecord から取り出すだけで状態は変えない。
// 秘匿値（派生指標・資材・建材・新聞の truthfulness・空洞の棟数）はここに含めない（CLAUDE.md §4-13）。

export interface ThreeTierView {
  /** ① 参謀の解釈（側近不在なら null） */
  readonly interpretation: Interpretation | null;
  /** ② 側近による補正：選ばれた側近・理由・歪み・発注の縮小や不成立 */
  readonly correction: {
    readonly adjustment: AideAdjustment | null;
    readonly execution: Execution;
  };
  /** ③ 実際の結果：台帳の変化、その年に完成した普請、イベント */
  readonly result: {
    readonly delta: ParamDelta;
    readonly completions: readonly Pick<Completion, "building" | "count" | "repair">[];
    readonly events: readonly EventNote[];
  };
  /** ④ 意図比較（宣言時のみ） */
  readonly intentComparison: { readonly evaluation: IntentEvaluation; readonly bonusHappiness: number } | null;
}

export const buildThreeTierView = (record: TurnRecord): ThreeTierView => ({
  interpretation: record.interpretation,
  correction: { adjustment: record.aideAdjustment, execution: record.execution },
  result: {
    delta: record.actualResult,
    // 空洞になった棟数は秘匿（プレイヤーには「完成した」としか見えない）
    completions: record.construction.completions.map(({ building, count, repair }) => ({ building, count, repair })),
    events: record.events,
  },
  intentComparison:
    record.intentEvaluation === null ? null : { evaluation: record.intentEvaluation, bonusHappiness: record.bonusHappiness },
});

// --- 文面化（UI とログ用。文言は messages.ts） ---

export const renderExecutionNote = (note: ExecutionNote): string => {
  const e = messages.execution;
  switch (note.kind) {
    case "noAide":
      return e.noAide;
    case "noop":
      return e.noop[note.reason];
    case "ordered": {
      const base = e.ordered(messages.targets[note.building], note.count, note.repair);
      return note.limitedBy === null ? base : `${base}（${e.limited(note.requested, note.count, note.limitedBy)}）`;
    }
    case "orderFailed":
      return e.orderFailed(messages.targets[note.building], note.reason, note.detail === null ? null : messages.targets[note.detail]);
    case "policyChanged":
      return messages.policyLevel(note.policy, note.from, note.to);
  }
};

export const renderEventNote = (note: EventNote): string => {
  const r = messages.reports.event;
  const name = messages.events[note.event];
  switch (note.kind) {
    case "started":
      return r.started(name);
    case "ongoing":
      return r.ongoing(name, note.turns);
    case "resolved":
      return r.resolved(name);
    case "expired":
      return r.expired(name);
  }
};

export const renderReportNote = (note: ReportNote): string => {
  const r = messages.reports;
  switch (note.kind) {
    case "execution":
      return renderExecutionNote(note.note);
    case "metaIgnored":
      return r.metaIgnored;
    case "hollowDisclosed":
      return r.hollowDisclosed(messages.targets[note.building], note.count);
    case "constructionEstimate":
      return r.constructionEstimate(messages.targets[note.building], note.count, note.turns);
    case "completed":
      return r.completed(messages.targets[note.building], note.count, note.repair);
    case "materialShortage":
      return r.materialShortage(note.severe);
    case "overload":
      return r.overload;
    case "event":
      return renderEventNote(note.note);
  }
};

export interface RenderedThreeTier {
  readonly interpretation: readonly string[];
  readonly correction: readonly string[];
  readonly result: readonly string[];
  readonly intentComparison: readonly string[] | null;
}

const describeIntent = (intent: Interpretation["intent"]) =>
  messages.interpretation.summary(
    messages.actions[intent.action],
    intent.target === null ? messages.interpretation.unknownTarget : messages.targets[intent.target],
    intent.magnitude,
    intent.budget,
  );

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

  const result = [
    ...PARAM_KEYS.filter((param) => Math.round(view.result.delta[param]) !== 0).map((param) =>
      messages.reports.item(messages.params[param], view.result.delta[param]),
    ),
    ...view.result.completions.map((c) => messages.reports.completed(messages.targets[c.building], c.count, c.repair)),
    ...view.result.events.map(renderEventNote),
  ];

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
