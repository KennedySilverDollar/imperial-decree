import { messages } from "../../../i18n/messages";
import { categoryTint } from "../../theme";
import type { BuildingPlan } from "../BuildingLayout";
import type { MapComposition } from "../composeMap";
import { GLYPH_BOX, GLYPH_STROKE, SVG_GLYPHS } from "../glyphs/buildingGlyphs";
import { FURROW_SPACING_M, ROAD_WIDTH_M } from "../mapConstants";
import type { MapViewModel } from "../MapViewModel";
import { decode } from "../terrain/grid";
import { pointInPolygon, toWorld } from "../terrain/geometry";
import { MAP_COLORS, type Rgb } from "../terrain/palette";
import type { Point, Polyline, TerrainDataV2 } from "../terrain/types";
import type { BakeSpec } from "./Bake";
import { planDetails, type Detail } from "./BuildingPlans";
import type { HeightRegion } from "./Contours";
import { handStroke, wobble } from "./HandDrawn";
import { INK_FRESH, INK_OLD, inkPhases, isFresh, paperTint } from "./Ink";
import { layoutLabels, ridgeAxis, type PlacedLabel } from "./Labels";
import { lodOf, type Lod, type MapView } from "./lod";

// 実行時に描くレイヤ（SPEC_v3.4 §6.1）。静的なレイヤ（Bake.ts のベイク画像）を表示に合わせて置き、その上に
// 開墾・区画・道路・普請中・建物・メモ・注記・図枠（方位・縮尺・表題）を描き、最後に紙の経年と窓の光を乗算で重ねる。
// 描くのは MapViewModel と地形から求めた図形（composeMap）だけ。空洞・進捗・資材・派生指標は受け取らない（不変条件21・26）。
// 段階（L0〜L3）で出すものを切り替える。軽量モード（§9：45fps を下回り続けたとき）は細部・一部の注記・重ねの演出を省く。

export interface Baked {
  readonly spec: BakeSpec;
  readonly image: CanvasImageSource;
}

export interface DrawOptions {
  readonly view: MapView;
  readonly lite: boolean;
  /** 描き込みの途中の建物（建物ID → 進み 0..1）。ないものは描き終わり */
  readonly inking: ReadonlyMap<number, number>;
  /** 指している区画・選んだ区画（gridIndex） */
  readonly hover: number | null;
  readonly selected: number | null;
}

type Ctx = CanvasRenderingContext2D;

const rgb = (c: Rgb, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
/** CSS 画素で 396 の地図を基準にした線の太さの単位 */
const BASE_CSS_PX = 396;
/** 表示の倍率（テクスチャの画素 / CSS 画素） */
const unitOf = (sizePx: number) => sizePx / BASE_CSS_PX;

interface Screen {
  readonly x0: number;
  readonly y0: number;
  /** テクスチャの画素 / m */
  readonly scale: number;
  readonly size: number;
  readonly unit: number;
  readonly lod: Lod;
}

const screenOf = (view: MapView, sizePx: number): Screen => ({
  x0: view.center[0] - view.widthM / 2,
  y0: view.center[1] - view.widthM / 2,
  scale: sizePx / view.widthM,
  size: sizePx,
  unit: unitOf(sizePx),
  lod: lodOf(view.widthM),
});

const px = (s: Screen, p: Point): Point => [(p[0] - s.x0) * s.scale, (p[1] - s.y0) * s.scale];
const pxs = (s: Screen, pts: Polyline): Point[] => pts.map((p) => px(s, p));

const addPath = (ctx: Ctx, pts: Polyline, close = false) => {
  pts.forEach((p, k) => (k === 0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1])));
  if (close) ctx.closePath();
};

/** 多角形の周の先頭から割合 t までの折れ線（描き込みの「外形」の段） */
const partialRing = (pts: readonly Point[], t: number): Point[] => {
  const ring = [...pts, pts[0]!];
  let total = 0;
  for (let k = 1; k < ring.length; k++) total += Math.hypot(ring[k]![0] - ring[k - 1]![0], ring[k]![1] - ring[k - 1]![1]);
  const goal = total * Math.max(0, Math.min(1, t));
  const out: Point[] = [ring[0]!];
  let acc = 0;
  for (let k = 1; k < ring.length; k++) {
    const a = ring[k - 1]!;
    const b = ring[k]!;
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (acc + seg >= goal) {
      const f = seg === 0 ? 0 : (goal - acc) / seg;
      out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
      return out;
    }
    out.push(b);
    acc += seg;
  }
  return out;
};

const visible = (s: Screen, p: Point, marginPx: number) => p[0] > -marginPx && p[1] > -marginPx && p[0] < s.size + marginPx && p[1] < s.size + marginPx;

// ── 静的レイヤ（ベイク画像）────────────────────────────

const mpp = (b: BakeSpec) => b.sizeM / b.px;

/** 表示の四隅がベイクの範囲（縁のぼかしを除く）に収まるか */
const covers = (b: BakeSpec, s: Screen): boolean => {
  const margin = b.sizeM * (b.feather ? 0.09 : 0);
  const corners: Point[] = [
    [s.x0, s.y0],
    [s.x0 + s.size / s.scale, s.y0],
    [s.x0, s.y0 + s.size / s.scale],
    [s.x0 + s.size / s.scale, s.y0 + s.size / s.scale],
  ];
  return corners.every((p) => {
    const dx = p[0] - b.origin[0];
    const dy = p[1] - b.origin[1];
    const u = dx * b.ux[0] + dy * b.ux[1];
    const v = dx * b.uy[0] + dy * b.uy[1];
    return u >= margin && v >= margin && u <= b.sizeM - margin && v <= b.sizeM - margin;
  });
};

/** 段階ごとに使うベイク：L0 は b0、L1 は b0＋b1、L2・L3 は b0＋b1＋b3（軽量モードでは b3 を省く） */
const layersFor = (baked: readonly Baked[], s: Screen, lite: boolean): Baked[] => {
  const want: BakeSpec["id"][] = s.lod === 0 ? ["b0"] : s.lod === 1 || lite ? ["b0", "b1"] : ["b0", "b1", "b3"];
  const chosen = want.flatMap((id) => baked.filter((b) => b.spec.id === id));
  // 上の層が表示をすべて覆うなら、下の層は描かない
  for (let k = chosen.length - 1; k > 0; k--) if (covers(chosen[k]!.spec, s)) return chosen.slice(k);
  return chosen;
};

const drawBaked = (ctx: Ctx, s: Screen, baked: readonly Baked[], lite: boolean) => {
  for (const b of layersFor(baked, s, lite)) {
    const k = s.scale * mpp(b.spec);
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = lite ? "low" : "medium";
    ctx.setTransform(k * b.spec.ux[0], k * b.spec.ux[1], k * b.spec.uy[0], k * b.spec.uy[1], (b.spec.origin[0] - s.x0) * s.scale, (b.spec.origin[1] - s.y0) * s.scale);
    ctx.drawImage(b.image, 0, 0);
    ctx.restore();
  }
};

// ── 開墾・区画・道路 ────────────────────────────────

const FIELD = [205, 187, 130] as const;
const FURROW = [138, 116, 64] as const;

const drawClearing = (ctx: Ctx, s: Screen, comp: MapComposition, seed: number) => {
  const u = s.unit;
  if (comp.clearing.clearing) {
    ctx.beginPath();
    addPath(ctx, wobble(pxs(s, comp.clearing.clearing), seed), true);
    ctx.fillStyle = rgb(MAP_COLORS.grass, 0.42);
    ctx.fill();
  }
  if (s.lod === 0) return;
  for (const f of comp.clearing.fields) {
    const pts = pxs(s, f.polygon);
    ctx.save();
    ctx.translate(0.9 * u, 0.6 * u); // 版ずれ
    ctx.beginPath();
    addPath(ctx, pts, true);
    ctx.fillStyle = rgb(FIELD, 0.85);
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    addPath(ctx, pts, true);
    ctx.clip();
    ctx.strokeStyle = rgb(FURROW, 0.7);
    ctx.lineWidth = 0.55 * u;
    const spacing = Math.max(2.5 * u, FURROW_SPACING_M * s.scale);
    const [fx, fy] = pts[0]!;
    const dx = Math.cos(f.angle);
    const dy = Math.sin(f.angle);
    const reach = Math.max(...pts.map((p) => Math.hypot(p[0] - fx, p[1] - fy)));
    ctx.beginPath();
    for (let o = -reach; o <= reach; o += spacing) {
      ctx.moveTo(fx - dx * reach - dy * o, fy - dy * reach + dx * o);
      ctx.lineTo(fx + dx * reach - dy * o, fy + dy * reach + dx * o);
    }
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = rgb(FURROW, 0.8);
    ctx.lineWidth = 0.6 * u;
    ctx.beginPath();
    addPath(ctx, pts, true);
    ctx.stroke();
  }
};

const drawParcels = (ctx: Ctx, s: Screen, comp: MapComposition, opts: DrawOptions) => {
  const u = s.unit;
  if (s.lod >= 2) {
    ctx.save();
    ctx.setLineDash([3 * u, 3 * u]);
    ctx.strokeStyle = INK_OLD;
    ctx.globalAlpha = 0.4;
    ctx.lineWidth = 0.6 * u;
    ctx.beginPath();
    for (const sh of comp.shapes) addPath(ctx, pxs(s, sh.polygon), true);
    ctx.stroke();
    ctx.restore();
  }
  // 指している区画：細い実線。選んだ区画：朱の二重線（色だけに頼らず、線の形でも分かるように。不変条件24）
  const ring = (gridIndex: number, color: string, width: number, double: boolean) => {
    const sh = comp.shapes[gridIndex];
    if (!sh) return;
    const pts = pxs(s, sh.polygon);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width * u;
    ctx.beginPath();
    addPath(ctx, pts, true);
    ctx.stroke();
    if (double) {
      const c = px(s, sh.site);
      ctx.lineWidth = 0.7 * u;
      ctx.beginPath();
      addPath(
        ctx,
        pts.map((p) => [c[0] + (p[0] - c[0]) * 0.86, c[1] + (p[1] - c[1]) * 0.86] as Point),
        true,
      );
      ctx.stroke();
    }
    ctx.restore();
  };
  if (opts.hover !== null && opts.hover !== opts.selected) ring(opts.hover, "rgba(43,29,14,0.75)", 1.2, false);
  if (opts.selected !== null) ring(opts.selected, rgb(MAP_COLORS.vermilion, 0.95), 1.4, true);
};

const drawRoads = (ctx: Ctx, s: Screen, comp: MapComposition, seed: number, lite: boolean) => {
  const u = s.unit;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (comp.roads.trail.length > 1 && s.lod >= 1) {
    ctx.setLineDash([2 * u, 3 * u]);
    ctx.strokeStyle = rgb(MAP_COLORS.roadLine, 0.8);
    ctx.lineWidth = 0.9 * u;
    ctx.beginPath();
    addPath(ctx, pxs(s, comp.roads.trail));
    ctx.stroke();
    ctx.setLineDash([]);
  }
  const roadPx = Math.max((s.lod === 0 ? 1.2 : 2.4) * u, ROAD_WIDTH_M * s.scale);
  for (const [color, width] of [
    [rgb(MAP_COLORS.roadLine), roadPx + 1.5 * u],
    [rgb(MAP_COLORS.road), roadPx],
  ] as const) {
    ctx.strokeStyle = color;
    for (const piece of comp.roads.pieces) {
      const pts = pxs(s, piece.points);
      if (lite) {
        ctx.lineWidth = width;
        ctx.beginPath();
        addPath(ctx, pts);
        ctx.stroke();
      } else {
        handStroke(ctx, pts, width, seed + piece.gridIndex, 0.5 * u);
      }
    }
  }
  if (s.lod >= 2) {
    ctx.setLineDash([1.5 * u, 2 * u]);
    ctx.strokeStyle = rgb(MAP_COLORS.roadLine, 0.6);
    ctx.lineWidth = 0.8 * u;
    ctx.beginPath();
    for (const p of comp.roads.sidePaths) addPath(ctx, pxs(s, p.points));
    ctx.stroke();
  }
  ctx.restore();
};

// ── 建物の記号・平面 ────────────────────────────────

const glyphPaths = new Map<string, Path2D>();
const glyphPath = (d: string): Path2D => {
  let p = glyphPaths.get(d);
  if (!p) {
    p = new Path2D(d);
    glyphPaths.set(d, p);
  }
  return p;
};

/** 絵記号（SVG のパス）。紙色の縁取りで地の上でも読めるようにする */
const drawGlyph = (ctx: Ctx, d: string, at: Point, sizePx: number, alpha: number, ink: string) => {
  const k = sizePx / GLYPH_BOX;
  ctx.save();
  ctx.translate(at[0] - sizePx / 2, at[1] - sizePx / 2);
  ctx.scale(k, k);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = rgb(MAP_COLORS.paper, 0.9);
  ctx.lineWidth = GLYPH_STROKE + 2.2;
  ctx.stroke(glyphPath(d));
  ctx.strokeStyle = ink;
  ctx.lineWidth = GLYPH_STROKE;
  ctx.stroke(glyphPath(d));
  ctx.restore();
};

const drawConstruction = (ctx: Ctx, s: Screen, comp: MapComposition, vm: MapViewModel) => {
  // 普請中：縄張り（破線）と足場（格子）と、薄い記号。進捗によらない一様な印（不変条件21）
  const u = s.unit;
  const kindOf = new Map(vm.construction.map((w) => [w.id, w.kind]));
  const glyphPx = glyphSize(s);
  ctx.save();
  for (const m of comp.construction) {
    const rope = pxs(s, m.rope);
    if (!visible(s, rope[0]!, 200 * u)) continue;
    if (s.lod >= 1) {
      ctx.setLineDash([4 * u, 2 * u]);
      ctx.strokeStyle = INK_FRESH;
      ctx.globalAlpha = 0.8;
      ctx.lineWidth = 1 * u;
      ctx.beginPath();
      addPath(ctx, rope, true);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = rgb(MAP_COLORS.roadLine, 0.7);
      ctx.globalAlpha = 1;
      ctx.lineWidth = 0.7 * u;
      ctx.beginPath();
      for (const line of m.scaffold) addPath(ctx, pxs(s, line));
      ctx.stroke();
    }
    const kind = kindOf.get(m.constructionId);
    if (kind && glyphPx > 0) drawGlyph(ctx, SVG_GLYPHS[kind].path, px(s, m.anchor), glyphPx, 0.5, INK_FRESH);
  }
  ctx.restore();
};

/** 記号の大きさ（テクスチャの画素）。区画の大きさに比例し、上下限で読める大きさに保つ。L0・L3 は記号を出さない */
const glyphSize = (s: Screen): number => {
  const parcelCss = (60 * s.scale) / s.unit;
  if (s.lod === 0 || s.lod === 3) return 0;
  const css = s.lod === 1 ? Math.min(16, Math.max(9, parcelCss * 0.55)) : Math.min(15, Math.max(10, parcelCss * 0.26));
  return css * s.unit;
};

const ROLE_ORDER = { field: 0, plaza: 1, yard: 2, wall: 3, structure: 4 } as const;

const drawDetail = (ctx: Ctx, s: Screen, d: Detail) => {
  const pts = pxs(s, d.points);
  switch (d.role) {
    case "dot":
    case "circle": {
      const r = Math.max(0.6 * s.unit, (d.radius ?? 0.5) * s.scale);
      ctx.moveTo(pts[0]![0] + r, pts[0]![1]);
      ctx.arc(pts[0]![0], pts[0]![1], r, 0, Math.PI * 2);
      break;
    }
    default:
      addPath(ctx, pts);
  }
};

const drawBuilding = (ctx: Ctx, s: Screen, plan: BuildingPlan, vm: MapViewModel, progress: number, lite: boolean) => {
  const u = s.unit;
  const b = vm.buildings.find((x) => x.id === plan.id);
  const tint = categoryTint[b?.category ?? "housing"];
  const ink = b && isFresh(b.builtTurn, vm.turn) ? INK_FRESH : INK_OLD;
  const phase = inkPhases(progress);
  const parts = [...plan.parts].sort((a, c) => ROLE_ORDER[a.role] - ROLE_ORDER[c.role]);
  const full = s.lod >= 2;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const part of parts) {
    if (!full && part.role !== "structure" && part.role !== "field") continue;
    const pts = pxs(s, part.polygon);
    // 着彩（最後の段）。版ずれで少しずらす
    ctx.globalAlpha = phase.fill;
    if (phase.fill > 0) {
      ctx.save();
      ctx.translate(0.8 * u, 0.5 * u);
      ctx.beginPath();
      addPath(ctx, pts, true);
      switch (part.role) {
        case "field":
          ctx.fillStyle = rgb(FIELD, 0.9);
          ctx.fill();
          break;
        case "yard":
          ctx.fillStyle = rgb(MAP_COLORS.bare, 0.5);
          ctx.fill();
          break;
        case "structure":
          ctx.fillStyle = tint;
          ctx.fill();
          break;
        default:
          break;
      }
      ctx.restore();
    }
    // 外形（最初の段）
    ctx.globalAlpha = 1;
    const outline = phase.outline >= 1 ? [...pts, pts[0]!] : partialRing(pts, phase.outline);
    if (outline.length < 2) continue;
    ctx.strokeStyle = ink;
    switch (part.role) {
      case "plaza":
        ctx.setLineDash([2 * u, 2 * u]);
        ctx.lineWidth = 0.8 * u;
        ctx.beginPath();
        addPath(ctx, outline);
        ctx.stroke();
        ctx.setLineDash([]);
        break;
      case "wall":
        ctx.lineWidth = 1.1 * u;
        ctx.beginPath();
        addPath(ctx, lite ? outline : wobble(outline, plan.id * 7 + 1, 0.4 * u));
        ctx.stroke();
        break;
      case "structure":
        ctx.lineWidth = (s.lod <= 1 ? 0.6 : 0.85) * u;
        ctx.beginPath();
        addPath(ctx, lite ? outline : wobble(outline, plan.id * 7 + 2, 0.35 * u));
        ctx.stroke();
        break;
      case "field":
      case "yard":
        if (full) {
          ctx.lineWidth = 0.5 * u;
          ctx.globalAlpha = 0.6;
          ctx.beginPath();
          addPath(ctx, outline);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
        break;
    }
  }
  // 屋根・細部（中の段）：L2 は棟だけ、L3 はすべて
  if (full && phase.roof > 0 && !(lite && s.lod < 3)) {
    const details = planDetails(plan).filter((d) => s.lod >= 3 || d.role === "ridge");
    ctx.globalAlpha = phase.roof;
    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
    ctx.lineWidth = 0.55 * u;
    ctx.beginPath();
    for (const d of details) if (d.role !== "dash" && d.role !== "dot") drawDetail(ctx, s, d);
    ctx.stroke();
    ctx.beginPath();
    for (const d of details) if (d.role === "dot") drawDetail(ctx, s, d);
    ctx.fill();
    ctx.lineWidth = 1.8 * u;
    ctx.beginPath();
    for (const d of details) if (d.role === "dash") drawDetail(ctx, s, d);
    ctx.strokeStyle = rgb(MAP_COLORS.paper, 1);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.restore();
};

const drawBuildings = (ctx: Ctx, s: Screen, comp: MapComposition, vm: MapViewModel, opts: DrawOptions) => {
  const glyphPx = glyphSize(s);
  for (const plan of comp.buildings) {
    if (!visible(s, px(s, plan.anchor), 120 * s.unit)) continue;
    const progress = opts.inking.get(plan.id) ?? 1;
    drawBuilding(ctx, s, plan, vm, progress, opts.lite);
    const b = vm.buildings.find((x) => x.id === plan.id);
    const ink = b && isFresh(b.builtTurn, vm.turn) ? INK_FRESH : INK_OLD;
    if (glyphPx > 0 && progress >= 1) drawGlyph(ctx, SVG_GLYPHS[plan.kind].path, px(s, plan.anchor), glyphPx, s.lod === 2 ? 0.85 : 1, ink);
  }
  // L3：建物の名前（平面だけでは種類が分かりにくいもののために）
  if (s.lod === 3) {
    const font = 10 * s.unit;
    ctx.save();
    ctx.font = `${font}px "Noto Serif JP", serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const plan of comp.buildings) {
      const structure = plan.parts.find((p) => p.role === "structure");
      if (!structure) continue;
      const pts = pxs(s, structure.polygon);
      const bottom = Math.max(...pts.map((p) => p[1]));
      const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
      if (!visible(s, [cx, bottom], 40 * s.unit)) continue;
      const name = messages.targets[plan.kind];
      ctx.lineWidth = 3 * s.unit;
      ctx.strokeStyle = rgb(MAP_COLORS.paper, 0.85);
      ctx.strokeText(name, cx, bottom + 2 * s.unit);
      ctx.fillStyle = INK_OLD;
      ctx.fillText(name, cx, bottom + 2 * s.unit);
    }
    ctx.restore();
  }
};

// ── メモ・村域の枠 ──────────────────────────────────

const drawNotes = (ctx: Ctx, s: Screen, comp: MapComposition, vm: MapViewModel) => {
  if (s.lod === 0 || vm.notes.length === 0) return;
  const u = s.unit;
  const counts = new Map<number, number>();
  for (const n of vm.notes) counts.set(n.gridIndex, (counts.get(n.gridIndex) ?? 0) + 1);
  ctx.save();
  for (const [gridIndex, count] of counts) {
    const sh = comp.shapes[gridIndex];
    if (!sh) continue;
    // 区画の右上の角寄りに、留め針（丸い頭と針）
    const corner = pxs(s, sh.polygon).reduce((best, p) => (p[0] - p[1] > best[0] - best[1] ? p : best));
    const c = px(s, sh.site);
    const at: Point = [c[0] + (corner[0] - c[0]) * 0.6, c[1] + (corner[1] - c[1]) * 0.6];
    ctx.strokeStyle = INK_FRESH;
    ctx.lineWidth = 1 * u;
    ctx.beginPath();
    ctx.moveTo(at[0], at[1]);
    ctx.lineTo(at[0] - 3 * u, at[1] + 6 * u);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(at[0], at[1], 3.2 * u, 0, Math.PI * 2);
    ctx.fillStyle = rgb(MAP_COLORS.vermilion, 0.95);
    ctx.fill();
    ctx.stroke();
    if (count > 1) {
      ctx.font = `${8 * u}px serif`;
      ctx.fillStyle = INK_FRESH;
      ctx.textBaseline = "middle";
      ctx.fillText(String(count), at[0] + 4.5 * u, at[1]);
    }
  }
  ctx.restore();
};

const drawVillageFrame = (ctx: Ctx, s: Screen, comp: MapComposition) => {
  const h = comp.frame.halfM;
  const corners = (
    [
      [-h, -h],
      [h, -h],
      [h, h],
      [-h, h],
    ] as const
  ).map(([a, b]) => px(s, toWorld(comp.frame, a, b)));
  ctx.save();
  ctx.strokeStyle = INK_OLD;
  ctx.globalAlpha = 0.75;
  ctx.lineWidth = 1 * s.unit;
  ctx.setLineDash([6 * s.unit, 2 * s.unit, 1.5 * s.unit, 2 * s.unit]);
  ctx.beginPath();
  addPath(ctx, corners, true);
  ctx.stroke();
  ctx.restore();
};

// ── 注記 ────────────────────────────────────────

const ridgeCache = new WeakMap<TerrainDataV2, Map<string, number>>();
const regionCache = new WeakMap<TerrainDataV2, HeightRegion>();

const ridgeAngleFor = (terrain: TerrainDataV2) => {
  let cache = ridgeCache.get(terrain);
  if (!cache) {
    cache = new Map();
    ridgeCache.set(terrain, cache);
  }
  let region = regionCache.get(terrain);
  if (!region) {
    const n = terrain.surround.size;
    const cell = terrain.worldM / n;
    region = { h: decode(terrain.surround), n, cell, origin: [cell / 2, cell / 2] };
    regionCache.set(terrain, region);
  }
  const r = region;
  const c = cache;
  return (anchor: Point): number => {
    const key = `${anchor[0]},${anchor[1]}`;
    let a = c.get(key);
    if (a === undefined) {
      a = ridgeAxis(r, anchor);
      c.set(key, a);
    }
    return a;
  };
};

const labelCache = new WeakMap<TerrainDataV2, Map<string, PlacedLabel[]>>();

/** 注記の配置（表示の幅と軽量モードだけで決まる。パンでは作り直さない） */
export const labelsFor = (terrain: TerrainDataV2, widthM: number, cssPx: number, lite: boolean): PlacedLabel[] => {
  let byKey = labelCache.get(terrain);
  if (!byKey) {
    byKey = new Map();
    labelCache.set(terrain, byKey);
  }
  // 表示の幅は 2% 刻みにまとめて覚える（ズーム中に毎フレーム作り直さない）
  const bucket = Math.round(Math.log(widthM) / Math.log(1.02));
  const key = `${bucket}:${cssPx}:${lite ? 1 : 0}`;
  let labels = byKey.get(key);
  if (!labels) {
    const w = Math.pow(1.02, bucket);
    const lod = lodOf(w);
    labels = layoutLabels(
      { toponyms: terrain.toponyms, rivers: terrain.rivers, ridgeAngle: ridgeAngleFor(terrain), destinationText: messages.toponyms.direction },
      { lod, pxPerM: cssPx / w, lite, focus: terrain.village.frame.center },
    );
    if (byKey.size > 200) byKey.clear();
    byKey.set(key, labels);
  }
  return labels;
};

const LABEL_COLOR: Readonly<Record<PlacedLabel["kind"], string>> = {
  river: rgb(MAP_COLORS.riverLine),
  lake: rgb(MAP_COLORS.riverLine),
  wetland: rgb(MAP_COLORS.riverLine),
  mountain: INK_OLD,
  hill: INK_OLD,
  pass: INK_OLD,
  destination: INK_OLD,
  district: INK_FRESH,
};

/** 図枠（表題・方位・縮尺）の場所（CSS 画素）。注記はここに重ねない */
const FURNITURE_CSS: readonly { x0: number; y0: number; x1: number; y1: number }[] = [
  { x0: 0, y0: 0, x1: 200, y1: 48 },
  { x0: BASE_CSS_PX - 36, y0: 0, x1: BASE_CSS_PX, y1: 42 },
  { x0: 0, y0: BASE_CSS_PX - 36, x1: 240, y1: BASE_CSS_PX },
];

const drawLabels = (ctx: Ctx, s: Screen, labels: readonly PlacedLabel[]) => {
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const l of labels) {
    const font = l.fontPx * s.unit;
    // 一部でも地図の外・図枠に掛かる注記は出さない（字が欠けた注記は読めない）
    const pts = l.chars.map((c) => px(s, c.at));
    const half = font * 0.6;
    const clipped = pts.some(
      (p) =>
        p[0] < half ||
        p[1] < half ||
        p[0] > s.size - half ||
        p[1] > s.size - half ||
        FURNITURE_CSS.some((r) => p[0] + half > r.x0 * s.unit && p[0] - half < r.x1 * s.unit && p[1] + half > r.y0 * s.unit && p[1] - half < r.y1 * s.unit),
    );
    if (clipped) continue;
    ctx.font = `${l.kind === "mountain" ? "600 " : ""}${font}px "Noto Serif JP", serif`;
    for (const [k, c] of l.chars.entries()) {
      const p = pts[k]!;
      ctx.save();
      ctx.translate(p[0], p[1]);
      if (c.angle !== 0) ctx.rotate(c.angle);
      ctx.lineWidth = 3 * s.unit;
      ctx.strokeStyle = rgb(MAP_COLORS.paper, 0.8);
      ctx.strokeText(c.ch, 0, 0);
      ctx.fillStyle = LABEL_COLOR[l.kind];
      ctx.fillText(c.ch, 0, 0);
      ctx.restore();
    }
  }
  ctx.restore();
};

// ── 図枠：表題・方位・縮尺 ──────────────────────────

/** 縮尺の目盛りの長さ（m）：表示の幅の 1/5 前後の切りのよい値 */
export const scaleBarM = (widthM: number): number => {
  const target = widthM / 5;
  const steps = [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000];
  return steps.reduce((best, v) => (Math.abs(Math.log(v / target)) < Math.abs(Math.log(best / target)) ? v : best), steps[0]!);
};

const drawFurniture = (ctx: Ctx, s: Screen, terrain: TerrainDataV2, vm: MapViewModel, widthM: number) => {
  const u = s.unit;
  const region = terrain.toponyms.find((t) => t.kind === "region")?.name ?? "";
  ctx.save();
  ctx.fillStyle = INK_OLD;
  ctx.strokeStyle = INK_OLD;
  // 表題（郡名と測量年）：左上の枠
  const title = messages.ui.map.cartouche(region);
  const sub = messages.ui.map.surveyedYear(vm.surveyedUntil);
  ctx.font = `600 ${12 * u}px "Noto Serif JP", serif`;
  const tw = Math.max(ctx.measureText(title).width, (ctx.measureText(sub).width * 9) / 12) + 14 * u;
  ctx.fillStyle = rgb(MAP_COLORS.paper, 0.88);
  ctx.fillRect(8 * u, 8 * u, tw, 34 * u);
  ctx.lineWidth = 0.8 * u;
  ctx.strokeRect(8 * u, 8 * u, tw, 34 * u);
  ctx.strokeRect(10 * u, 10 * u, tw - 4 * u, 30 * u);
  ctx.fillStyle = INK_OLD;
  ctx.textBaseline = "top";
  ctx.fillText(title, 15 * u, 13 * u);
  ctx.font = `${9 * u}px "Noto Serif JP", serif`;
  ctx.fillText(sub, 15 * u, 28 * u);
  // 方位：右上の矢印と「北」
  const nx = s.size - 20 * u;
  const ny = 22 * u;
  ctx.beginPath();
  ctx.moveTo(nx, ny - 11 * u);
  ctx.lineTo(nx - 4 * u, ny + 5 * u);
  ctx.lineTo(nx, ny + 2 * u);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(nx, ny - 11 * u);
  ctx.lineTo(nx + 4 * u, ny + 5 * u);
  ctx.lineTo(nx, ny + 2 * u);
  ctx.closePath();
  ctx.lineWidth = 0.8 * u;
  ctx.stroke();
  ctx.font = `${9 * u}px "Noto Serif JP", serif`;
  ctx.textAlign = "center";
  ctx.fillText(messages.ui.map.north, nx, ny + 7 * u);
  // 縮尺：左下の目盛り
  const m = scaleBarM(widthM);
  const len = m * s.scale;
  const x0 = 12 * u;
  const y0 = s.size - 14 * u;
  ctx.fillStyle = rgb(MAP_COLORS.paper, 0.8);
  ctx.fillRect(x0 - 4 * u, y0 - 14 * u, len + 8 * u, 20 * u);
  ctx.strokeStyle = INK_OLD;
  ctx.fillStyle = INK_OLD;
  ctx.lineWidth = 0.8 * u;
  ctx.strokeRect(x0, y0 - 3 * u, len, 3 * u);
  ctx.fillRect(x0, y0 - 3 * u, len / 2, 3 * u);
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.font = `${8.5 * u}px "Noto Serif JP", serif`;
  ctx.fillText(messages.ui.map.scale(m), x0, y0 - 4 * u);
  ctx.restore();
};

// ── 紙の経年・窓の光 ────────────────────────────────

/** 窓の光（天候は U4。今は中立の色を乗算で薄く） */
const WINDOW_RGB: Rgb = [226, 230, 228];

const drawPaperAge = (ctx: Ctx, s: Screen, turn: number, lite: boolean) => {
  const tint = paperTint(turn);
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = tint.color;
  ctx.globalAlpha = tint.alpha;
  ctx.fillRect(0, 0, s.size, s.size);
  ctx.globalAlpha = 1;
  if (!lite) {
    // 縁の焼け
    const g = ctx.createRadialGradient(s.size / 2, s.size / 2, s.size * 0.42, s.size / 2, s.size / 2, s.size * 0.75);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(1, `rgba(150,110,60,${tint.edgeAlpha})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s.size, s.size);
    // 折り目（紙の四つ折り。紙そのものの癖なので表示に固定）
    ctx.globalAlpha = 0.07;
    ctx.strokeStyle = "rgb(90,70,40)";
    ctx.lineWidth = 1.5 * s.unit;
    ctx.beginPath();
    ctx.moveTo(s.size / 2, 0);
    ctx.lineTo(s.size / 2, s.size);
    ctx.moveTo(0, s.size / 2);
    ctx.lineTo(s.size, s.size / 2);
    ctx.stroke();
    // 窓の光
    ctx.globalAlpha = 0.5;
    const w = ctx.createLinearGradient(s.size, 0, 0, s.size);
    w.addColorStop(0, rgb(WINDOW_RGB));
    w.addColorStop(1, "rgb(255,255,255)");
    ctx.fillStyle = w;
    ctx.fillRect(0, 0, s.size, s.size);
  }
  ctx.restore();
};

// ── 全体 ──────────────────────────────────────

export const drawMapLayers = (
  ctx: Ctx,
  sizePx: number,
  comp: MapComposition,
  terrain: TerrainDataV2,
  baked: readonly Baked[],
  vm: MapViewModel,
  opts: DrawOptions,
): void => {
  const s = screenOf(opts.view, sizePx);
  const seed = terrain.seed;
  ctx.save();
  ctx.fillStyle = rgb(MAP_COLORS.paper);
  ctx.fillRect(0, 0, sizePx, sizePx);
  drawBaked(ctx, s, baked, opts.lite);
  drawClearing(ctx, s, comp, seed);
  drawParcels(ctx, s, comp, opts);
  drawRoads(ctx, s, comp, seed, opts.lite);
  drawConstruction(ctx, s, comp, vm);
  drawBuildings(ctx, s, comp, vm, opts);
  if (s.lod >= 1) drawVillageFrame(ctx, s, comp);
  drawNotes(ctx, s, comp, vm);
  drawLabels(ctx, s, labelsFor(terrain, opts.view.widthM, sizePx / s.unit, opts.lite));
  drawPaperAge(ctx, s, vm.turn, opts.lite);
  drawFurniture(ctx, s, terrain, vm, opts.view.widthM);
  ctx.restore();
};

/** 地図座標の点がどの区画か（なければ null） */
export const parcelAt = (comp: MapComposition, p: Point): number | null => comp.shapes.find((sh) => pointInPolygon(p, sh.polygon))?.gridIndex ?? null;
