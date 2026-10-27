import type { BuildingId } from "../../domain/Buildings";

// 建物の絵記号 17 種（SPEC_v3.3 §10.2・SPEC_v3.2 §2.3 の一覧に対応、自作 SVG）。
// 様式：32×32 の枠、線だけ（塗らない）、線の太さは一律 PICTOGRAM_STROKE、端と角は丸。官製の地図記号に倣い、
// 役所は二重丸、徴税所は算盤玉、裁判所は高札、学校は「文」、畑は双葉、工房は歯車。
// 同じ線のデータを、地図（Canvas の Path2D）と凡例（DOM の <svg>）の両方で使う。

export const PICTOGRAM_BOX = 32;
export const PICTOGRAM_STROKE = 2;

const circle = (cx: number, cy: number, r: number) => `M${cx - r} ${cy} A${r} ${r} 0 1 0 ${cx + r} ${cy} A${r} ${r} 0 1 0 ${cx - r} ${cy} Z`;

export const PICTOGRAMS: Readonly<Record<BuildingId, string>> = {
  // 家：切妻の屋根と戸口
  residential: "M6 16 L16 7 L26 16 M9 14 V26 H23 V14 M14 26 V20 H18 V26",
  // 長屋：長い屋根と三つの戸
  tenement: "M3 15 L8 9 H24 L29 15 M5 14 V25 H27 V14 M11 25 V20 M16 25 V20 M21 25 V20",
  // 屋敷：塀で囲った家
  manor: "M4 27 V8 H28 V27 H19 M13 27 H4 M9 18 L16 12 L23 18 M11 17 V24 H21 V17",
  // 道路：二本の道の線（凡例用。地図では区画の境界に二重線を引く）
  road: "M3 12 C11 10 21 14 29 12 M3 20 C11 18 21 22 29 20",
  // 井戸：丸に井桁
  well: `${circle(16, 16, 10)} M12.5 9.5 V22.5 M19.5 9.5 V22.5 M9.5 12.5 H22.5 M9.5 19.5 H22.5`,
  // 倉庫：高床の倉と壁の筋交い
  granary: "M5 12 L16 6 L27 12 M7 12 V22 H25 V12 M7 22 L5 27 M25 22 L27 27 M12 15 L20 19 M20 15 L12 19",
  // 市場：日除けの幕と柱
  market: "M5 13 L8 8 H24 L27 13 Z M8 13 Q9.5 16 11 13 Q12.5 16 14 13 Q15.5 16 17 13 Q18.5 16 20 13 Q21.5 16 23 13 M8 14 V26 M24 14 V26 M5 26 H27",
  // 農地：双葉
  farm: "M16 27 V15 M16 19 C11 19 8 15 8 10 C13 10 16 13 16 19 M16 15 C16 10 19 6 25 6 C25 12 21 15 16 15 M10 27 H22",
  // 工房：歯車
  workshop: `${circle(16, 16, 6)} M16 4 V8.5 M16 23.5 V28 M4 16 H8.5 M23.5 16 H28 M7.5 7.5 L10.7 10.7 M21.3 21.3 L24.5 24.5 M7.5 24.5 L10.7 21.3 M21.3 10.7 L24.5 7.5`,
  // 役所：二重丸
  office: `${circle(16, 16, 11)} ${circle(16, 16, 5.5)}`,
  // 徴税所：算盤玉
  taxoffice: "M16 3 V29 M6 16 L16 10 L26 16 L16 22 Z M6 16 H26",
  // 裁判所：高札
  courthouse: "M5 9 L16 5 L27 9 M7 10 H25 V19 H7 Z M10 19 V28 M22 19 V28 M10 14.5 H22",
  // 診療所：丸に十字
  clinic: `${circle(16, 16, 10)} M16 10 V22 M10 16 H22`,
  // 学校：「文」
  school: "M16 4.5 V8.5 M7 10 H25 M10.5 12 C13 20 17 25 25.5 27 M21.5 12 C19 20 15 25 6.5 27",
  // 寺院：二層の屋根
  temple: "M16 4 V8 M9 11 L16 8 L23 11 M11 11 V15 M21 11 V15 M6 18.5 L16 14 L26 18.5 M10 18.5 V27 M22 18.5 V27 M6 27 H26",
  // 見張り塔：櫓
  watchtower: "M12 9 L14 4 H18 L20 9 Z M11 9 H21 M12 9 L9 28 M20 9 L23 28 M10.5 18 H21.5 M10 23 L22 27 M22 23 L10 27",
  // 牢屋：格子
  jail: "M6 7 H26 V27 H6 Z M11 7 V27 M16 7 V27 M21 7 V27 M6 14 H26",
};

/** 凡例などの DOM 用：線だけの <svg> の中身（色は currentColor） */
export const pictogramSvgPath = (id: BuildingId): string => PICTOGRAMS[id];

/** Canvas 2D の文脈（HTMLCanvas と OffscreenCanvas のどちらでも） */
export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const cache = new Map<BuildingId, Path2D>();

/** 1つの記号の線の長さの上限（記号の枠の単位）。描き込みの途中（reveal < 1）は、この長さに対する割合だけ線を引く */
const PICTOGRAM_PATH_MAX = 420;

/** 地図に絵記号を描く（中心 (cx, cy)、一辺 size）。reveal は描き込みの進み（0..1、線を引く順に現れる）。Path2D は使い回す */
export const drawPictogram = (ctx: Ctx2D, id: BuildingId, cx: number, cy: number, size: number, color: string, alpha = 1, reveal = 1): void => {
  let path = cache.get(id);
  if (!path) {
    path = new Path2D(PICTOGRAMS[id]);
    cache.set(id, path);
  }
  const scale = size / PICTOGRAM_BOX;
  ctx.save();
  ctx.translate(cx - size / 2, cy - size / 2);
  ctx.scale(scale, scale);
  ctx.globalAlpha *= alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = PICTOGRAM_STROKE;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (reveal < 1) ctx.setLineDash([PICTOGRAM_PATH_MAX * Math.max(0, reveal), PICTOGRAM_PATH_MAX]);
  ctx.stroke(path);
  ctx.restore();
};
