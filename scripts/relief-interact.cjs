// 地形模型（v3.4 M4）を本番ビルドで確かめる（開発用）：立体の机の俯瞰・手に取った模型・回す・傾ける・寄る、の撮影と fps、
// 平面モードに模型が出ないこと、操作中に 45fps を下回り続けたら模型が止まる（布が掛かる）こと。
// 撮影と fps は ?noadapt（机と模型の性能の自動調整を切る）で行い、自動で止まることは通常の設定で別に確かめる。
// 使い方: npm run build && npm run preview -- --port 4173 を起動した状態で  node scripts/relief-interact.cjs [URL] [出力先=docs/screenshots/m4]
// 環境の Playwright を使う。

const { chromium } = require("playwright");
const path = require("node:path");
const fs = require("node:fs");

const URL = process.argv[2] ?? "http://localhost:4173/";
const OUT = process.argv[3] ?? path.join(__dirname, "..", "docs", "screenshots", "m4");
const SETTINGS_KEY = "imperial-decree/settings";
const settings = (flat) => JSON.stringify({ flat, motion: "system", textSize: "normal", showFps: false });
const DECREES = ["家を建てよ", "畑を開け", "道を造れ", "井戸を掘れ", "家を二つ建てよ", "市場を開け", "倉を建てよ", "役所を建てよ", "畑を開け", "見張り塔を建てよ", "家を建てよ", "寺を建てよ"];

const settle = (page, ms = 400) => page.waitForTimeout(ms);

async function playFlat(page, text) {
  await page.fill(".decree-text", text);
  if (!(await page.locator("[data-testid=stamp]").isEnabled())) return;
  await page.click("[data-testid=stamp]");
  await page.waitForSelector("[data-testid=result-sheets]", { timeout: 15000 });
  await settle(page, 250);
  await page.click("[data-testid=close-result]");
  await settle(page, 200);
}

async function measure(page, label, action) {
  await page.evaluate(() => {
    window.__frames = [];
    const tick = (t) => {
      if (window.__frames === null) return;
      window.__frames.push(t);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await action();
  const frames = await page.evaluate(() => {
    const f = window.__frames;
    window.__frames = null;
    return f;
  });
  const gaps = frames.slice(1).map((t, i) => t - frames[i]).sort((a, b) => a - b);
  const span = frames.at(-1) - frames[0];
  return {
    label,
    fps: Math.round(((frames.length - 1) * 1000) / span),
    p95FrameMs: Math.round(gaps[Math.floor(gaps.length * 0.95)] * 10) / 10,
    worstFrameMs: Math.round(gaps.at(-1) * 10) / 10,
  };
}

const reliefState = (page) => page.getAttribute(".relief-panel", "data-relief-state");

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const problems = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
  const results = [];

  // 平面モードで数年遊ぶ（模型は出ない）
  await page.goto(URL);
  await page.evaluate(({ key, value }) => {
    localStorage.clear();
    localStorage.setItem(key, value);
  }, { key: SETTINGS_KEY, value: settings(true) });
  await page.reload();
  await page.waitForSelector("[data-testid=stamp]");
  for (const d of DECREES) await playFlat(page, d);
  await page.waitForFunction(() => document.querySelector('[data-terrain-ready="true"]'), null, { timeout: 60000 });
  results.push({ label: "flat: relief objects", value: await page.locator(".relief-panel").count() });
  await page.keyboard.press("8");
  await settle(page, 300);
  results.push({ label: "flat: key 8 focused", value: await page.locator('[data-state="focused"]').count() });
  await page.screenshot({ path: path.join(OUT, "flat-desk.png") });

  // 立体の机
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: SETTINGS_KEY, value: settings(false) });
  await page.goto(`${URL}?noadapt`);
  await page.waitForSelector("[data-testid=desk]");
  await page.waitForFunction(() => document.querySelector('[data-relief-state="ready"]'), null, { timeout: 60000 });
  await settle(page, 1200);
  await page.screenshot({ path: path.join(OUT, "3d-overview.png") });
  results.push(await measure(page, "3d(noadapt): overview idle", () => page.waitForTimeout(1500)));
  await page.keyboard.press("8");
  await settle(page, 900);
  await page.screenshot({ path: path.join(OUT, "3d-hand-default.png") });
  const canvas = page.locator('.desk-object-relief[data-state="focused"] [data-testid=relief-canvas]');
  const box = await canvas.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  // 撮影：短い操作（自動停止の見張りは 1 秒続いた操作だけを数える）で、回す・傾ける・寄る
  const shortDrag = async (dx, dy) => {
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + dx, cy + dy, { steps: 8 });
    await page.mouse.up();
    await settle(page, 450);
  };
  await shortDrag(140, 0);
  await page.screenshot({ path: path.join(OUT, "3d-hand-rotated.png") });
  await shortDrag(0, -70);
  await page.mouse.move(cx, cy);
  for (let i = 0; i < 8; i++) await page.mouse.wheel(0, -60);
  await settle(page, 450);
  await page.screenshot({ path: path.join(OUT, "3d-hand-low-zoom.png") });
  await page.locator(".relief-controls button").click();
  await settle(page, 450);
  results.push({ label: "3d-hand: state after short drags", value: await reliefState(page) });
  // 計測：1.5 秒続けて回す・寄る（45fps を下回り続けたら模型は自動で止まる）
  results.push(
    await measure(page, "3d-hand(noadapt): rotate (drag 1.5s)", async () => {
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      for (let i = 0; i < 90; i++) {
        await page.mouse.move(cx + i * 2, cy + Math.sin(i / 10) * 20);
        await page.waitForTimeout(16);
      }
      await page.mouse.up();
    }),
  );
  results.push({ label: "3d-hand: state after rotate", value: await reliefState(page) });
  if ((await reliefState(page)) === "ready") {
    results.push(
      await measure(page, "3d-hand(noadapt): zoom (wheel)", async () => {
        await page.mouse.move(cx, cy);
        for (let i = 0; i < 40; i++) {
          await page.mouse.wheel(0, i < 20 ? -30 : 30);
          await page.waitForTimeout(16);
        }
      }),
    );
  }
  results.push({ label: "3d-hand: final state", value: await reliefState(page) });
  await page.screenshot({ path: path.join(OUT, "3d-hand-final.png") });

  // 通常の設定（性能の自動調整あり）：回し続けて 45fps を下回り続けたら模型が止まるか
  await page.goto(URL);
  await page.waitForSelector("[data-testid=desk]");
  await page.waitForFunction(() => document.querySelector('[data-relief-state="ready"]'), null, { timeout: 60000 });
  await settle(page, 800);
  await page.keyboard.press("8");
  await settle(page, 900);
  const box2 = await page.locator('.desk-object-relief[data-state="focused"] [data-testid=relief-canvas]').boundingBox();
  if (box2) {
    results.push(
      await measure(page, "adaptive: rotate (drag 2s)", async () => {
        await page.mouse.move(box2.x + 100, box2.y + 200);
        await page.mouse.down();
        for (let i = 0; i < 120; i++) {
          await page.mouse.move(box2.x + 100 + i * 2, box2.y + 200);
          await page.waitForTimeout(16);
        }
        await page.mouse.up();
      }),
    );
  }
  results.push({ label: "adaptive: state after rotate", value: await reliefState(page) });
  if (box2 && (await reliefState(page)) === "ready") {
    results.push(
      await measure(page, "adaptive: zoom (wheel)", async () => {
        await page.mouse.move(box2.x + 200, box2.y + 200);
        for (let i = 0; i < 40; i++) {
          await page.mouse.wheel(0, i < 20 ? -30 : 30);
          await page.waitForTimeout(16);
        }
      }),
    );
    results.push({ label: "adaptive: state after zoom", value: await reliefState(page) });
  }
  results.push({ label: "adaptive: desk low-power", value: await page.evaluate(() => document.querySelector(".desk")?.classList.contains("low-power") ?? null) });
  await page.screenshot({ path: path.join(OUT, "3d-hand-auto-disabled.png") });

  for (const r of results) console.log(JSON.stringify(r));
  console.log(JSON.stringify({ problems }));
  await browser.close();
})();
