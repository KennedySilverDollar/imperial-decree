import { terrainSeed } from "../../domain/Landscape";
import { renderBase } from "./BaseRenderer";
import { MAP_PX } from "./mapConstants";
import type { Ctx2D } from "./pictograms";
import { generateTerrain, type TerrainData } from "./TerrainGenerator";

// 地形生成の Worker（SPEC_v3.3 §2.2・§5.2）。saveId を受け取り、地形を作って生成時のレイヤ（紙〜森）を OffscreenCanvas に描き、
// ImageBitmap にして返す。本体のスレッドを止めない（新規ゲームの開始時に 1.5 秒以内：§2.3）。

export interface TerrainRequest {
  readonly id: number;
  readonly saveId: string;
  /** 依頼した時刻（Date.now()。受け渡しの待ちを測る） */
  readonly sentAt: number;
}

export type TerrainResponse =
  | {
      readonly id: number;
      readonly ok: true;
      readonly terrain: TerrainData;
      readonly base: ImageBitmap;
      readonly generateMs: number;
      readonly renderMs: number;
      readonly phases: Readonly<Record<string, number>>;
    }
  | { readonly id: number; readonly ok: false; readonly error: string };

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<TerrainRequest>) => void) | null;
  postMessage: (message: TerrainResponse, transfer: Transferable[]) => void;
};

scope.onmessage = (event) => {
  const receivedAt = Date.now();
  const { id, saveId } = event.data;
  try {
    const started = performance.now();
    const terrain = generateTerrain(terrainSeed(saveId));
    const generated = performance.now();
    const canvas = new OffscreenCanvas(MAP_PX, MAP_PX);
    const ctx = canvas.getContext("2d") as Ctx2D | null;
    if (ctx === null) throw new Error("OffscreenCanvas 2d unavailable");
    const phases = renderBase(ctx, terrain, (w, h) => new OffscreenCanvas(w, h));
    const beforeBitmap = performance.now();
    const base = canvas.transferToImageBitmap();
    const rendered = performance.now();
    const all = { ...phases, bitmap: Math.round(rendered - beforeBitmap), queued: Math.round(receivedAt - event.data.sentAt), sentAt: Date.now() };
    scope.postMessage({ id, ok: true, terrain, base, generateMs: generated - started, renderMs: rendered - generated, phases: all }, [
      base,
      terrain.heightmap.buffer,
      terrain.water.buffer,
      terrain.forestMask.buffer,
      terrain.fertility.buffer,
    ]);
  } catch (error) {
    scope.postMessage({ id, ok: false, error: error instanceof Error ? error.message : String(error) }, []);
  }
};
