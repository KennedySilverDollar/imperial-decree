import type { HeightRegion } from "./Contours";
import type { Lod } from "./lod";
import type { Point, Polyline, River, Toponym, ToponymKind } from "../terrain/types";

// 注記（SPEC_v3.4 §6.5）。川名は川に沿わせ、山名は尾根の向きに字間を空けて並べ、そのほかの地名・小字は水平に置く。
// 優先度（川名 > 山名 > 地名 > 区画名）の高い順に置き、重なるものは間引く。縮尺（段階）ごとに出す種類を切り替える。
// 字は全角なので、1字を一辺 fontPx の正方形として扱う（計測は要らない：決定論・Node でも試験できる）。
// 地名はすべて地形の地名一覧（Toponyms）から取る。新聞の {place} と同じ一覧（不変条件20）。
// 郡名（region）は表題の枠（カルトゥーシュ）に出すので、ここでは置かない。

export type LabelKind = Exclude<ToponymKind, "region">;

/** 小さいほど優先 */
export const LABEL_PRIORITY: Readonly<Record<LabelKind, number>> = {
  river: 0,
  mountain: 1,
  hill: 2,
  lake: 2,
  wetland: 2,
  pass: 2,
  destination: 2,
  district: 3,
};

/** 段階ごとに出す種類 */
export const LABEL_KINDS_BY_LOD: Readonly<Record<Lod, readonly LabelKind[]>> = {
  0: ["river", "mountain", "lake", "destination", "pass"],
  1: ["river", "mountain", "hill", "lake", "wetland", "destination", "pass"],
  2: ["river", "lake", "wetland", "district"],
  3: ["river", "district"],
};

/** 軽量モードで落とす種類（§9：45fps を下回り続けたとき） */
export const LITE_DROPPED: readonly LabelKind[] = ["hill", "wetland", "pass"];

/** 字の大きさ（CSS 画素） */
export const LABEL_FONT_PX: Readonly<Record<LabelKind, number>> = {
  river: 12,
  mountain: 13,
  hill: 10.5,
  lake: 10.5,
  wetland: 10,
  pass: 10,
  destination: 10.5,
  district: 11,
};

/** 山名の字間（字の大きさに対する倍率） */
const MOUNTAIN_SPACING = 1.9;
/** 川名の字間 */
const RIVER_SPACING = 1.5;
/** 重なりの判定の余白（字の大きさに対する割合） */
const LABEL_PAD = 0.2;

export interface LabelChar {
  readonly ch: string;
  /** 字の中心（地図座標） */
  readonly at: Point;
  /** 字の回転（ラジアン。0 = 正立） */
  readonly angle: number;
}

export interface PlacedLabel {
  readonly kind: LabelKind;
  readonly text: string;
  readonly fontPx: number;
  readonly chars: readonly LabelChar[];
}

export interface LabelInput {
  readonly toponyms: readonly Toponym[];
  readonly rivers: readonly River[];
  /** 山名を尾根に沿わせるための向き（ラジアン、地図座標）。なければ水平 */
  readonly ridgeAngle?: (anchor: Point) => number;
  /** 街道の先の注記の書式（「◯◯方面」） */
  readonly destinationText: (name: string) => string;
}

export interface LabelLayoutOptions {
  readonly lod: Lod;
  /** 地図座標 1m あたりの CSS 画素 */
  readonly pxPerM: number;
  readonly lite: boolean;
  /** 川名を置く位置をこの点の近くから探す（L2・L3 では村の中心） */
  readonly focus: Point;
}

interface Box {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

const boxOf = (c: LabelChar, halfM: number): Box => ({ x0: c.at[0] - halfM, y0: c.at[1] - halfM, x1: c.at[0] + halfM, y1: c.at[1] + halfM });
const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** 字を水平に並べる（中心が anchor） */
const horizontal = (text: string, anchor: Point, stepM: number): LabelChar[] => {
  const chars = [...text];
  return chars.map((ch, k) => ({ ch, at: [anchor[0] + (k - (chars.length - 1) / 2) * stepM, anchor[1]] as Point, angle: 0 }));
};

/** 向き angle の直線に沿って字を並べる。字は正立のまま（山名） */
const alongAxis = (text: string, anchor: Point, stepM: number, angle: number): LabelChar[] => {
  // 読む向きが左から右になるように（左向きなら反転）
  let a = angle;
  if (Math.cos(a) < 0) a += Math.PI;
  // 立ちすぎると読みにくいので ±50° に抑える
  const lim = (50 * Math.PI) / 180;
  const s = Math.atan2(Math.sin(a), Math.cos(a));
  a = Math.max(-lim, Math.min(lim, s));
  const chars = [...text];
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  return chars.map((ch, k) => {
    const t = (k - (chars.length - 1) / 2) * stepM;
    return { ch, at: [anchor[0] + dx * t, anchor[1] + dy * t] as Point, angle: 0 };
  });
};

const cumulative = (line: Polyline): number[] => {
  const s = [0];
  for (let k = 1; k < line.length; k++) s.push(s[k - 1]! + Math.hypot(line[k]![0] - line[k - 1]![0], line[k]![1] - line[k - 1]![1]));
  return s;
};

/** 折れ線上の弧長 t の点と接線の向き */
const pointAt = (line: Polyline, cum: readonly number[], t: number): { p: Point; angle: number; k: number } => {
  let k = 1;
  while (k < line.length - 1 && cum[k]! < t) k++;
  const a = line[k - 1]!;
  const b = line[k]!;
  const seg = cum[k]! - cum[k - 1]! || 1;
  const f = Math.max(0, Math.min(1, (t - cum[k - 1]!) / seg));
  return { p: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], angle: Math.atan2(b[1] - a[1], b[0] - a[0]), k: k - 1 };
};

/**
 * 川名：川筋に沿って、川の片側（左岸の外）に字を置く。字は川の向きに回す（読む向きが逆さにならないように反転）。
 * 置く位置の候補は、中央から順に。focus に近い位置を先に試す。
 */
const riverCandidates = (river: River, text: string, stepM: number, fontM: number, focus: Point): LabelChar[][] => {
  const line = river.points;
  if (line.length < 2) return [];
  const cum = cumulative(line);
  const total = cum[cum.length - 1]!;
  const need = stepM * ([...text].length - 1);
  if (total < need + stepM) return [];
  const starts: number[] = [];
  for (const f of [0.5, 0.38, 0.62, 0.26, 0.74, 0.15, 0.85]) starts.push(Math.max(0, Math.min(total - need, f * total - need / 2)));
  // focus に近い所から
  const near = (t: number) => {
    const { p } = pointAt(line, cum, t + need / 2);
    return Math.hypot(p[0] - focus[0], p[1] - focus[1]);
  };
  // focus の近くを細かく探す候補も足す
  for (let t = 0; t + need <= total; t += Math.max(stepM * 2, total / 40)) starts.push(t);
  const uniq = [...new Set(starts.map((t) => Math.round(t)))].sort((a, b) => near(a) - near(b));
  const out: LabelChar[][] = [];
  for (const t0 of uniq.slice(0, 12)) {
    const mid = pointAt(line, cum, t0 + need / 2);
    // 読む向き：右向きでなければ逆から並べる
    const reverse = Math.cos(mid.angle) < 0;
    const chars = [...text];
    const placed: LabelChar[] = chars.map((ch, k) => {
      const t = reverse ? t0 + need - k * stepM : t0 + k * stepM;
      const q = pointAt(line, cum, t);
      const width = river.widths[q.k] ?? 0;
      const off = width / 2 + fontM * 0.85;
      // 進む向きの左側（画面では上側）へずらす
      const nx = Math.sin(q.angle);
      const ny = -Math.cos(q.angle);
      const side = reverse ? -1 : 1;
      let angle = q.angle + (reverse ? Math.PI : 0);
      angle = Math.atan2(Math.sin(angle), Math.cos(angle));
      return { ch, at: [q.p[0] + nx * off * side, q.p[1] + ny * off * side] as Point, angle };
    });
    // 曲がりすぎ（隣の字との向きの差が大きい）は読みにくいので避ける
    let bend = 0;
    for (let k = 1; k < placed.length; k++) {
      const d = Math.abs(Math.atan2(Math.sin(placed[k]!.angle - placed[k - 1]!.angle), Math.cos(placed[k]!.angle - placed[k - 1]!.angle)));
      bend = Math.max(bend, d);
    }
    if (bend < Math.PI / 4) out.push(placed);
  }
  return out;
};

/**
 * 注記を置く。返すのは置けたものだけ（優先度の高い順）。位置は地図座標で、縮尺（pxPerM）だけに依存する。
 * パンでは変わらないので、描く側は表示の幅ごとに覚えておける。
 */
export const layoutLabels = (input: LabelInput, opts: LabelLayoutOptions): PlacedLabel[] => {
  const kinds = new Set(LABEL_KINDS_BY_LOD[opts.lod].filter((k) => !(opts.lite && LITE_DROPPED.includes(k))));
  const items = input.toponyms
    .filter((t): t is Toponym & { kind: LabelKind } => t.kind !== "region" && kinds.has(t.kind as LabelKind))
    .map((t, order) => ({ t, order }))
    .sort((a, b) => LABEL_PRIORITY[a.t.kind] - LABEL_PRIORITY[b.t.kind] || a.order - b.order);
  const placed: PlacedLabel[] = [];
  const boxes: Box[] = [];
  const fits = (chars: readonly LabelChar[], halfM: number) => chars.every((c) => !boxes.some((b) => overlaps(b, boxOf(c, halfM))));
  for (const { t } of items) {
    const fontPx = LABEL_FONT_PX[t.kind];
    const fontM = fontPx / opts.pxPerM;
    const halfM = (fontM * (1 + LABEL_PAD)) / 2;
    const text = t.kind === "destination" ? input.destinationText(t.name) : t.name;
    let candidates: LabelChar[][];
    switch (t.kind) {
      case "river": {
        const river = input.rivers.find((r) => r.name === t.name);
        candidates = river ? riverCandidates(river, text, fontM * RIVER_SPACING, fontM, opts.focus) : [horizontal(text, t.anchor, fontM)];
        break;
      }
      case "mountain":
      case "hill": {
        const angle = input.ridgeAngle?.(t.anchor) ?? 0;
        const step = fontM * (t.kind === "mountain" ? MOUNTAIN_SPACING : 1.25);
        // 頂の記号に重ならないように少し下へ
        const anchor: Point = [t.anchor[0], t.anchor[1] + fontM * 0.9];
        candidates = [alongAxis(text, anchor, step, angle), horizontal(text, anchor, step)];
        break;
      }
      case "destination": {
        // 街道の終点は地図の縁にあるので、村の方へ字数分だけ寄せる（縁で切れないように）
        const dx = opts.focus[0] - t.anchor[0];
        const dy = opts.focus[1] - t.anchor[1];
        const d = Math.hypot(dx, dy) || 1;
        const pull = fontM * ([...text].length / 2 + 1.5);
        candidates = [horizontal(text, [t.anchor[0] + (dx / d) * pull, t.anchor[1] + (dy / d) * pull], fontM)];
        break;
      }
      default:
        candidates = [horizontal(text, t.anchor, fontM)];
    }
    const chosen = candidates.find((c) => fits(c, halfM));
    if (!chosen) continue;
    for (const c of chosen) boxes.push(boxOf(c, halfM));
    placed.push({ kind: t.kind, text, fontPx, chars: chosen });
  }
  return placed;
};

/**
 * 尾根の向き：頂の周り（radiusM）で、頂から dropM 以内の高さのセルの広がりの主軸（共分散の第1固有ベクトル）。
 * 尾根が伸びる向きに山名を並べるため。
 */
export const ridgeAxis = (r: HeightRegion, anchor: Point, radiusM = 450, dropM = 60): number => {
  const ci = Math.round((anchor[0] - r.origin[0]) / r.cell);
  const cj = Math.round((anchor[1] - r.origin[1]) / r.cell);
  const rad = Math.max(2, Math.round(radiusM / r.cell));
  const step = Math.max(1, Math.round(rad / 30));
  const top = r.h[Math.max(0, Math.min(r.n - 1, cj)) * r.n + Math.max(0, Math.min(r.n - 1, ci))]!;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  let w = 0;
  for (let dj = -rad; dj <= rad; dj += step) {
    for (let di = -rad; di <= rad; di += step) {
      const i = ci + di;
      const j = cj + dj;
      if (i < 0 || j < 0 || i >= r.n || j >= r.n || di * di + dj * dj > rad * rad) continue;
      if (top - r.h[j * r.n + i]! > dropM) continue;
      sx += di;
      sy += dj;
      sxx += di * di;
      syy += dj * dj;
      sxy += di * dj;
      w++;
    }
  }
  if (w < 3) return 0;
  const mx = sx / w;
  const my = sy / w;
  const cxx = sxx / w - mx * mx;
  const cyy = syy / w - my * my;
  const cxy = sxy / w - mx * my;
  return 0.5 * Math.atan2(2 * cxy, cxx - cyy);
};
