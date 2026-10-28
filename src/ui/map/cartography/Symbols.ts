import { VEGETATION_CLASS } from "../terrain/Vegetation";
import type { Point } from "../terrain/types";

// 植生の記号（SPEC_v3.4 §6.1 レイヤ6）。植生の格子から、ずらした格子点に樹冠などの記号を置く（seed 付き・決定論）。
// 記号の種類：広葉樹＝丸い樹冠、針葉樹＝尖った樹冠、藪＝点の群れ、草地＝まばらな草、湿地＝水平線と草。

export type SymbolKind = "broadleaf" | "conifer" | "scrub" | "grass" | "wetland";

export interface VegetationSymbol {
  readonly kind: SymbolKind;
  readonly at: Point;
  /** 大きさの倍率（0.8〜1.2） */
  readonly size: number;
}

const KIND_OF: Readonly<Record<number, SymbolKind | null>> = {
  [VEGETATION_CLASS.water]: null,
  [VEGETATION_CLASS.conifer]: "conifer",
  [VEGETATION_CLASS.broadleaf]: "broadleaf",
  [VEGETATION_CLASS.grass]: "grass",
  [VEGETATION_CLASS.scrub]: "scrub",
  [VEGETATION_CLASS.wetland]: "wetland",
  [VEGETATION_CLASS.bare]: null,
};

/** 草地は記号をまばらに（4つに1つ） */
const GRASS_KEEP = 0.25;

/**
 * area（座標は呼び出し側の座標系のメートル）を spacingM の格子で覆い、各格子点を少しずらして記号を置く。
 * classAt はその点の植生の分類（Vegetation.ts の VEGETATION_CLASS）。
 */
export const vegetationSymbols = (
  classAt: (p: Point) => number,
  area: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number },
  spacingM: number,
  seed: number,
  skip?: (p: Point) => boolean,
): VegetationSymbol[] => {
  const out: VegetationSymbol[] = [];
  const hash = (a: number, b: number) => {
    let x = Math.imul(a ^ (b * 0x9e3779b1), 0x85ebca6b) ^ seed;
    x ^= x >>> 13;
    x = Math.imul(x, 0xc2b2ae35);
    x ^= x >>> 16;
    return (x >>> 0) / 4294967296;
  };
  const i0 = Math.floor(area.x0 / spacingM);
  const j0 = Math.floor(area.y0 / spacingM);
  for (let j = j0; j * spacingM < area.y1; j++) {
    for (let i = i0; i * spacingM < area.x1; i++) {
      const x = (i + 0.2 + 0.6 * hash(i, j)) * spacingM;
      const y = (j + 0.2 + 0.6 * hash(j + 7, i + 3)) * spacingM;
      if (x < area.x0 || y < area.y0 || x >= area.x1 || y >= area.y1) continue;
      const kind = KIND_OF[classAt([x, y])] ?? null;
      if (kind === null) continue;
      if (kind === "grass" && hash(i + 13, j + 29) > GRASS_KEEP) continue;
      if (skip?.([x, y])) continue;
      out.push({ kind, at: [x, y], size: 0.8 + 0.4 * hash(i + 101, j + 57) });
    }
  }
  return out;
};
