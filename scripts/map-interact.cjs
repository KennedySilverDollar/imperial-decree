// 手元の地図（v3.4 M3）を本番ビルドで操作して確かめる（開発用）：ホイールのズーム・ドラッグのパンの fps、
// 区画にかざしたときの札（小字と建物名だけ）、区画を選んだときの記録と書き付け、L0〜L3 の見え方を撮る。
// 使い方: npm run build && npm run preview -- --port 4173 を起動した状態で  node scripts/map-interact.cjs [URL] [出力先=docs/screenshots/m3]
// 平面モードで数年遊んだあと、立体の机で地図を手に取って（キー 1）同じ操作をする。環境の Playwright を使う。

const { chromium } = require("playwright");
const path = require("node:path");
const fs = require("node:fs");

const URL = process.argv[2] ?? "http://localhost:4173/";
const OUT = process.argv[3] ?? path.join(__dirname, "..", "docs", "screenshots", "m3");
const SETTINGS_KEY = "imperial-decree/settings";
const settings = (flat) => JSON.stringify({ flat, motion: "system", textSize: "normal", showFps: false });
const DECREES = ["家を建てよ", "畑を開け", "道を造れ", "井戸を掘れ", "家を二つ建てよ", "市場を開け", "倉を建てよ", "役所を建てよ", "畑を開け", "家を建てよ"];

const settle = (page, ms = 400) => page.waitForTimeout(ms);
const waitTerrain = (page) => page.waitForFunction(() => document.querySelector('[data-terrain-ready="true"]'), null, { timeout: 60000 });

async function playFlat(page, text) {
  await page.fill(".decree-text", text);
  if (!(await page.locator("[data-testid=stamp]").isEnabled())) return false;
  await page.click("[data-testid=stamp]");
  await page.waitForSelector("[data-testid=result-sheets]", { timeout: 15000 });
  await settle(page, 300);
  await page.click("[data-testid=close-result]");
  await settle(page, 250);
  return true;
}

/** rAF の時刻を集めて、操作の間の fps と最長フレームを出す */
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

async function canvasBox(page, scope) {
  const box = await page.locator(`${scope} [data-testid=map-canvas] canvas`).first().boundingBox();
  if (!box) throw new Error("map canvas not found");
  return box;
}

/** 2秒かけてドラッグで円を描くようにパン */
async function pan(page, box) {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  const steps = 120;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    await page.mouse.move(cx + Math.cos(a) * 80 - 80, cy + Math.sin(a) * 80);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
}

/** ホイールで寄って、引く */
async function zoom(page, box) {
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  for (let i = 0; i < 50; i++) {
    await page.mouse.wheel(0, -40);
    await page.waitForTimeout(16);
  }
  for (let i = 0; i < 50; i++) {
    await page.mouse.wheel(0, 40);
    await page.waitForTimeout(16);
  }
}

const widthOf = (page, scope) => page.getAttribute(`${scope} .map-panel`, "data-map-width");

/** ズームのボタンで表示の幅を合わせる（＋ で 1/1.6、－ で 1.6 倍） */
async function zoomTo(page, scope, target) {
  for (let i = 0; i < 12; i++) {
    const w = Number(await widthOf(page, scope));
    if (Math.abs(Math.log(w / target)) < Math.log(1.3)) return;
    await page.click(`${scope} .map-controls button:nth-of-type(${w > target ? 1 : 2})`);
    await settle(page, 120);
  }
}

async function exercise(page, scope, prefix, results) {
  const shot = (name) => page.locator(`${scope} .map-panel`).screenshot({ path: path.join(OUT, `${prefix}-${name}.png`) });
  await waitTerrain(page);
  await settle(page, 1800); // 描き込みの演出が終わるまで
  await shot("L1");
  let box = await canvasBox(page, scope);
  results.push(await measure(page, `${prefix}: pan`, () => pan(page, box)));
  await page.click(`${scope} .map-controls button:nth-of-type(3)`);
  results.push(await measure(page, `${prefix}: zoom`, () => zoom(page, box)));
  await page.click(`${scope} .map-controls button:nth-of-type(3)`);
  await settle(page, 200);
  // L2：村の中心に寄って、区画にかざす・選ぶ・書き付ける
  await zoomTo(page, scope, 600);
  await settle(page, 300);
  box = await canvasBox(page, scope);
  // 建物のある区画を探して、かざす
  let hovered = null;
  for (let k = 0; k < 40 && !hovered; k++) {
    const x = box.x + box.width * (0.3 + 0.4 * ((k * 7) % 10) / 10);
    const y = box.y + box.height * (0.3 + 0.4 * Math.floor(k / 4) / 10);
    await page.mouse.move(x, y);
    await settle(page, 80);
    const tip = page.locator(`${scope} [data-testid=map-tooltip]`);
    if ((await tip.count()) > 0) {
      const text = await tip.innerText();
      if (!text.includes("空き地") && !text.includes("本通り")) hovered = { x, y, text };
    }
  }
  results.push({ label: `${prefix}: tooltip`, text: hovered?.text ?? null });
  await shot("L2-hover");
  if (hovered) {
    await page.mouse.click(hovered.x, hovered.y);
    await settle(page, 300);
    const parcel = page.locator(`${scope} [data-testid=map-parcel]`);
    results.push({ label: `${prefix}: parcel`, text: (await parcel.count()) > 0 ? await parcel.innerText() : null });
    if ((await parcel.count()) > 0) {
      await page.fill(`${scope} .map-note-form input`, "ここは水はけが悪いと聞く");
      await page.click(`${scope} .map-note-form button`);
      await settle(page, 300);
      await shot("L2-parcel-note");
      const stored = await page.evaluate(() => localStorage.getItem("imperial-decree/notes"));
      results.push({ label: `${prefix}: notes stored`, value: stored });
      await page.click(`${scope} .map-parcel-head button`);
    }
  }
  await zoomTo(page, scope, 130);
  await settle(page, 300);
  await shot("L3");
  await zoomTo(page, scope, 4000);
  await settle(page, 300);
  await shot("L0");
  results.push({ label: `${prefix}: lite`, value: await page.getAttribute(`${scope} .map-panel`, "data-map-lite") });
  await page.click(`${scope} .map-controls button:nth-of-type(3)`);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const problems = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
  const results = [];

  await page.goto(URL);
  await page.evaluate(({ key, value }) => {
    localStorage.clear();
    localStorage.setItem(key, value);
  }, { key: SETTINGS_KEY, value: settings(true) });
  await page.reload();
  await page.waitForSelector("[data-testid=stamp]");
  await page.evaluate(() => document.fonts.ready);
  const started = Date.now();
  await waitTerrain(page);
  results.push({ label: "terrain ready after load (ms)", value: Date.now() - started });
  for (const d of DECREES) await playFlat(page, d);
  await exercise(page, "", "app-flat", results);

  // 立体の机：地図を手に取る（キー 1）
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: SETTINGS_KEY, value: settings(false) });
  await page.reload();
  await page.waitForSelector("[data-testid=desk]");
  await settle(page, 800);
  results.push(await measure(page, "app-3d: overview idle", () => page.waitForTimeout(1500)));
  await page.keyboard.press("1");
  await settle(page, 900);
  await exercise(page, '.desk-object-map[data-state="focused"]', "app-3d-hand", results);

  for (const r of results) console.log(JSON.stringify(r));
  console.log(JSON.stringify({ problems }));
  await browser.close();
})();
