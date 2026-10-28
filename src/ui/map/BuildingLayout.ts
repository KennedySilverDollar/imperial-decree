import type { BuildingId } from "../../domain/Buildings";
import { hashString } from "../../domain/Prng";
import { BUILDING_GAP_M, BUILDING_INSET_M, BUILDING_ROTATION_JITTER_DEG } from "./mapConstants";
import type { ParcelShape } from "./ParcelMapper";
import { pointInPolygon, pointSegmentDistance, toWorld } from "./terrain/geometry";
import { createRandom, range, type RandomFn } from "./terrain/rng";
import type { Point, Polygon, VillageFrame } from "./terrain/types";

// 建物の置き方（SPEC_v3.4 §4.3、§7.3 の簡易版。細部の建物平面は M3）。表示専用。
// 区画の内側に、棟（屋根のある建物）と、庭・塀・広場・畑などの外構を矩形で置く。
// 向き・棟の数・ずれは hash(saveId, 建物ID) で決まり、同じ建物は常に同じ姿（§7.3）。
// 住宅などは近い方の本通りに面し、畑は等高線に沿う。区画からはみ出す場合は縮め、それでも無理なら棟を減らす。

export type PartRole = "structure" | "yard" | "wall" | "plaza" | "field";

export interface BuildingPart {
  readonly role: PartRole;
  /** 地図座標の四角形（円は多角形で近似） */
  readonly polygon: Polygon;
}

export interface BuildingPlan {
  readonly id: number;
  readonly kind: BuildingId;
  readonly gridIndex: number;
  /** 記号を置く位置（地図座標）と向き（局所座標の角度、rad） */
  readonly anchor: Point;
  readonly angle: number;
  readonly parts: readonly BuildingPart[];
}

/** 局所の枠 (u: 向きに沿う, v: 横) に置く矩形。w × d、中心 (u, v) */
interface RectSpec {
  readonly role: PartRole;
  readonly u: number;
  readonly v: number;
  readonly w: number;
  readonly d: number;
  readonly round?: boolean;
}

const rect = (role: PartRole, u: number, v: number, w: number, d: number, round = false): RectSpec => ({ role, u, v, w, d, round });

/** 17種の配置の型（§7.3）。棟の数など一部は乱数で決める */
export const planSpecs = (kind: BuildingId, random: RandomFn): RectSpec[] => {
  switch (kind) {
    case "residential": {
      const n = 3 + Math.floor(random() * 4); // 3〜6棟
      const houses = Array.from({ length: n }, (_, k) => rect("structure", (k % 3) * 11 - 11, Math.floor(k / 3) * 13 - 6, 8, 10));
      return [rect("yard", 0, 0, 36, 30), ...houses];
    }
    case "tenement":
      return [rect("structure", 0, -6, 30, 6), rect("structure", 0, 6, 30, 6), rect("yard", 0, 0, 30, 6)];
    case "manor":
      return [rect("wall", 0, 0, 36, 32), rect("structure", -4, 2, 18, 14), rect("structure", 11, -8, 8, 6), rect("yard", 6, 10, 12, 6)];
    case "road":
      return [rect("yard", 0, 0, 40, 9)];
    case "well":
      return [rect("yard", 0, 0, 10, 10), rect("structure", 0, 0, 5, 5, true)];
    case "granary":
      return [rect("yard", 0, 6, 26, 10), rect("structure", 0, -4, 22, 12)];
    case "market":
      return [
        rect("plaza", 0, 0, 30, 30),
        rect("structure", -10, -11, 6, 4),
        rect("structure", 0, -11, 6, 4),
        rect("structure", 10, -11, 6, 4),
        rect("structure", -10, 11, 6, 4),
        rect("structure", 10, 11, 6, 4),
      ];
    case "farm":
      return [rect("field", 0, 0, 40, 34), rect("structure", 15, 13, 6, 5)];
    case "workshop":
      return [rect("structure", -5, 0, 14, 10), rect("yard", 9, 0, 9, 10)];
    case "office":
      return [rect("wall", 0, 0, 30, 34), rect("structure", 0, -6, 18, 14), rect("yard", 0, 8, 18, 10)];
    case "taxoffice":
      return [rect("structure", 0, 0, 10, 8), rect("yard", 0, 7, 10, 4)];
    case "courthouse":
      return [rect("wall", 0, 0, 30, 32), rect("structure", 0, -7, 20, 12), rect("yard", 0, 7, 12, 10)];
    case "clinic":
      return [rect("structure", -4, 0, 12, 8), rect("field", 8, 0, 8, 8)];
    case "school":
      return [rect("structure", 0, -6, 28, 8), rect("yard", 0, 6, 22, 12)];
    case "temple":
      return [rect("wall", 0, 0, 30, 30), rect("structure", 0, -3, 14, 14), rect("structure", 0, 12, 6, 4)];
    case "watchtower":
      return [rect("wall", 0, 0, 14, 14), rect("structure", 0, 0, 5, 5)];
    case "jail":
      return [rect("wall", 0, 0, 22, 22), rect("structure", 0, 0, 12, 10)];
  }
};

const corners = (s: RectSpec, scale: number, cu: number, cv: number, angle: number): Point[] => {
  const c = Math.cos(angle);
  const sn = Math.sin(angle);
  const u = cu + s.u * scale;
  const v = cv + s.v * scale;
  const hw = (s.w * scale) / 2;
  const hd = (s.d * scale) / 2;
  const local: Point[] = s.round
    ? Array.from({ length: 12 }, (_, k) => [Math.cos((k / 12) * Math.PI * 2) * hw, Math.sin((k / 12) * Math.PI * 2) * hd] as Point)
    : [
        [-hw, -hd],
        [hw, -hd],
        [hw, hd],
        [-hw, hd],
      ];
  return local.map(([du, dv]) => [u + du * c - dv * sn, v + du * sn + dv * c] as Point);
};

/** 局所座標の多角形の内側に、境界から inset 以上離れて収まるか */
const fitsInside = (pts: readonly Point[], poly: Polygon, inset: number): boolean =>
  pts.every((p) => {
    if (!pointInPolygon(p, poly)) return false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) if (pointSegmentDistance(p, poly[j]!, poly[i]!) < inset) return false;
    return true;
  });

/** 2つの凸多角形が重なるか（分離軸） */
export const convexOverlap = (a: readonly Point[], b: readonly Point[], gap = 0): boolean => {
  for (const poly of [a, b]) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const nx = poly[i]![1] - poly[j]![1];
      const ny = poly[j]![0] - poly[i]![0];
      const len = Math.hypot(nx, ny) || 1;
      const proj = (q: readonly Point[]) => q.map((p) => (p[0] * nx + p[1] * ny) / len);
      const pa = proj(a);
      const pb = proj(b);
      if (Math.max(...pa) + gap <= Math.min(...pb) || Math.max(...pb) + gap <= Math.min(...pa)) return false;
    }
  }
  return true;
};

const MIN_SCALE = 0.7;

/** 収まらないときに削る要素：先に外構（後ろから）、次に余分な棟（後ろから）。棟は最後の1つを残す */
const droppable = (specs: readonly RectSpec[]): number => {
  for (let i = specs.length - 1; i >= 0; i--) if (specs[i]!.role !== "structure") return i;
  return specs.length > 1 ? specs.length - 1 : -1;
};

export const planBuilding = (
  saveId: string,
  view: { readonly id: number; readonly kind: BuildingId; readonly gridIndex: number },
  shape: ParcelShape,
  faceAngle: number,
  F: VillageFrame,
): BuildingPlan => {
  const random = createRandom(hashString(`${saveId}:building:${view.id}`));
  const jitter = (range(random, -1, 1) * BUILDING_ROTATION_JITTER_DEG * Math.PI) / 180;
  const angle = (view.kind === "farm" ? shape.contourAngle : faceAngle) + jitter;
  let specs = planSpecs(view.kind, random);
  const cu = shape.siteLocal[0] + range(random, -3, 3);
  const cv = shape.siteLocal[1] + range(random, -3, 3);
  const place = (list: readonly RectSpec[], scale: number) => list.map((s) => ({ s, pts: corners(s, scale, cu, cv, angle) }));
  const ok = (placed: readonly { s: RectSpec; pts: Point[] }[]) =>
    placed.every((p) => fitsInside(p.pts, shape.local, BUILDING_INSET_M)) &&
    placed.every((p, i) =>
      placed.every((q, j) => j <= i || p.s.role !== "structure" || q.s.role !== "structure" || !convexOverlap(p.pts, q.pts, BUILDING_GAP_M)),
    );
  let scale = 1;
  let placed = place(specs, scale);
  while (!ok(placed)) {
    scale *= 0.88;
    if (scale < MIN_SCALE) {
      const drop = droppable(specs);
      if (drop < 0) break;
      specs = specs.filter((_, i) => i !== drop);
      scale = 1;
    }
    placed = place(specs, scale);
  }
  const parts: BuildingPart[] = placed.map((p) => ({ role: p.s.role, polygon: p.pts.map((q) => toWorld(F, q[0], q[1])) }));
  return { id: view.id, kind: view.kind, gridIndex: view.gridIndex, anchor: toWorld(F, cu, cv), angle, parts };
};
