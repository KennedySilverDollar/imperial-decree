import { Delaunay } from "d3-delaunay";
import {
  CROSS_SITE_SLACK_M,
  LLOYD_ITERATIONS,
  LLOYD_STEP,
  PARCEL_JITTER_ACROSS_M,
  PARCEL_JITTER_ALONG_M,
  PARCEL_JITTER_CROSS_M,
  PARCEL_SITE_MARGIN_M,
} from "./mapConstants";
import { cellLocalBounds, toWorld } from "./terrain/geometry";
import { createRandom, range, subSeed } from "./terrain/rng";
import { PARCEL_M, VILLAGE_CELLS } from "./terrain/terrainConstants";
import type { HeightField, Point, Polygon, VillageFrame } from "./terrain/types";
import { villageHeightAt } from "./terrain/Village";

// 区画の写像（SPEC_v3.4 §4.1、AA-10）。表示専用：論理グリッドの100セルを、地形に沿った不揃いな多角形にする。
// どのセルが道路・建物かは MapState（MapViewModel.parcels）のまま。ここは形だけを決める。
// 1) 各セルの中心に母点を置き、段丘面の等高線に沿う向きへ大きく、横切る向きへ小さく揺らす（区画が等高線に沿って伸びる）
// 2) 村域の正方形で切った Voronoi 分割（d3-delaunay）→ 重心へ寄せる Lloyd 緩和を、母点がセルの枠から出ない制約つきで数回
// 母点が自分のセルの枠の中にあり、分割は正方形を覆うので、区画は重ならず隙間がなく、セルと1対1。
// 十字の本通りのセルは、通りを横切る向きにはほとんど揺らさない（本通りの帯がまっすぐ連なるように）。

export interface ParcelShape {
  readonly gridIndex: number;
  readonly x: number;
  readonly y: number;
  /** 母点（局所座標 a, b） */
  readonly siteLocal: Point;
  /** 母点（地図座標） */
  readonly site: Point;
  /** 多角形（局所座標） */
  readonly local: Polygon;
  /** 多角形（地図座標） */
  readonly polygon: Polygon;
  /** 等高線に沿う向き（局所座標の角度、rad）。畝・建物の向きに使う */
  readonly contourAngle: number;
}

export type VillageHeights = HeightField & { readonly windowHalfM: number };

const ROAD_LINE = 4;

const centroid = (poly: readonly Point[]): Point => {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const p = poly[j]!;
    const q = poly[i]!;
    const cross = p[0] * q[1] - q[0] * p[1];
    a += cross;
    cx += (p[0] + q[0]) * cross;
    cy += (p[1] + q[1]) * cross;
  }
  if (Math.abs(a) < 1e-9) return poly[0]!;
  return [cx / (3 * a), cy / (3 * a)];
};

/** 等高線に沿う向き（局所座標）。勾配がほぼなければ川と平行（a 軸） */
export const contourAngleAt = (h: VillageHeights, a: number, b: number): number => {
  const d = 7.5;
  const ga = (villageHeightAt(h, a + d, b) - villageHeightAt(h, a - d, b)) / (2 * d);
  const gb = (villageHeightAt(h, a, b + d) - villageHeightAt(h, a, b - d)) / (2 * d);
  if (Math.hypot(ga, gb) < 1e-4) return 0;
  return Math.atan2(ga, -gb);
};

export const mapParcels = (F: VillageFrame, heights: VillageHeights, terrainSeed: number): ParcelShape[] => {
  const half = F.halfM;
  const random = createRandom(subSeed(terrainSeed, 7000));
  const count = VILLAGE_CELLS * VILLAGE_CELLS;
  const boxes = Array.from({ length: count }, (_, k) => {
    const x = k % VILLAGE_CELLS;
    const y = Math.floor(k / VILLAGE_CELLS);
    const { a0, a1, b0, b1 } = cellLocalBounds(x, y, half);
    const m = PARCEL_SITE_MARGIN_M;
    // 十字の通りのセルは、通りを横切る向きの母点の位置を中心線のごく近くに絞る
    const ca = (a0 + a1) / 2;
    const cb = (b0 + b1) / 2;
    const s = CROSS_SITE_SLACK_M;
    return {
      x,
      y,
      a0: x === ROAD_LINE ? ca - s : a0 + m,
      a1: x === ROAD_LINE ? ca + s : a1 - m,
      b0: y === ROAD_LINE ? cb - s : b0 + m,
      b1: y === ROAD_LINE ? cb + s : b1 - m,
      center: [ca, cb] as Point,
    };
  });
  const clamp = (k: number, p: Point): Point => {
    const box = boxes[k]!;
    return [Math.min(box.a1, Math.max(box.a0, p[0])), Math.min(box.b1, Math.max(box.b0, p[1]))];
  };
  const angles = boxes.map((box) => contourAngleAt(heights, box.center[0], box.center[1]));
  let sites: Point[] = boxes.map((box, k) => {
    const t = angles[k]!;
    const along = range(random, -1, 1) * PARCEL_JITTER_ALONG_M;
    const onCross = box.x === ROAD_LINE || box.y === ROAD_LINE;
    const across = range(random, -1, 1) * (onCross ? PARCEL_JITTER_CROSS_M : PARCEL_JITTER_ACROSS_M);
    return clamp(k, [box.center[0] + Math.cos(t) * along - Math.sin(t) * across, box.center[1] + Math.sin(t) * along + Math.cos(t) * across]);
  });
  const bounds: [number, number, number, number] = [-half, -half, half, half];
  const cellsOf = (pts: Point[]) => {
    const voronoi = Delaunay.from(pts).voronoi(bounds);
    return pts.map((_, k) => {
      const ring = voronoi.cellPolygon(k) ?? [];
      return ring.slice(0, -1).map(([a, b]) => [a, b] as Point);
    });
  };
  for (let it = 0; it < LLOYD_ITERATIONS; it++) {
    const cells = cellsOf(sites);
    sites = sites.map((p, k) => {
      const c = centroid(cells[k]!);
      return clamp(k, [p[0] + (c[0] - p[0]) * LLOYD_STEP, p[1] + (c[1] - p[1]) * LLOYD_STEP]);
    });
  }
  const cells = cellsOf(sites);
  return boxes.map((box, k) => {
    const local = cells[k]!;
    const siteLocal = sites[k]!;
    return {
      gridIndex: k,
      x: box.x,
      y: box.y,
      siteLocal,
      site: toWorld(F, siteLocal[0], siteLocal[1]),
      local,
      polygon: local.map((p) => toWorld(F, p[0], p[1])),
      contourAngle: angles[k]!,
    };
  });
};

/** 1区画の面積の目安（テスト用） */
export const PARCEL_AREA_M2 = PARCEL_M * PARCEL_M;
