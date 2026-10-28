import { CLEARING_BASE_M, CLEARING_MAX_M, CLEARING_PER_FARM_M, CONSTRUCTION_INSET_M, SCAFFOLD_SPACING_M } from "./mapConstants";
import type { BuildingView, ConstructionView } from "./MapViewModel";
import type { ParcelShape } from "./ParcelMapper";
import { toWorld } from "./terrain/geometry";
import type { Point, Polygon, Polyline, VillageFrame } from "./terrain/types";

// 開墾（SPEC_v3.4 §8.1）と普請中（§8.2）。表示専用の純関数。
// 開墾は「完成した畑」の数と位置だけから決める：畑の区画に耕作の縞を引き、村域の縁の畑は外へ縞を延ばし、
// 村域の周りの森を畑の数に応じて後退させる。作柄（食料）は読まない（§5.1）。
// 普請中は「縄張りと足場」の一様な印。進捗・工期・建材には一切よらない（どの案件・何年目でも同じ形）。

export interface Field {
  readonly polygon: Polygon;
  /** 畝の向き（地図座標の角度、rad） */
  readonly angle: number;
}

export interface ClearingLayout {
  /** 耕作地（区画の中＋村域の外へ延びた分） */
  readonly fields: readonly Field[];
  /** 森が後退した範囲（村域の正方形を広げた多角形。畑がなければ null） */
  readonly clearing: Polygon | null;
  /** 村域の外へ広がった距離（m） */
  readonly reachM: number;
}

const toMapAngle = (F: VillageFrame, localAngle: number): number =>
  Math.atan2(Math.cos(localAngle) * F.axisA[1] + Math.sin(localAngle) * F.axisB[1], Math.cos(localAngle) * F.axisA[0] + Math.sin(localAngle) * F.axisB[0]);

/** 区画の多角形を母点へ向けて縮めたもの（凸なので内側に収まる） */
const shrink = (shape: ParcelShape, by: number): Point[] => {
  const [sa, sb] = shape.siteLocal;
  return shape.local.map(([a, b]) => {
    const d = Math.hypot(a - sa, b - sb) || 1;
    const t = Math.max(0, d - by) / d;
    return [sa + (a - sa) * t, sb + (b - sb) * t] as Point;
  });
};

const roundedSquare = (h: number, r: number): Point[] => {
  const pts: Point[] = [];
  const corners: Point[] = [
    [h, h],
    [-h, h],
    [-h, -h],
    [h, -h],
  ];
  corners.forEach(([ca, cb], k) => {
    for (let q = 0; q <= 6; q++) {
      const ang = (k * Math.PI) / 2 + (q / 6) * (Math.PI / 2);
      pts.push([ca + r * Math.cos(ang), cb + r * Math.sin(ang)]);
    }
  });
  return pts;
};

export const clearingReach = (farmCount: number): number =>
  farmCount === 0 ? 0 : Math.min(CLEARING_MAX_M, CLEARING_BASE_M + CLEARING_PER_FARM_M * farmCount);

export const layoutClearing = (F: VillageFrame, shapes: readonly ParcelShape[], buildings: readonly BuildingView[]): ClearingLayout => {
  const farms = buildings.filter((b) => b.kind === "farm");
  const reach = clearingReach(farms.length);
  const h = F.halfM;
  const fields: Field[] = [];
  for (const farm of farms) {
    const shape = shapes[farm.gridIndex]!;
    const angle = toMapAngle(F, shape.contourAngle);
    fields.push({ polygon: shrink(shape, 3).map(([a, b]) => toWorld(F, a, b)), angle });
    // 村域の縁の畑は、縁に接する辺を外へ押し出した耕作地を足す
    const onEdge = (pred: (p: Point) => boolean) => shape.local.filter(pred);
    const extrude = (pts: Point[], horizontal: boolean, sign: number) => {
      if (pts.length < 2 || reach === 0) return;
      const vals = pts.map((p) => (horizontal ? p[0] : p[1]));
      const lo = Math.min(...vals);
      const hi = Math.max(...vals);
      const edge = sign * h;
      const out = sign * (h + reach);
      const local: Point[] = horizontal
        ? [
            [lo, edge],
            [hi, edge],
            [hi, out],
            [lo, out],
          ]
        : [
            [edge, lo],
            [edge, hi],
            [out, hi],
            [out, lo],
          ];
      fields.push({ polygon: local.map(([a, b]) => toWorld(F, a, b)), angle });
    };
    const eps = 1e-6;
    extrude(onEdge((p) => Math.abs(p[1] - h) < eps), true, 1);
    extrude(onEdge((p) => Math.abs(p[1] + h) < eps), true, -1);
    extrude(onEdge((p) => Math.abs(p[0] - h) < eps), false, 1);
    extrude(onEdge((p) => Math.abs(p[0] + h) < eps), false, -1);
  }
  // 村域の正方形を reach だけ外へ広げ、角を丸めた形（正方形と円の和）。四角い跡が残らないように
  const clearing: Polygon | null = reach === 0 ? null : roundedSquare(h, reach).map(([a, b]) => toWorld(F, a, b));
  return { fields, clearing, reachM: reach };
};

export interface ConstructionMark {
  readonly constructionId: number;
  readonly gridIndex: number;
  /** 縄張り（破線の囲い） */
  readonly rope: Polygon;
  /** 足場の格子（線分の組） */
  readonly scaffold: readonly Polyline[];
  /** 記号を淡く置く位置 */
  readonly anchor: Point;
}

/** 普請中の印。入力は区画の形と案件の区画だけ（進捗・工期・建材は受け取らない） */
export const markConstruction = (F: VillageFrame, shapes: readonly ParcelShape[], works: readonly ConstructionView[]): ConstructionMark[] =>
  works.flatMap((w) =>
    w.gridIndices.map((g) => {
      const shape = shapes[g]!;
      const [sa, sb] = shape.siteLocal;
      const half = SCAFFOLD_SPACING_M * 1.5;
      const lines: Polyline[] = [];
      for (let k = -1.5; k <= 1.5; k++) {
        const o = k * SCAFFOLD_SPACING_M;
        lines.push([toWorld(F, sa + o, sb - half), toWorld(F, sa + o, sb + half)]);
        lines.push([toWorld(F, sa - half, sb + o), toWorld(F, sa + half, sb + o)]);
      }
      return {
        constructionId: w.id,
        gridIndex: g,
        rope: shrink(shape, CONSTRUCTION_INSET_M).map(([a, b]) => toWorld(F, a, b)),
        scaffold: lines,
        anchor: shape.site,
      };
    }),
  );
