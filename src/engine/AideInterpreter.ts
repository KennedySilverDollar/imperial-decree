import { Effect } from "effect";
import { computeAccuracy, isFactionConflict, isSpecialtyMatch, selectAide, type Aide } from "../domain/Aide";
import {
  CONCEAL_AMBITION_MIN,
  CONCEAL_BASE_CHANCE,
  CONCEAL_DIVISOR,
  CONCEAL_LOYALTY_MAX,
  HOLLOW_DISCLOSE_ABILITY_MIN,
  MISREAD_CHANCE_SCALE,
  MISREAD_MAX,
  MISREAD_MIN,
  MISREAD_UPWARD_CHANCE,
  PARAM_MAX,
  REPORT_LOW_TRUST_MAX_ITEMS,
  REPORT_LOW_TRUST_THRESHOLD,
  REPORT_MIN_DELTA,
  REPORT_OMIT_CHANCE_DIVISOR,
  TARGET_SWAP_CHANCE_SCALE,
  WATER_DOWN_BASE_CHANCE,
  WATER_DOWN_EFFECT_FACTOR,
  WATER_DOWN_LOYALTY_DIVISOR,
} from "../domain/constants";
import type { DecreeIntent } from "../domain/DecreeIntent";
import type { ParamDelta } from "../domain/GameState";
import type { AideAdjustment, AideReport, Distortion, ExecutionNote, ReportItem, ReportNote } from "../domain/TurnRecord";
import { PARAM_KEYS, SWAPPABLE_TARGETS, type ParamKey } from "../domain/Vocabulary";
import { chance, pick, randRange, type Rng } from "../services/Rng";

// 側近による解釈と歪み（SPEC §6.3, §6.4 / A-04, A-05 / BALANCE §4）

/** 歪みの対象になる指示か（意味の取れない指示・任免は歪めようがない） */
const isDistortable = (intent: DecreeIntent): boolean =>
  intent.target !== null && intent.action !== "appoint" && intent.action !== "dismiss";

export const misreadChance = (accuracy: number): number => (1 - accuracy) * MISREAD_CHANCE_SCALE;
export const targetSwapChance = (accuracy: number): number => (1 - accuracy) * TARGET_SWAP_CHANCE_SCALE;
export const waterDownChance = (aide: Aide): number =>
  WATER_DOWN_BASE_CHANCE + (PARAM_MAX - aide.loyalty) / WATER_DOWN_LOYALTY_DIVISOR;
export const canConceal = (aide: Aide): boolean =>
  aide.ambition >= CONCEAL_AMBITION_MIN && aide.loyalty <= CONCEAL_LOYALTY_MAX;
export const concealChance = (aide: Aide): number =>
  CONCEAL_BASE_CHANCE + (aide.ambition - aide.loyalty) / CONCEAL_DIVISOR;
export const omitChance = (aide: Aide): number => (PARAM_MAX - aide.ability) / REPORT_OMIT_CHANCE_DIVISOR;

/** 担当側近を選び、歪みを判定する（誤読 → 取り違え → 骨抜き の順に独立判定） */
export const interpret = (
  aides: readonly Aide[],
  intent: DecreeIntent,
): Effect.Effect<AideAdjustment | null, never, Rng> =>
  Effect.gen(function* () {
    const selection = selectAide(aides, intent.action, intent.target);
    if (selection === null) return null;
    const { aide, reason } = selection;
    const specialtyMatch = isSpecialtyMatch(aide, intent.action, intent.target);
    const factionConflict = isFactionConflict(aide, intent.action, intent.target, intent.magnitude);
    const accuracy = computeAccuracy(aide, specialtyMatch, factionConflict);
    const base = { aideId: aide.id, reason, accuracy, specialtyMatch, factionConflict };
    if (!isDistortable(intent)) {
      return { ...base, distortions: [], adjustedIntent: intent, effectFactor: 1 };
    }

    const distortions: Distortion[] = [];
    let adjusted = intent;

    if (yield* chance(misreadChance(accuracy))) {
      const sign = (yield* chance(MISREAD_UPWARD_CHANCE)) ? 1 : -1;
      const factor = 1 + sign * (yield* randRange(MISREAD_MIN, MISREAD_MAX));
      const to = adjusted.magnitude * factor;
      distortions.push({ kind: "misread", factor, from: adjusted.magnitude, to });
      adjusted = { ...adjusted, magnitude: to };
    }

    if (!specialtyMatch && adjusted.target !== null && (yield* chance(targetSwapChance(accuracy)))) {
      const from = adjusted.target;
      const to = yield* pick(SWAPPABLE_TARGETS[adjusted.action].filter((target) => target !== from));
      if (to !== undefined) {
        distortions.push({ kind: "targetSwap", from, to });
        adjusted = { ...adjusted, target: to };
      }
    }

    let effectFactor = 1;
    if (
      isFactionConflict(aide, adjusted.action, adjusted.target, adjusted.magnitude) &&
      (yield* chance(waterDownChance(aide)))
    ) {
      effectFactor = WATER_DOWN_EFFECT_FACTOR;
      distortions.push({ kind: "waterDown", factor: effectFactor });
    }

    return { ...base, distortions, adjustedIntent: adjusted, effectFactor };
  });

// --- 側近報告（SPEC §4.3, §5.2 / DECISIONS D-28 / BALANCE §4.5） ---

const isWorsened = (param: ParamKey, delta: number): boolean => (param === "corruption" ? delta > 0 : delta < 0);

export interface ReportContext {
  readonly delta: ParamDelta;
  readonly actingAideId: string | null;
  readonly executionNotes: readonly ExecutionNote[];
  readonly metaRemoved: boolean;
  readonly hollowInfrastructure: number;
}

export interface ReportsResult {
  readonly reports: readonly AideReport[];
  readonly hollowDisclosed: boolean;
}

export const buildAideReports = (
  aides: readonly Aide[],
  context: ReportContext,
): Effect.Effect<ReportsResult, never, Rng> =>
  Effect.gen(function* () {
    const allItems: ReportItem[] = PARAM_KEYS.filter((param) => Math.abs(context.delta[param]) >= REPORT_MIN_DELTA).map(
      (param) => ({ param, delta: context.delta[param] }),
    );
    let hollowDisclosed = false;
    const reports: AideReport[] = [];

    for (const aide of aides) {
      const concealed = canConceal(aide) && (yield* chance(concealChance(aide)));
      const visible: ReportItem[] = [];
      const hidden: ReportItem[] = [];
      for (const item of allItems) {
        if (concealed && isWorsened(item.param, item.delta)) {
          hidden.push(item);
        } else if (yield* chance(omitChance(aide))) {
          hidden.push(item);
        } else {
          visible.push(item);
        }
      }
      if (aide.trust < REPORT_LOW_TRUST_THRESHOLD) hidden.push(...visible.splice(REPORT_LOW_TRUST_MAX_ITEMS));

      const notes: ReportNote[] = [];
      if (aide.id === context.actingAideId) {
        if (context.metaRemoved) notes.push({ kind: "metaIgnored" });
        notes.push(...context.executionNotes.map((note): ReportNote => ({ kind: "execution", note })));
      }
      if (context.hollowInfrastructure > 0 && aide.ability >= HOLLOW_DISCLOSE_ABILITY_MIN) {
        notes.push({ kind: "hollowDisclosed", amount: context.hollowInfrastructure });
        hollowDisclosed = true;
      }
      reports.push({ aideId: aide.id, items: visible, notes, hiddenItems: hidden, concealed });
    }
    return { reports, hollowDisclosed };
  });
