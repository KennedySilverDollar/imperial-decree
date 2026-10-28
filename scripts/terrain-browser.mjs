// 地形 v2 を実際のブラウザ（Chromium）の Web Worker で生成し、所要時間を測って下塗り＋注記のプレビューを撮る（開発用）。
// Vite の開発サーバーを起動して terrain-dev.html を開く。環境の Playwright を使う。
// 使い方: node scripts/terrain-browser.mjs [出力先=docs/screenshots/m1] [saveId,...] [繰り返し=3]
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { createServer } from "vite";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const outDir = process.argv[2] ?? "docs/screenshots/m1";
const seeds = process.argv[3] ?? "save-1,save-2,save-3,save-4,save-5,save-6";
const repeat = Number(process.argv[4] ?? 3);

const server = await createServer({ server: { port: 0, host: "127.0.0.1" }, logLevel: "error" });
await server.listen();
const address = server.httpServer.address();
const url = `http://127.0.0.1:${address.port}/terrain-dev.html?seeds=${seeds}&repeat=${repeat}`;
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on("pageerror", (e) => console.error("pageerror", e.message));
  await page.goto(url);
  await page.waitForSelector("body[data-done=true]", { timeout: 15 * 60 * 1000 });
  const results = await page.evaluate(() => window.terrainResults);
  const ua = await page.evaluate(() => `${navigator.userAgent} / cores ${navigator.hardwareConcurrency}`);
  mkdirSync(outDir, { recursive: true });
  for (const { saveId } of results) {
    const el = page.locator(`#seed-${saveId}`);
    if ((await el.count()) > 0) await el.screenshot({ path: join(outDir, `browser-${saveId}.png`) });
  }
  console.log(ua);
  const all = [];
  for (const r of results) {
    const walls = r.runs.map((x) => x.wallMs);
    all.push(...walls);
    const med = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    const stage = Object.fromEntries(Object.keys(r.runs[0].timings).map((k) => [k, Math.round(med(r.runs.map((x) => x.timings[k] ?? 0)))]));
    console.log(`${r.saveId} ok=${r.ok} 試行=${r.runs[0].attempts} 往復(中央値)=${Math.round(med(walls))}ms Worker内=${Math.round(med(r.runs.map((x) => x.workerMs)))}ms 段階=${JSON.stringify(stage)}`);
  }
  all.sort((a, b) => a - b);
  console.log(`往復の全体：中央値 ${Math.round(all[Math.floor(all.length / 2)])}ms  最大 ${Math.round(all[all.length - 1])}ms  （${all.length} 回）`);
} finally {
  await browser.close();
  await server.close();
}
