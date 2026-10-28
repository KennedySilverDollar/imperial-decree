import { chamferDistance, slopeAt, type Grid } from "./grid";
import { GEOLOGY, HYDROLOGY, PLANE_HALF_M } from "./terrainConstants";
import type { VillageFrame } from "./types";

// 地質ゾーン（SPEC_v3.4 §3.1 の 5、§3.5）：岩盤・露頭／河原（礫）／低湿地（粘土）／段丘面・畑向き（ローム）。
// 氾濫原は「川から一定距離内で、最寄りの川面から数 m 以内の低平地」。段丘面（村域）は必ずローム。

export const GEOLOGY_CLASS = { loam: 0, bedrock: 1, gravel: 2, clay: 3 } as const;

export interface WaterDistance {
  /** 川・湖からの距離（m） */
  readonly dist: Float32Array;
  /** 最寄りの水面の標高（m） */
  readonly nearestLevel: Float32Array;
}

export const waterDistance = (water: Uint8Array, level: Float32Array, g: Grid): WaterDistance => {
  const { dist, nearest } = chamferDistance(water, level, g);
  return { dist, nearestLevel: nearest };
};

export const classifyGeology = (
  H: Float32Array,
  g: Grid,
  wd: WaterDistance,
  F: VillageFrame,
  villageLevel: number,
): Uint8Array => {
  const n = g.n;
  const out = new Uint8Array(n * n);
  const [cx, cy] = F.center;
  const [ax, ay] = F.axisA;
  const [bx, by] = F.axisB;
  const planeHalf = PLANE_HALF_M;
  const { bedrockSlope, bedrockHighM, bedrockHighSlope } = GEOLOGY;
  const { gravelBankM, floodplainMaxM, floodplainRelM } = HYDROLOGY;
  const { dist, nearestLevel } = wd;
  for (let j = 0; j < n; j++) {
    const dy = (j + 0.5) * g.cell - cy;
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const dx = (i + 0.5) * g.cell - cx;
      if (Math.max(Math.abs(dx * ax + dy * ay), Math.abs(dx * bx + dy * by)) <= planeHalf) continue; // 段丘面はローム
      const d = dist[k]!;
      const s = slopeAt(H, g, i, j);
      const rel = H[k]! - nearestLevel[k]!;
      if (s > bedrockSlope || (H[k]! - villageLevel > bedrockHighM && s > bedrockHighSlope)) out[k] = GEOLOGY_CLASS.bedrock;
      else if (d > 0 && d <= gravelBankM && rel < floodplainRelM) out[k] = GEOLOGY_CLASS.gravel;
      else if (d <= floodplainMaxM && rel < floodplainRelM) out[k] = GEOLOGY_CLASS.clay;
    }
  }
  return out;
};
