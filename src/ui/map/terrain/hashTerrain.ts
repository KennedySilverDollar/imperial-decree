import type { TerrainDataV2 } from "./types";

// TerrainDataV2 のハッシュ（決定論の確認用。SPEC_v3.4 §12.1）。型付き配列はバイト列、それ以外は JSON で FNV-1a。

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

const mixBytes = (h: number, bytes: Uint8Array): number => {
  let x = h;
  for (let i = 0; i < bytes.length; i++) x = Math.imul(x ^ bytes[i]!, FNV_PRIME);
  return x >>> 0;
};

const mixText = (h: number, text: string): number => {
  let x = h;
  for (let i = 0; i < text.length; i++) x = Math.imul(x ^ text.charCodeAt(i), FNV_PRIME);
  return x >>> 0;
};

const bytesOf = (a: Uint8Array | Uint16Array): Uint8Array => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);

export const hashTerrain = (d: TerrainDataV2): string => {
  let h = FNV_OFFSET;
  for (const arr of [d.surround.heightmap, d.village.heightmap, d.village.normal, d.geology, d.vegetation]) h = mixBytes(h, bytesOf(arr));
  const rest = {
    version: d.version,
    seed: d.seed,
    attempt: d.attempt,
    surround: [d.surround.size, d.surround.offsetM, d.surround.stepM],
    village: [d.village.size, d.village.offsetM, d.village.stepM, d.village.windowHalfM, d.village.frame],
    rivers: d.rivers,
    lakes: d.lakes,
    wetlands: d.wetlands,
    oldChannels: d.oldChannels,
    highway: d.highway,
    fords: d.fords,
    parcels: d.parcels,
    toponyms: d.toponyms,
  };
  h = mixText(h, JSON.stringify(rest));
  return h.toString(16).padStart(8, "0");
};
