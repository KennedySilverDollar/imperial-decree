import { terrainSeed } from "../../domain/Landscape";
import { renderBase } from "./BaseRenderer";
import { MAP_PX } from "./mapConstants";
import type { Ctx2D } from "./pictograms";
import { generateTerrain, type TerrainData } from "./TerrainGenerator";
import type { TerrainRequest, TerrainResponse } from "./terrain.worker";

// 地形の読み込み（SPEC_v3.3 §2.2・§11.2）。saveId ごとに一度だけ作って覚えておく（セーブには seed だけ：ロード時に作り直す）。
// Worker＋OffscreenCanvas が使えればそこで作り、使えなければ本体で同じ関数を呼ぶ（遅いが同じ結果）。
// Canvas 自体が無い環境（jsdom のテスト）では作らない（地図の文字の部分だけで動く）。

export interface SurveyBase {
  readonly saveId: string;
  readonly terrain: TerrainData;
  /** 生成時のレイヤ 1〜6 を描いた画像（MAP_PX 四方） */
  readonly base: CanvasImageSource;
  readonly via: "worker" | "main";
  /** 生成・描画・合計（ミリ秒）。合計は依頼してから受け取るまで（Worker の起動と受け渡しを含む） */
  readonly generateMs: number;
  readonly renderMs: number;
  readonly totalMs: number;
  /** 描画の段ごとの時間（計測用） */
  readonly phases: Readonly<Record<string, number>>;
}

/** Canvas が描ける環境か（jsdom は getContext が無く、呼ぶとエラーを出すので名前で避ける） */
export const canvasAvailable = (): boolean =>
  typeof document !== "undefined" && typeof navigator !== "undefined" && !/jsdom/i.test(navigator.userAgent) && typeof Path2D !== "undefined";

const workerAvailable = (): boolean => typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined";

const cache = new Map<string, Promise<SurveyBase | null>>();
let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, (response: TerrainResponse) => void>();

const getWorker = (): Worker => {
  if (worker) return worker;
  worker = new Worker(new URL("./terrain.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (event: MessageEvent<TerrainResponse>) => {
    const resolve = pending.get(event.data.id);
    pending.delete(event.data.id);
    resolve?.(event.data);
  };
  return worker;
};

const viaWorker = (saveId: string): Promise<SurveyBase> =>
  new Promise((resolve, reject) => {
    const started = performance.now();
    const id = nextId++;
    pending.set(id, (response) => {
      if (!response.ok) return reject(new Error(response.error));
      resolve({
        saveId,
        terrain: response.terrain,
        base: response.base,
        via: "worker",
        generateMs: response.generateMs,
        renderMs: response.renderMs,
        phases: { ...response.phases, delivered: Date.now() - (response.phases.sentAt ?? Date.now()) },
        totalMs: performance.now() - started,
      });
    });
    const request: TerrainRequest = { id, saveId, sentAt: Date.now() };
    getWorker().postMessage(request);
  });

const onMainThread = (saveId: string): SurveyBase | null => {
  const started = performance.now();
  const terrain = generateTerrain(terrainSeed(saveId));
  const generated = performance.now();
  const canvas = document.createElement("canvas");
  canvas.width = MAP_PX;
  canvas.height = MAP_PX;
  const ctx = canvas.getContext("2d") as Ctx2D | null;
  if (ctx === null) return null;
  const phases = renderBase(ctx, terrain, (w, h) => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
  });
  const done = performance.now();
  return { saveId, terrain, base: canvas, via: "main", generateMs: generated - started, renderMs: done - generated, totalMs: done - started, phases };
};

/** Worker を先に起こしておく（起動に数百ミリ秒かかるため、アプリの読み込みと重ねる） */
export const prewarmSurveyWorker = (): void => {
  if (canvasAvailable() && workerAvailable()) getWorker();
};

/** 地形を読み込む（同じ saveId は覚えたものを返す）。描けない環境では null */
export const loadSurvey = (saveId: string): Promise<SurveyBase | null> => {
  const hit = cache.get(saveId);
  if (hit) return hit;
  const made: Promise<SurveyBase | null> = !canvasAvailable()
    ? Promise.resolve(null)
    : workerAvailable()
      ? viaWorker(saveId).catch(() => onMainThread(saveId))
      : new Promise((resolve) => setTimeout(() => resolve(onMainThread(saveId)), 0));
  cache.set(saveId, made);
  // 古いゲームの地形は捨てる（新しく始めたら前の地図は要らない）
  for (const key of cache.keys()) if (key !== saveId && cache.size > 2) cache.delete(key);
  return made;
};
