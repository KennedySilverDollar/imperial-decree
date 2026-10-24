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
