// 地図を実際のブラウザで描いて撮る（開発用）。scripts/map-states.ts が書いた GameState を map-dev.html に渡す。
// M3：各状態を L0〜L3 で撮る。「見えない値だけを変えた状態」がどの段階でも同じ画素になるか（空洞・進捗が漏れていないか）、
// 地形の生成とベイクの時間、1枚を描く時間も報告する。環境の Playwright を使う。
// 使い方: node scripts/map-browser.mjs <状態の JSON> [出力先=docs/screenshots/m3] [lite]
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { createServer } from "vite";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const [statesFile, outDir = "docs/screenshots/m3", mode] = process.argv.slice(2);
const lite = mode === "lite";
if (!statesFile) throw new Error("usage: node scripts/map-browser.mjs <states.json> [outDir]");
const states = JSON.parse(readFileSync(statesFile, "utf8"));

const server = await createServer({ server: { port: 0, host: "127.0.0.1" }, logLevel: "error" });
await server.listen();
const { port } = server.httpServer.address();
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  page.on("pageerror", (e) => console.error("pageerror", e.message));
  await page.addInitScript((rows) => {
    window.mapStates = rows;
  }, states);
  await page.goto(`http://127.0.0.1:${port}/map-dev.html${lite ? "?lite=1" : ""}`);
  await page.waitForSelector("body[data-done=true]", { timeout: 10 * 60 * 1000 });
  const results = await page.evaluate(() => window.mapResults);
  mkdirSync(outDir, { recursive: true });
  for (const r of results) {
    for (const k of (r.reliefs ?? []).keys()) {
      await page.locator(`#relief-${r.label}-${k}`).screenshot({ path: join(outDir, `relief-${r.label}-${k}${lite ? "-lite" : ""}.png`) });
    }
    for (const l of r.lods ?? []) {
      await page.locator(`#map-${r.label}-L${l.lod}`).screenshot({ path: join(outDir, `map-${r.label}-L${l.lod}${lite ? "-lite" : ""}.png`) });
    }
    console.log(JSON.stringify(r));
  }
} finally {
  await browser.close();
  await server.close();
}
