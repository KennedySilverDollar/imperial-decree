import type { BuildingId } from "../../../domain/Buildings";
import type { BuildingPart, BuildingPlan } from "../BuildingLayout";
import type { Point, Polyline } from "../terrain/types";

// 建物平面（SPEC_v3.4 §7.3、L3）。M2 の配置（棟・外構の矩形。hash(saveId, 建物ID) で決まる）に、種類ごとの細部の線を足す。
// 細部はすべて、その建物の矩形の内側に引く（区画からはみ出さず、他の建物とも重ならない）。
// 空洞の有無は受け取らない：完成した建物はすべて同じ「完成した姿」（I-32）。

export type DetailRole = "ridge" | "line" | "dash" | "dot" | "circle";

export interface Detail {
  readonly role: DetailRole;
  readonly points: Polyline;
  /** dot・circle の半径（m） */
  readonly radius?: number;
}

const mid = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const lerp = (a: Point, b: Point, t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const dist = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** 矩形（4点）の長辺に沿う棟の線と、長辺・短辺の組 */
const rectAxes = (p: readonly Point[]) => {
  const [c0, c1, c2, c3] = p as [Point, Point, Point, Point];
  const long01 = dist(c0, c1) >= dist(c1, c2);
  // 長辺に平行な中心線（棟）
  const ridge: [Point, Point] = long01 ? [mid(c0, c3), mid(c1, c2)] : [mid(c0, c1), mid(c3, c2)];
  // 長辺の組（a: 一方の長辺、b: 反対の長辺）
  const sideA: [Point, Point] = long01 ? [c0, c1] : [c1, c2];
  const sideB: [Point, Point] = long01 ? [c3, c2] : [c0, c3];
  return { c0, c1, c2, c3, ridge, sideA, sideB };
};

/** 矩形の内側に、長辺と平行な縞（count 本） */
const stripes = (p: readonly Point[], count: number): Polyline[] => {
  const { sideA, sideB } = rectAxes(p);
  return Array.from({ length: count }, (_, k) => {
    const t = (k + 1) / (count + 1);
    return [lerp(sideA[0], sideB[0], t), lerp(sideA[1], sideB[1], t)];
  });
};

/** 矩形の内側に格子状の点（白洲・資材置き場） */
const dots = (p: readonly Point[], nu: number, nv: number, radius: number): Detail[] => {
  const { sideA, sideB } = rectAxes(p);
  const out: Detail[] = [];
  for (let i = 1; i <= nu; i++) {
    for (let j = 1; j <= nv; j++) {
      const a = lerp(sideA[0], sideA[1], i / (nu + 1));
      const b = lerp(sideB[0], sideB[1], i / (nu + 1));
      out.push({ role: "dot", points: [lerp(a, b, j / (nv + 1))], radius });
    }
  }
  return out;
};

const structureDetails = (kind: BuildingId, part: BuildingPart): Detail[] => {
  const p = part.polygon;
  if (p.length !== 4) {
    // 円（井戸の石組み）
    const c: Point = [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length];
    const r = dist(c, p[0]!);
    return [
      { role: "circle", points: [c], radius: r * 0.55 },
      { role: "line", points: [lerp(c, p[0]!, 0.8), lerp(c, p[Math.floor(p.length / 2)]!, 0.8)] },
    ];
  }
  const { c0, c1, c2, c3, ridge, sideA } = rectAxes(p);
  switch (kind) {
    case "temple": {
      // 寄棟：棟を短くし、四隅へ下り棟
      const r0 = lerp(ridge[0], ridge[1], 0.25);
      const r1 = lerp(ridge[0], ridge[1], 0.75);
      return [
        { role: "ridge", points: [r0, r1] },
        { role: "line", points: [c0, r0] },
        { role: "line", points: [c3, r0] },
        { role: "line", points: [c1, r1] },
        { role: "line", points: [c2, r1] },
      ];
    }
    case "tenement": {
      // 連棟：棟と、住戸の仕切り
      const parts: Detail[] = [{ role: "ridge", points: ridge }];
      for (let k = 1; k < 5; k++) parts.push({ role: "line", points: [lerp(sideA[0], sideA[1], k / 5), lerp(rectAxes(p).sideB[0], rectAxes(p).sideB[1], k / 5)] });
      return parts;
    }
    case "workshop": {
      // 鋸屋根：棟を横切るジグザグ
      const zig: Point[] = [];
      for (let k = 0; k <= 6; k++) zig.push(lerp(k % 2 === 0 ? c0 : c3, k % 2 === 0 ? c1 : c2, k / 6));
      return [{ role: "line", points: zig }];
    }
    case "watchtower":
      return [
        { role: "line", points: [c0, c2] },
        { role: "line", points: [c1, c3] },
      ];
    case "granary":
      return [
        { role: "ridge", points: ridge },
        { role: "line", points: [lerp(sideA[0], sideA[1], 0.42), lerp(lerp(sideA[0], sideA[1], 0.42), mid(c0, c2), 0.3)] },
        { role: "line", points: [lerp(sideA[0], sideA[1], 0.58), lerp(lerp(sideA[0], sideA[1], 0.58), mid(c0, c2), 0.3)] },
      ];
    case "school": {
      // 長い教室棟：棟と、長辺の窓
      const w: Detail[] = [{ role: "ridge", points: ridge }];
      for (let k = 1; k < 7; k++) {
        const a = lerp(sideA[0], sideA[1], k / 7);
        w.push({ role: "line", points: [a, lerp(a, mid(c0, c2), 0.18)] });
      }
      return w;
    }
    case "market":
      // 露店：日よけの縞
      return stripes(p, 2).map((points) => ({ role: "line" as const, points }));
    default:
      return [{ role: "ridge", points: ridge }];
  }
};

const outdoorDetails = (kind: BuildingId, part: BuildingPart): Detail[] => {
  const p = part.polygon;
  switch (part.role) {
    case "field":
      // 畑の畝（農地）と、薬草畑（診療所）
      return stripes(p, kind === "clinic" ? 3 : 9).map((points) => ({ role: "line" as const, points }));
    case "plaza":
      return [];
    case "yard":
      if (kind === "courthouse") return dots(p, 5, 4, 0.35); // 白洲
      if (kind === "workshop") return dots(p, 3, 3, 0.8); // 資材置き場
      if (kind === "office") {
        // 旗竿と旗
        const { sideA, sideB } = rectAxes(p);
        const base = lerp(lerp(sideA[0], sideB[0], 0.5), lerp(sideA[1], sideB[1], 0.5), 0.5);
        const top = lerp(base, sideA[0], 0.35);
        return [
          { role: "line", points: [base, top] },
          { role: "line", points: [top, lerp(top, sideA[1], 0.15), lerp(top, base, 0.3)] },
        ];
      }
      if (kind === "taxoffice") {
        const { sideA } = rectAxes(p);
        return [
          { role: "dot", points: [lerp(sideA[0], sideA[1], 0.25)], radius: 0.6 },
          { role: "dot", points: [lerp(sideA[0], sideA[1], 0.75)], radius: 0.6 },
        ];
      }
      return [];
    case "wall":
      if (kind === "jail") {
        // 堅い塀：内側にもう1本
        const c: Point = [p.reduce((s, q) => s + q[0], 0) / 4, p.reduce((s, q) => s + q[1], 0) / 4];
        const inner = p.map((q) => lerp(q, c, 0.08));
        return [{ role: "line", points: [...inner, inner[0]!] }];
      }
      if (kind === "manor" || kind === "office" || kind === "temple" || kind === "courthouse") {
        // 門：手前の辺の中央に短い印
        const { sideA } = rectAxes(p);
        const g0 = lerp(sideA[0], sideA[1], 0.45);
        const g1 = lerp(sideA[0], sideA[1], 0.55);
        return [{ role: "dash", points: [g0, g1] }];
      }
      return [];
    default:
      return [];
  }
};

/** 建物平面の細部の線（L3） */
export const planDetails = (plan: BuildingPlan): Detail[] =>
  plan.parts.flatMap((part) => (part.role === "structure" ? structureDetails(plan.kind, part) : outdoorDetails(plan.kind, part)));
