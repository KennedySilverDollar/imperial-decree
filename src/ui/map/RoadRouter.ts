import { ROAD_SMOOTHING, SIDE_PATH_MAX_M } from "./mapConstants";
import type { BuildingView, ParcelView, RoadView } from "./MapViewModel";
import type { ParcelShape } from "./ParcelMapper";
import { chaikin, pointInPolygon, toWorld } from "./terrain/geometry";
import { armEnd } from "./terrain/Highway";
import type { ArmEnd, Point, Polyline, VillageFrame } from "./terrain/types";

// 本通り（SPEC_v3.4 §4.2、I-16）。表示専用：中央の十字の区画の連なりを、区画の母点に沿って曲がる帯として描く。
// 描くのは整備済みの区画（MapViewModel.roads。本数 = floor(インフラ/5)、最大19）の分だけ。
// 未整備のうち街道へ続く腕は踏み跡（細い破線）にする。脇道は完成した建物から本通りへ引く装飾で、状態に依存しない。

const ROAD_LINE = 4;
const CELLS = 10;

/** 1本の腕：十字の端から端までの曲線と、各セルの受け持ち区間 */
interface Arm {
  readonly line: Point[];
  /** セル（gridIndex）→ 区間 [s0, s1]（曲線に沿った距離） */
  readonly spans: Map<number, readonly [number, number]>;
}

export interface RoadPiece {
  readonly gridIndex: number;
  readonly points: Polyline;
}

export interface SidePath {
  readonly buildingId: number;
  readonly points: Polyline;
}

export interface RoadLayout {
  /** 整備済みの区画ごとの帯の中心線（中央の区画は横・縦の2本） */
  readonly pieces: readonly RoadPiece[];
  /** 街道へ続く腕の未整備の部分（踏み跡） */
  readonly trail: Polyline;
  readonly sidePaths: readonly SidePath[];
}

const cumulative = (line: readonly Point[]): number[] => {
  const s = [0];
  for (let k = 1; k < line.length; k++) s.push(s[k - 1]! + Math.hypot(line[k]![0] - line[k - 1]![0], line[k]![1] - line[k - 1]![1]));
  return s;
};

const nearestParam = (line: readonly Point[], acc: readonly number[], p: Point): number => {
  let best = 0;
  let bestD = Infinity;
  for (let k = 0; k + 1 < line.length; k++) {
    const a = line[k]!;
    const b = line[k + 1]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
    const d = Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
    if (d < bestD) {
      bestD = d;
      best = acc[k]! + t * (acc[k + 1]! - acc[k]!);
    }
  }
  return best;
};

/** 曲線の [s0, s1] の部分 */
export const slicePolyline = (line: readonly Point[], s0: number, s1: number): Point[] => {
  const acc = cumulative(line);
  const at = (s: number): Point => {
    for (let k = 0; k + 1 < line.length; k++) {
      if (s <= acc[k + 1]! || k + 2 === line.length) {
        const span = acc[k + 1]! - acc[k]! || 1;
        const t = Math.max(0, Math.min(1, (s - acc[k]!) / span));
        return [line[k]![0] + (line[k + 1]![0] - line[k]![0]) * t, line[k]![1] + (line[k + 1]![1] - line[k]![1]) * t];
      }
    }
    return line[line.length - 1]!;
  };
  const out: Point[] = [at(s0)];
  for (let k = 0; k < line.length; k++) if (acc[k]! > s0 && acc[k]! < s1) out.push(line[k]!);
  out.push(at(s1));
  return out;
};

const buildArm = (F: VillageFrame, sites: readonly Point[], cells: readonly number[], horizontal: boolean): Arm => {
  // 腕の両端は十字の端の点（街道の始点と同じ）。横の腕は上流 → 下流、縦の腕は丘側 → 川側
  const startLocal = armEnd(F, horizontal ? "upstream" : "hillside").local;
  const endLocal = armEnd(F, horizontal ? "downstream" : "riverside").local;
  const raw = [startLocal, ...sites, endLocal];
  const smooth = chaikin(raw, ROAD_SMOOTHING);
  const acc = cumulative(smooth);
  const cuts = [0];
  for (let k = 0; k + 1 < sites.length; k++) {
    const mid: Point = [(sites[k]![0] + sites[k + 1]![0]) / 2, (sites[k]![1] + sites[k + 1]![1]) / 2];
    cuts.push(nearestParam(smooth, acc, mid));
  }
  cuts.push(acc[acc.length - 1]!);
  const spans = new Map<number, readonly [number, number]>();
  cells.forEach((g, k) => spans.set(g, [cuts[k]!, cuts[k + 1]!]));
  return { line: smooth.map((p) => toWorld(F, p[0], p[1])), spans };
};

export const armCells = (horizontal: boolean): number[] =>
  Array.from({ length: CELLS }, (_, k) => (horizontal ? ROAD_LINE * CELLS + k : k * CELLS + ROAD_LINE));

const ARM_OF: Record<ArmEnd, { horizontal: boolean; fromStart: boolean }> = {
  upstream: { horizontal: true, fromStart: true },
  downstream: { horizontal: true, fromStart: false },
  hillside: { horizontal: false, fromStart: true },
  riverside: { horizontal: false, fromStart: false },
};

export const routeRoads = (
  F: VillageFrame,
  shapes: readonly ParcelShape[],
  parcels: readonly ParcelView[],
  roads: readonly RoadView[],
  buildings: readonly BuildingView[],
  highwayFrom: ArmEnd,
): RoadLayout => {
  const arms = [true, false].map((horizontal) => {
    const cells = armCells(horizontal);
    return { horizontal, cells, arm: buildArm(F, cells.map((g) => shapes[g]!.siteLocal), cells, horizontal) };
  });
  const built = new Set(roads.map((r) => r.gridIndex));
  const pieces: RoadPiece[] = [];
  for (const r of roads) {
    for (const { arm } of arms) {
      const span = arm.spans.get(r.gridIndex);
      if (span) pieces.push({ gridIndex: r.gridIndex, points: slicePolyline(arm.line, span[0], span[1]) });
    }
  }
  // 街道へ続く腕の、まだ整備されていない外側の区間を踏み跡にする
  const way = ARM_OF[highwayFrom];
  const { arm, cells } = arms.find((x) => x.horizontal === way.horizontal)!;
  const side = way.fromStart ? cells.slice(0, ROAD_LINE + 1) : cells.slice(ROAD_LINE);
  const unbuilt = side.filter((g) => !built.has(g)).map((g) => arm.spans.get(g)!);
  const trail =
    unbuilt.length === 0
      ? []
      : slicePolyline(arm.line, Math.min(...unbuilt.map((s) => s[0])), Math.max(...unbuilt.map((s) => s[1])));

  // 脇道：完成した建物の母点から、整備済みの本通りの最寄りの点へ。他の建物・普請中の区画を通るものは引かない
  const roadPoints = pieces.flatMap((p) => p.points);
  const blocked = new Set(parcels.filter((p) => p.use === "building" || p.use === "construction").map((p) => p.gridIndex));
  const sidePaths: SidePath[] = [];
  if (roadPoints.length > 0) {
    for (const b of buildings) {
      const from = shapes[b.gridIndex]!.site;
      let to = roadPoints[0]!;
      for (const q of roadPoints) if (Math.hypot(q[0] - from[0], q[1] - from[1]) < Math.hypot(to[0] - from[0], to[1] - from[1])) to = q;
      const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
      if (len > SIDE_PATH_MAX_M || len < 1) continue;
      const steps = Math.ceil(len / 4);
      let ok = true;
      for (let s = 1; s < steps && ok; s++) {
        const p: Point = [from[0] + ((to[0] - from[0]) * s) / steps, from[1] + ((to[1] - from[1]) * s) / steps];
        const owner = shapes.find((sh) => pointInPolygon(p, sh.polygon));
        if (owner && owner.gridIndex !== b.gridIndex && blocked.has(owner.gridIndex)) ok = false;
      }
      if (ok) sidePaths.push({ buildingId: b.id, points: [from, to] });
    }
  }
  return { pieces, trail, sidePaths };
};
