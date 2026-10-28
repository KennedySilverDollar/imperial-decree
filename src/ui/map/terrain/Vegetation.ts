import { createNoise2D } from "simplex-noise";
import { GEOLOGY_CLASS, type WaterDistance } from "./Geology";
import { pointInPolygon } from "./geometry";
import { slopeAt, type Grid } from "./grid";
import { createRandom } from "./rng";
import { PLANE_BLEND_M, PLANE_HALF_M, VEGETATION } from "./terrainConstants";
import type { Polygon, VillageFrame } from "./types";

// 植生（SPEC_v3.4 §3.1 の 6、§3.5）。標高 × 傾斜 × 水までの距離 × 地質から分類する。
// 境界が直線にならないよう、低周波ノイズで分類の閾値を揺らす。村域の段丘面は草地（村は何もない所に開かれる）。

export const VEGETATION_CLASS = { water: 0, conifer: 1, broadleaf: 2, grass: 3, scrub: 4, wetland: 5, bare: 6 } as const;

/** 多角形をマスクに塗る（外接矩形の内側だけ点の内外を判定する） */
export const rasterizePolygons = (polys: readonly Polygon[], g: Grid): Uint8Array => {
  const mask = new Uint8Array(g.n * g.n);
  for (const poly of polys) {
    const xs = poly.map((p) => p[0]);
    const ys = poly.map((p) => p[1]);
    const i0 = Math.max(0, Math.floor(Math.min(...xs) / g.cell));
    const i1 = Math.min(g.n - 1, Math.ceil(Math.max(...xs) / g.cell));
    const j0 = Math.max(0, Math.floor(Math.min(...ys) / g.cell));
    const j1 = Math.min(g.n - 1, Math.ceil(Math.max(...ys) / g.cell));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) if (pointInPolygon([(i + 0.5) * g.cell, (j + 0.5) * g.cell], poly)) mask[j * g.n + i] = 1;
    }
  }
  return mask;
};

export const classifyVegetation = (
  H: Float32Array,
  g: Grid,
  water: Uint8Array,
  geology: Uint8Array,
  wd: WaterDistance,
  oldChannels: readonly Polygon[],
  F: VillageFrame,
  villageLevel: number,
  noiseSeed: number,
): Uint8Array => {
  const noise = createNoise2D(createRandom(noiseSeed));
  const n = g.n;
  const out = new Uint8Array(n * n);
  const old = rasterizePolygons(oldChannels, g);
  const scale = VEGETATION.patchNoiseScaleM;
  const { coniferAboveM, scrubSlope, broadleafWaterM, wetlandWaterM } = VEGETATION;
  const C = VEGETATION_CLASS;
  const clay = GEOLOGY_CLASS.clay;
  const gravel = GEOLOGY_CLASS.gravel;
  const bedrock = GEOLOGY_CLASS.bedrock;
  const grassHalf = PLANE_HALF_M + PLANE_BLEND_M / 2;
  const [cx, cy] = F.center;
  const [ax, ay] = F.axisA;
  const [bx, by] = F.axisB;
  const { dist } = wd;
  // 分類を揺らすノイズ（波長 130m〜）は 1/4 の格子で求めて補間する
  const step = 4;
  const sn = Math.ceil(n / step) + 1;
  const patch = new Float32Array(sn * sn);
  for (let j = 0; j < sn; j++) {
    for (let i = 0; i < sn; i++) {
      const x = i * step * g.cell;
      const y = j * step * g.cell;
      patch[j * sn + i] = noise(x / scale, y / scale) * 0.7 + noise((3 * x) / scale, (3 * y) / scale) * 0.3;
    }
  }
  for (let j = 0; j < n; j++) {
    const pj = (j + 0.5) / step;
    const pj0 = Math.min(sn - 2, Math.floor(pj));
    const py = pj - pj0;
    const y = (j + 0.5) * g.cell;
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const x = (i + 0.5) * g.cell;
      if (water[k]) {
        out[k] = C.water;
        continue;
      }
      const geo = geology[k]!;
      const d = dist[k]!;
      const pi = (i + 0.5) / step;
      const pi0 = Math.min(sn - 2, Math.floor(pi));
      const px = pi - pi0;
      const pq = pj0 * sn + pi0;
      const nz =
        patch[pq]! * (1 - px) * (1 - py) + patch[pq + 1]! * px * (1 - py) + patch[pq + sn]! * (1 - px) * py + patch[pq + sn + 1]! * px * py;
      if (old[k] || (geo === clay && d < wetlandWaterM * (1 + 0.8 * nz))) {
        out[k] = C.wetland;
        continue;
      }
      if (geo === gravel || geo === bedrock) {
        out[k] = C.bare;
        continue;
      }
      const dx = x - cx;
      const dy = y - cy;
      const la = dx * ax + dy * ay;
      const lb = dx * bx + dy * by;
      if (Math.sqrt(Math.sqrt(la * la * la * la + lb * lb * lb * lb)) <= grassHalf) {
        out[k] = C.grass;
        continue;
      }
      const rel = H[k]! - villageLevel;
      const s = slopeAt(H, g, i, j);
      if (rel > coniferAboveM + 40 * nz) out[k] = C.conifer;
      else if (s > scrubSlope + 0.1 * nz) out[k] = nz > 0 ? C.conifer : C.scrub;
      else if (d < broadleafWaterM * (1 + 0.3 * nz)) out[k] = nz < -0.4 ? C.grass : C.broadleaf;
      else if (nz > 0.15) out[k] = C.broadleaf;
      else if (nz > -0.1) out[k] = C.scrub;
      else out[k] = C.grass;
    }
  }
  return out;
};
