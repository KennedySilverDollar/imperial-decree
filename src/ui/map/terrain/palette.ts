import { VEGETATION_CLASS } from "./Vegetation";

// 地図の水彩の配色（SPEC_v3.4 §6.4。彩度低め、朱のみアクセント）。下塗り（ベイク）とプレビューで使う。

export type Rgb = readonly [number, number, number];

const hex = (h: string): Rgb => [Number.parseInt(h.slice(1, 3), 16), Number.parseInt(h.slice(3, 5), 16), Number.parseInt(h.slice(5, 7), 16)];

export const MAP_COLORS = {
  paper: hex("#E8DCC0"),
  broadleaf: hex("#8FA06A"),
  conifer: hex("#6F8260"),
  grass: hex("#B9BE8A"),
  wetland: hex("#A4B59A"),
  gravel: hex("#C9C3B0"),
  bedrock: hex("#B3A898"),
  bare: hex("#D2BF93"),
  riverLine: hex("#4F6B7A"),
  waterShallow: hex("#B7CBCF"),
  waterDeep: hex("#8FAAB3"),
  road: hex("#CBB98E"),
  roadLine: hex("#5C4A35"),
  ink: hex("#2B1D0E"),
  vermilion: hex("#A63A2E"),
  scrub: hex("#A9AF7E"),
} as const;

export const vegetationColor = (cls: number): Rgb => {
  switch (cls) {
    case VEGETATION_CLASS.water:
      return MAP_COLORS.waterDeep;
    case VEGETATION_CLASS.conifer:
      return MAP_COLORS.conifer;
    case VEGETATION_CLASS.broadleaf:
      return MAP_COLORS.broadleaf;
    case VEGETATION_CLASS.grass:
      return MAP_COLORS.grass;
    case VEGETATION_CLASS.scrub:
      return MAP_COLORS.scrub;
    case VEGETATION_CLASS.wetland:
      return MAP_COLORS.wetland;
    default:
      return MAP_COLORS.bare;
  }
};
