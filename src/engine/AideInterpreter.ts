import { Effect } from "effect";
import { computeAccuracy, isFactionConflict, isSpecialtyMatch, selectAide, type Aide } from "../domain/Aide";
import {
  CONCEAL_AMBITION_MIN,
  CONCEAL_BASE_CHANCE,
  CONCEAL_DIVISOR,
  CONCEAL_LOYALTY_MAX,
  ESTIMATE_ERROR_DIVISOR,
  HOLLOW_DISCLOSE_ABILITY_MIN,
  OVERLOAD_SEVERE,
  SHORTAGE_SEVERE,
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
import type {
  AideAdjustment,
  AideReport,
  Completion,
  Distortion,
  EventNote,
  ExecutionNote,
  ReportItem,
  ReportNote,
} from "../domain/TurnRecord";
import { PARAM_KEYS, SWAPPABLE_TARGETS, type BuildingId, type ParamKey } from "../domain/Vocabulary";
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
  adminBonus = 0,
): Effect.Effect<AideAdjustment | null, never, Rng> =>
  Effect.gen(function* () {
    const selection = selectAide(aides, intent.action, intent.target);
    if (selection === null) return null;
    const { aide, reason } = selection;
    const specialtyMatch = isSpecialtyMatch(aide, intent.action, intent.target);
    const factionConflict = isFactionConflict(aide, intent.action, intent.target, intent.magnitude);
    const accuracy = computeAccuracy(aide, specialtyMatch, factionConflict, adminBonus);
    const base = { aideId: aide.id, reason, accuracy, adminBonus, specialtyMatch, factionConflict };
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

export interface ProjectEstimate {
  readonly building: BuildingId;
  readonly count: number;
  /** 今の割り振りが続いたときの残り年数（Infinity は「進まない」） */
  readonly trueTurns: number;
}

export interface ReportContext {
  readonly delta: ParamDelta;
  readonly actingAideId: string | null;
  readonly executionNotes: readonly ExecutionNote[];
  readonly metaRemoved: boolean;
  /** 未開示の空洞の建物（種類ごとの棟数） */
  readonly undisclosedHollow: Readonly<Partial<Record<BuildingId, number>>>;
  readonly projects: readonly ProjectEstimate[];
  readonly completions: readonly Completion[];
  readonly materialShortage: number;
  readonly overload: number;
  readonly events: readonly EventNote[];
}

export interface ReportsResult {
  readonly reports: readonly AideReport[];
  /** 能力の高い側近が開示した空洞の種類（地図の亀裂。Z-13） */
  readonly disclosedKinds: readonly BuildingId[];
}

/** 報告に値する資材不足の下限 */
const SHORTAGE_REPORT_MIN = 0.05;

/** 工期の見積り（能力が低いほど誤差が大きい。Z-03） */
const estimate = (aide: Aide, trueTurns: number): Effect.Effect<number | null, never, Rng> =>
  Effect.gen(function* () {
    if (!Number.isFinite(trueTurns)) return null;
    const error = (PARAM_MAX - aide.ability) / ESTIMATE_ERROR_DIVISOR;
    const noisy = trueTurns * (1 + (yield* randRange(-error, error)));
    return Math.max(1, Math.round(noisy));
  });

export const buildAideReports = (
  aides: readonly Aide[],
  context: ReportContext,
): Effect.Effect<ReportsResult, never, Rng> =>
  Effect.gen(function* () {
    const allItems: ReportItem[] = PARAM_KEYS.filter((param) => Math.abs(context.delta[param]) >= REPORT_MIN_DELTA).map(
      (param) => ({ param, delta: context.delta[param] }),
    );
    const disclosed = new Set<BuildingId>();
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
      // イベントは全員が報告する（Z-09）
      notes.push(...context.events.map((note): ReportNote => ({ kind: "event", note })));
      notes.push(...context.completions.map((c): ReportNote => ({ kind: "completed", building: c.building, count: c.count, repair: c.repair })));
      for (const p of context.projects) {
        notes.push({ kind: "constructionEstimate", building: p.building, count: p.count, turns: yield* estimate(aide, p.trueTurns) });
      }
      // 都合の悪い報告（資材不足・無理な命令・空洞）は、隠蔽した側近は口にしない（v3.2 §1.8）
      if (!concealed) {
        if (context.materialShortage > SHORTAGE_REPORT_MIN) notes.push({ kind: "materialShortage", severe: context.materialShortage > SHORTAGE_SEVERE });
        if (context.overload > OVERLOAD_SEVERE) notes.push({ kind: "overload" });
        if (aide.ability >= HOLLOW_DISCLOSE_ABILITY_MIN) {
          for (const [building, count] of Object.entries(context.undisclosedHollow) as [BuildingId, number][]) {
            if (count > 0) {
              notes.push({ kind: "hollowDisclosed", building, count });
              disclosed.add(building);
            }
          }
        }
      }
      reports.push({ aideId: aide.id, items: visible, notes, hiddenItems: hidden, concealed });
    }
    return { reports, disclosedKinds: [...disclosed] };
  });
