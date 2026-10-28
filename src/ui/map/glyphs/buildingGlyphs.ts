import type { BuildingId } from "../../../domain/Buildings";

// 建物の絵記号（SPEC_v3.4 §6.1 レイヤ10、AA-12）。自作（CC0。docs/ASSETS.md）。
// 24×24 の枠に、測量図の記号のような細い線で描く。線の太さはすべて GLYPH_STROKE で揃える（拡大しても比は同じ）。
// 対応表は BuildingId をキーにする（型で網羅を保証）。文字の記号（messages.tileGlyphs）と同じ形の表なので、
// どちらを使うかは描画側で選べる（抽象グリッドへのフォールバックは文字のまま）。

export const GLYPH_BOX = 24;
export const GLYPH_STROKE = 1.6;

export type Glyph = { readonly kind: "svg"; readonly path: string } | { readonly kind: "text"; readonly char: string };

export const SVG_GLYPHS = {
  // 住宅：切妻の家
  residential: { kind: "svg", path: "M4 12 L12 5 L20 12 M6 11 V19 H18 V11 M10.5 19 V15 H13.5 V19" },
  // 長屋：細長い連棟
  tenement: { kind: "svg", path: "M2 11 L5 7 H19 L22 11 Z M3 11 V18 H21 V11 M8 11 V18 M12 11 V18 M16 11 V18" },
  // 屋敷：塀に囲まれた母屋
  manor: { kind: "svg", path: "M3 3 H21 V21 H3 Z M7 13 L12 8 L17 13 M8 12 V17 H16 V12 M10.5 21 V19 H13.5 V21" },
  // 道路：二本の路肩線
  road: { kind: "svg", path: "M2 9 H22 M2 15 H22 M6 12 H8 M11 12 H13 M16 12 H18" },
  // 井戸：井桁と石組み
  well: { kind: "svg", path: "M12 7 A5 5 0 1 1 11.99 7 Z M8 4 V20 M16 4 V20 M4 8 H20 M4 16 H20" },
  // 倉庫：大きな切妻と搬入口
  granary: { kind: "svg", path: "M3 11 L12 4 L21 11 Z M5 11 V20 H19 V11 M9 20 V15 H15 V20" },
  // 市場：広場と露店
  market: { kind: "svg", path: "M4 4 H20 V20 H4 Z M7 7 H10 V10 H7 Z M14 7 H17 V10 H14 Z M7 14 H10 V17 H7 Z M14 14 H17 V17 H14 Z" },
  // 農地：畝と芽
  farm: { kind: "svg", path: "M3 8 H21 M3 12 H21 M3 16 H21 M3 20 H21 M12 8 V3 M12 5 L9 3.5 M12 5 L15 3.5" },
  // 工房：鋸屋根
  workshop: { kind: "svg", path: "M4 20 V11 L9 7 V11 L14 7 V11 L19 7 V20 Z M8 20 V15 H11 V20" },
  // 役所：庁舎と旗
  office: { kind: "svg", path: "M5 21 V11 H19 V21 M3 21 H21 M3 11 L12 7 L21 11 M12 7 V2 M12 2 H17 L15.5 3.5 L17 5 H12" },
  // 徴税所：小さな番所と銭
  taxoffice: { kind: "svg", path: "M6 20 V12 H18 V20 M4 12 L12 7 L20 12 M9.5 16 A2.5 2.5 0 1 0 14.5 16 A2.5 2.5 0 1 0 9.5 16 Z" },
  // 裁判所：庁舎と白洲
  courthouse: { kind: "svg", path: "M4 3 H20 V11 H4 Z M8 14 H16 V21 H8 Z M12 11 V14 M7 7 H17" },
  // 診療所：十字の札
  clinic: { kind: "svg", path: "M5 5 H19 V19 H5 Z M12 8 V16 M8 12 H16" },
  // 学校：長い教室棟と窓
  school: { kind: "svg", path: "M2 20 V12 H22 V20 Z M2 12 L5 8 H19 L22 12 M6 15 H8 M11 15 H13 M16 15 H18" },
  // 寺院：反りのある屋根と山門
  temple: { kind: "svg", path: "M2 10 Q12 4 22 10 M5 10 V20 H19 V10 M9 20 V14 H15 V20 M12 5 V2" },
  // 見張り塔：櫓
  watchtower: { kind: "svg", path: "M9 21 L10 9 H14 L15 21 M7 9 H17 L12 3 Z M9.6 15 H14.4 M10 21 L14.2 15 M14 21 L9.8 15" },
  // 牢屋：格子
  jail: { kind: "svg", path: "M4 4 H20 V20 H4 Z M8 4 V20 M12 4 V20 M16 4 V20 M4 12 H20" },
} as const satisfies Record<BuildingId, Glyph>;

/** 1つの記号の SVG（ASSETS とテスト用） */
export const glyphSvg = (kind: BuildingId, color = "#2B1D0E"): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GLYPH_BOX} ${GLYPH_BOX}" width="${GLYPH_BOX}" height="${GLYPH_BOX}">` +
  `<path d="${SVG_GLYPHS[kind].path}" fill="none" stroke="${color}" stroke-width="${GLYPH_STROKE}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
