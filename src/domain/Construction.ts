import { BUILDINGS, type BuildingId } from "./Buildings";
import {
  HOLLOW_CHANCE_CAP,
  HOLLOW_MAX_CHANCE,
  MATERIAL_CAP,
  OVERLOAD_CORRUPTION_PER_TURN,
  OVERLOAD_HOLLOW_GAIN,
  OVERLOAD_SEVERE,
  PERCENT,
  SHORTAGE_CORRUPTION_PER_TURN,
  SHORTAGE_HOLLOW_GAIN,
  SHORTAGE_SEVERE,
} from "./constants";

// 工事台帳と、労働人口・秘匿資材の割り振り（v3.3 / BALANCE §21〜§24 / DECISIONS Y-01〜Y-03, Z-01〜Z-15）。
// 割り振りは「担当側近の配下の役人たち」が行う抽象的な仕組み（Z-01）。乱数は使わない純粋関数。

export interface Materials {
  readonly wood: number;
  readonly stone: number;
}

export interface Project {
  readonly id: number;
  readonly kind: BuildingId;
  readonly count: number;
  /** 修繕の工事か（W-10, Z-14） */
  readonly repair: boolean;
  /** 修繕する建物の通し番号 */
  readonly repairSerials: readonly number[];
  /** 発注時に確保した区画（Z-13） */
  readonly tiles: readonly (readonly [number, number])[];
  readonly orderedTurn: number;
  /** 必要作業量・建材の合計（秘匿値） */
  readonly work: number;
  readonly wood: number;
  readonly stone: number;
  readonly minTurns: number;
  readonly progress: number;
  readonly elapsed: number;
  /** 工事中の最悪の「無理な命令」の超過分（R − 1.5）と、手抜きの不足率 */
  readonly worstOverload: number;
  readonly worstShortage: number;
  /** 骨抜きされた発注（完成時に半数が空洞。Z-15） */
  readonly waterDown: boolean;
}

export const newProject = (
  id: number,
  kind: BuildingId,
  count: number,
  orderedTurn: number,
  options: { repair: boolean; repairSerials: readonly number[]; tiles: readonly (readonly [number, number])[]; waterDown: boolean; costRatio: number },
): Project => {
  const r = BUILDINGS[kind].recipe;
  return {
    id,
    kind,
    count,
    repair: options.repair,
    repairSerials: options.repairSerials,
    tiles: options.tiles,
    orderedTurn,
    work: r.work * count * options.costRatio,
    wood: r.wood * count * options.costRatio,
    stone: r.stone * count * options.costRatio,
    minTurns: r.minTurns,
    progress: 0,
    elapsed: 0,
    worstOverload: 0,
    worstShortage: 0,
    waterDown: options.waterDown,
  };
};

/** 案件が1年に吸収できる労働（最短工期で終えるのに要る量） */
export const projectDemand = (p: Project): number => p.work / p.minTurns;

export interface ConstructionStep {
  readonly projects: readonly Project[];
  readonly finished: readonly Project[];
  readonly materials: Materials;
  /** 需要 / 労働人口 */
  readonly overload: number;
  /** 資材の不足率（木材と石材のうち悪い方） */
  readonly shortage: number;
  readonly laborDemand: number;
  /** その年の汚職率の上昇 */
  readonly corruptionIncrease: number;
}

const EPSILON = 1e-9;

/**
 * 1年分の工事を進める。
 * 労働：需要が労働人口以下なら満額、超えたら全案件を同じ割合で遅らせる（「バランスよく」）。
 * 資材：必要量の比で配る。不足率が SHORTAGE_SEVERE 以下なら待ち（遅れる）、超えたら足りないまま進む（手抜き）。
 */
export const advanceConstruction = (projects: readonly Project[], labor: number, materials: Materials): ConstructionStep => {
  if (projects.length === 0) {
    return { projects, finished: [], materials, overload: 0, shortage: 0, laborDemand: 0, corruptionIncrease: 0 };
  }
  const demands = projects.map(projectDemand);
  const total = demands.reduce((a, b) => a + b, 0);
  const overload = total / Math.max(1, labor);
  const shares = demands.map((d) => (total <= labor ? d : (labor * d) / total));

  const needWood = projects.reduce((sum, p, i) => sum + (p.wood * (shares[i] ?? 0)) / p.work, 0);
  const needStone = projects.reduce((sum, p, i) => sum + (p.stone * (shares[i] ?? 0)) / p.work, 0);
  const woodRatio = needWood <= EPSILON ? 1 : Math.min(1, materials.wood / needWood);
  const stoneRatio = needStone <= EPSILON ? 1 : Math.min(1, materials.stone / needStone);
  const shortage = 1 - Math.min(woodRatio, stoneRatio);
  const severe = shortage > SHORTAGE_SEVERE;
  const severeOverload = Math.max(0, overload - OVERLOAD_SEVERE);

  const updated = projects.map((p, i) => {
    const share = shares[i] ?? 0;
    const progress = severe ? share : share * (1 - shortage);
    return {
      ...p,
      progress: p.progress + progress,
      elapsed: p.elapsed + 1,
      worstOverload: Math.max(p.worstOverload, severeOverload),
      worstShortage: Math.max(p.worstShortage, severe ? shortage : 0),
    };
  });
  const isDone = (p: Project) => p.progress >= p.work - EPSILON && p.elapsed >= p.minTurns;
  return {
    projects: updated.filter((p) => !isDone(p)),
    finished: updated.filter(isDone),
    materials: {
      wood: Math.max(0, materials.wood - needWood * woodRatio),
      stone: Math.max(0, materials.stone - needStone * stoneRatio),
    },
    overload,
    shortage,
    laborDemand: total,
    corruptionIncrease: OVERLOAD_CORRUPTION_PER_TURN * severeOverload + (severe ? SHORTAGE_CORRUPTION_PER_TURN * shortage : 0),
  };
};

/** 完成時の空洞化確率（BALANCE §24）。汚職率そのものの分は v3.2 の5種だけ（Z-07） */
export const hollowChance = (p: Project, corruption: number): number => {
  const base = BUILDINGS[p.kind].hollowableByCorruption ? Math.min(HOLLOW_MAX_CHANCE, corruption / PERCENT) : 0;
  return Math.min(HOLLOW_CHANCE_CAP, base + OVERLOAD_HOLLOW_GAIN * p.worstOverload + SHORTAGE_HOLLOW_GAIN * p.worstShortage);
};

/** 残りの年数の見込み（今の割り振りが続くとして）。側近報告の見積りの元 */
export const remainingTurns = (p: Project, share: number): number => {
  const byWork = share <= EPSILON ? Number.POSITIVE_INFINITY : (p.work - p.progress) / share;
  return Math.max(p.minTurns - p.elapsed, Math.ceil(byWork));
};

export const addMaterials = (m: Materials, wood: number, stone: number): Materials => ({
  wood: Math.min(MATERIAL_CAP, Math.max(0, m.wood + wood)),
  stone: Math.min(MATERIAL_CAP, Math.max(0, m.stone + stone)),
});
