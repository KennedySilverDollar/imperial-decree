// 測量図専用パレット（SPEC_v3.3 §5.4）と、机のパレット（§3.5）のうち地図で使う色。
// 純色は使わず、朱は亀裂印だけ（不変条件24：朱には必ず線・印を併用する）。

export const SURVEY = {
  paper: "#E8DCC0",
  paperDeep: "#DCCDA9",
  lowland: "#A9B08A",
  midland: "#C9B98E",
  highland: "#B7A89A",
  contour: "#8A6A4A",
  waterLine: "#4F6B7A",
  waterWash: "#9FB3B8",
  forest: "#55603F",
  ink: "#2B1D0E",
  newInk: "#1A1008",
  oldInk: "#5C4A35",
  pencil: "#6B6B6B",
  vermilion: "#A63A2E",
  /** 畑の縞（地味が低い〜高い） */
  fieldPoor: "#9A8456",
  fieldRich: "#5E6B3A",
  /** 道の二重線の内側（踏み固めた土） */
  roadFill: "#E3D5B4",
} as const;

export const hexToRgb = (hex: string): readonly [number, number, number] => {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

export const mixHex = (a: string, b: string, t: number): string => {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  const c = (x: number, y: number) => Math.round(x + (y - x) * t).toString(16).padStart(2, "0");
  return `#${c(ar, br)}${c(ag, bg)}${c(ab, bb)}`;
};
