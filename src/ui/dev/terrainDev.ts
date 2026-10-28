import { toWorld } from "../map/terrain/geometry";
import { MAP_COLORS, type Rgb } from "../map/terrain/palette";
import type { TerrainRequest, TerrainResponse } from "../map/terrain/terrain.worker";
import { VILLAGE_CELLS } from "../map/terrain/terrainConstants";
import type { Point, TerrainDataV2 } from "../map/terrain/types";

// 開発用ページ（terrain-dev.html）。地形 v2 を実際のブラウザの Web Worker で生成して所要時間を測り、
// ベイクした地図全体のレイヤ（b0）に川・街道・村域・地名を重ねて表示する。scripts/terrain-browser.mjs が読み取って撮影する。
// ?seeds=save-1,save-2&repeat=3

const query = new URLSearchParams(window.location.search);
const seeds = (query.get("seeds") ?? "save-1,save-2,save-3").split(",");
const repeat = Number(query.get("repeat") ?? "3");
const SIZE = 640;

const rgb = (c: Rgb) => `rgb(${c[0]},${c[1]},${c[2]})`;

const runOnce = (saveId: string): Promise<{ response: TerrainResponse; wallMs: number }> =>
  new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../map/terrain/terrain.worker.ts", import.meta.url), { type: "module" });
    const started = performance.now();
    worker.onmessage = (event: MessageEvent<TerrainResponse>) => {
      const wallMs = performance.now() - started;
      worker.terminate();
      resolve({ response: event.data, wallMs });
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message));
    };
    const request: TerrainRequest = { saveId };
    worker.postMessage(request);
  });

const draw = (ctx: CanvasRenderingContext2D, d: TerrainDataV2, bitmap: ImageBitmap | null) => {
  const s = SIZE / d.worldM;
  const P = (p: Point): [number, number] => [p[0] * s, p[1] * s];
  if (bitmap) ctx.drawImage(bitmap, 0, 0, SIZE, SIZE);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = rgb(MAP_COLORS.roadLine);
  ctx.lineWidth = 2;
  ctx.beginPath();
  d.highway.points.forEach((p, k) => (k === 0 ? ctx.moveTo(...P(p)) : ctx.lineTo(...P(p))));
  ctx.stroke();
  ctx.fillStyle = rgb(MAP_COLORS.vermilion);
  for (const f of d.fords) ctx.fillRect(f[0] * s - 3, f[1] * s - 3, 6, 6);
  const F = d.village.frame;
  const h = F.halfM;
  ctx.strokeStyle = rgb(MAP_COLORS.ink);
  for (let k = 0; k <= VILLAGE_CELLS; k++) {
    const t = -h + (2 * h * k) / VILLAGE_CELLS;
    ctx.lineWidth = k === 0 || k === VILLAGE_CELLS ? 1.5 : 0.4;
    ctx.beginPath();
    ctx.moveTo(...P(toWorld(F, t, -h)));
    ctx.lineTo(...P(toWorld(F, t, h)));
    ctx.moveTo(...P(toWorld(F, -h, t)));
    ctx.lineTo(...P(toWorld(F, h, t)));
    ctx.stroke();
  }
  ctx.font = "12px serif";
  ctx.textAlign = "center";
  for (const t of d.toponyms) {
    if (t.kind === "district") continue;
    const [x, y] = P(t.anchor);
    ctx.fillStyle = "rgba(232,220,192,0.75)";
    const w = ctx.measureText(t.name).width + 6;
    ctx.fillRect(x - w / 2, y - 9, w, 14);
    ctx.fillStyle = rgb(t.kind === "river" || t.kind === "lake" || t.kind === "wetland" ? MAP_COLORS.riverLine : MAP_COLORS.ink);
    ctx.fillText(t.name, x, y + 2);
  }
};

const main = async () => {
  const host = document.getElementById("seeds");
  const log = document.getElementById("log");
  const results: unknown[] = [];
  for (const saveId of seeds) {
    const runs: { wallMs: number; workerMs: number; bakeMs: Record<string, number>; attempts: number; total: number; timings: Record<string, number> }[] = [];
    let last: TerrainResponse | null = null;
    for (let r = 0; r < repeat; r++) {
      const { response, wallMs } = await runOnce(saveId);
      last = response;
      runs.push({ wallMs, workerMs: response.workerMs, bakeMs: { ...response.bakeMs }, attempts: response.attempts, total: response.timings.total ?? 0, timings: { ...response.timings } });
    }
    results.push({ saveId, ok: last?.ok ?? false, runs });
    if (host && last?.ok) {
      const box = document.createElement("div");
      box.className = "seed";
      box.id = `seed-${saveId}`;
      const canvas = document.createElement("canvas");
      canvas.width = SIZE;
      canvas.height = SIZE;
      const ctx = canvas.getContext("2d");
      if (ctx) draw(ctx, last.data, last.layers.find((l) => l.spec.id === "b0")?.bitmap ?? null);
      box.append(canvas);
      host.append(box);
    }
    if (log) log.textContent = JSON.stringify(results, null, 1);
  }
  (window as unknown as { terrainResults: unknown }).terrainResults = results;
  document.body.dataset.done = "true";
};

void main();
