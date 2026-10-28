import { bakeAll, type BakeSpec } from "../cartography/Bake";
import { generateTerrain, type TerrainOptions } from "./generateTerrain";
import type { TerrainResult } from "./types";

// 地形生成の Worker（SPEC_v3.4 §11）。薄いラッパー：純関数 generateTerrain を呼び、
// 静的なレイヤ（紙・淡彩・陰影・等高線・ケバ・水系・植生の記号・街道。cartography/Bake.ts）を段階ごとに
// OffscreenCanvas でベイクして ImageBitmap にし、型付き配列ごと転送で返す（§6.1・§9）。

export interface TerrainRequest {
  readonly saveId: string;
  readonly options?: TerrainOptions;
}

export interface BakedBitmap {
  readonly spec: BakeSpec;
  readonly bitmap: ImageBitmap;
}

export type TerrainResponse = TerrainResult & {
  /** ベイクした静的レイヤ（生成に失敗したとき・OffscreenCanvas がないときは空） */
  readonly layers: readonly BakedBitmap[];
  /** Worker 内で測った所要時間（ms。ベイクを含む） */
  readonly workerMs: number;
  /** うちベイクの所要時間（ms、レイヤごと） */
  readonly bakeMs: Readonly<Record<string, number>>;
};

interface WorkerScope {
  onmessage: ((event: MessageEvent<TerrainRequest>) => void) | null;
  postMessage(message: TerrainResponse, transfer: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (event) => {
  const started = performance.now();
  const result = generateTerrain(event.data.saveId, event.data.options);
  const layers: BakedBitmap[] = [];
  const bakeMs: Record<string, number> = {};
  const transfer: Transferable[] = [];
  if (result.ok && typeof OffscreenCanvas !== "undefined") {
    try {
      for (const baked of bakeAll(result.data)) {
        const bitmap = baked.canvas.transferToImageBitmap();
        layers.push({ spec: baked.spec, bitmap });
        transfer.push(bitmap);
        bakeMs[baked.spec.id] = Math.round(baked.ms);
      }
    } catch {
      // ベイクに失敗しても地形は使える（静的レイヤなしで描く）
    }
  }
  if (result.ok) {
    const d = result.data;
    for (const arr of [d.surround.heightmap, d.village.heightmap, d.village.normal, d.geology, d.vegetation]) transfer.push(arr.buffer as ArrayBuffer);
  }
  scope.postMessage({ ...result, layers, bakeMs, workerMs: performance.now() - started }, transfer);
};
