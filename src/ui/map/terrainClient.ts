import { TERRAIN_TIMEOUT_MS } from "./mapConstants";
import type { Baked } from "./cartography/Layers";
import type { BakedBitmap, TerrainRequest, TerrainResponse } from "./terrain/terrain.worker";
import type { TerrainDataV2 } from "./terrain/types";

// 地形生成の Worker を呼ぶ口（SPEC_v3.4 §9）。saveId ごとに一度だけ生成して覚えておく（平面⇄立体の切り替えで作り直さない）。
// Worker が使えない・失敗した・時間切れのときは null（地図は抽象グリッドのまま。不変条件29）。

export interface TerrainReady {
  readonly data: TerrainDataV2;
  /** ベイクした静的レイヤ（段階ごと。cartography/Bake.ts）。CPU 側の Canvas に写したもの */
  readonly layers: readonly Baked[];
  /** 計測（開発用）：Worker の所要時間とベイクの内訳 */
  readonly workerMs: number;
  readonly bakeMs: Readonly<Record<string, number>>;
}

/**
 * CPU 側の Canvas（willReadFrequently）を作る。地図のテクスチャ（Phaser の CanvasTexture）は CPU 側の Canvas なので、
 * GPU 側の画像（Worker から来た ImageBitmap）をそのまま毎フレーム描くと、そのたびに GPU から読み戻して数百 ms 止まる。
 */
export const cpuCanvas = (size: number): HTMLCanvasElement | OffscreenCanvas | null => {
  const canvas = typeof document !== "undefined" ? document.createElement("canvas") : typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(size, size) : null;
  if (!canvas) return null;
  canvas.width = size;
  canvas.height = size;
  return canvas;
};

/** ベイク画像を一度だけ CPU 側の Canvas に写す（写せなければ ImageBitmap のまま） */
const toCpu = (b: BakedBitmap): Baked => {
  const canvas = cpuCanvas(b.spec.px);
  const ctx = canvas?.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D | null | undefined;
  if (!canvas || !ctx) return { spec: b.spec, image: b.bitmap };
  ctx.drawImage(b.bitmap, 0, 0);
  b.bitmap.close();
  return { spec: b.spec, image: canvas };
};

const cache = new Map<string, Promise<TerrainReady | null>>();

/** この環境で地形を生成できるか（jsdom などでは false。すぐに抽象グリッドを出す） */
export const terrainSupported = (): boolean => typeof Worker !== "undefined";

export const loadTerrain = (saveId: string): Promise<TerrainReady | null> => {
  const cached = cache.get(saveId);
  if (cached) return cached;
  const promise = new Promise<TerrainReady | null>((resolve) => {
    if (!terrainSupported()) {
      resolve(null);
      return;
    }
    let worker: Worker;
    try {
      worker = new Worker(new URL("./terrain/terrain.worker.ts", import.meta.url), { type: "module" });
    } catch {
      resolve(null);
      return;
    }
    const timer = setTimeout(() => {
      worker.terminate();
      resolve(null);
    }, TERRAIN_TIMEOUT_MS);
    worker.onmessage = (event: MessageEvent<TerrainResponse>) => {
      clearTimeout(timer);
      worker.terminate();
      const r = event.data;
      resolve(r.ok ? { data: r.data, layers: r.layers.map(toCpu), workerMs: r.workerMs, bakeMs: r.bakeMs } : null);
    };
    worker.onerror = () => {
      clearTimeout(timer);
      worker.terminate();
      resolve(null);
    };
    const request: TerrainRequest = { saveId };
    worker.postMessage(request);
  });
  cache.set(saveId, promise);
  return promise;
};
