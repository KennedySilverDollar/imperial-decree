import type { Category } from "../domain/Buildings";

// 配色（SPEC §12.3）。CSS 変数（styles.css）と Phaser の描画で同じ値を使う。
// 原則：彩度は全体に低く、朱色だけがアクセント。純色は使わない。
export const palette = {
  desk: "#3B2A1A",
  paper: "#E8DCC0",
  ink: "#2B1D0E",
  vermilion: "#A63A2E",
  land: "#7A8B5A",
  water: "#5A7A8B",
  warning: "#7A2A2A",
  /** 道路（地図用。焦げ茶と羊皮紙の中間） */
  road: "#9C8460",
} as const;

/** 地図の建物の地色（カテゴリ別。低彩度。行政だけ朱色。styles.css の .legend-* と同じ値） */
export const categoryTint = {
  housing: "#D9C9A3",
  infrastructure: "#B8B39A",
  economy: "#C9AD7A",
  administration: palette.vermilion,
  social: "#A9B39A",
  security: "#8F8A80",
} as const satisfies Record<Category, string>;
