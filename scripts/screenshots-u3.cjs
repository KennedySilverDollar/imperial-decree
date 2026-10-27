// U3（測量図、SPEC_v3.3 §5・§10.2・§11）の確認。新しいゲームを何度か始めて別々の地形を撮り、
// 手元での拡大・かざす・区画の札・区画へのメモ・亀裂印・測量の遅れ・平面モードを撮る。地形の生成時間とフレームレートも測る。
// 使い方: npm run build && npm run preview -- --port 4173 を起動した状態で  node scripts/screenshots-u3.cjs [URL]
// SCREENSHOT_DIR で保存先を変えられる。Playwright は環境にあるものを使う。

const { chromium } = require("playwright");
const path = require("node:path");
const fs = require("node:fs");

const BASE = process.argv[2] ?? "http://localhost:4173/";
const OUT = process.env.SCREENSHOT_DIR ?? path.join(__dirname, "..", "docs", "screenshots", "u3");
const SETTINGS_KEY = "imperial-decree/settings";
const SAVE_KEY = "imperial-decree/save";
const settings = (patch = {}) => JSON.stringify({ flat: false, motion: "system", textSize: "normal", showFps: false, ...patch });
const DECREES = ["道を造れ", "家を建てよ", "畑を開け", "道を大いに造れ", "井戸を掘れ", "市場を開け", "家を二つ建てよ", "倉を建てよ", "道を造れ", "見張り塔を建てよ"];
/** 地図の画素 → 手元の地図（640px 四方、拡大 1 段目）の上の位置 */
const MAP_PX = 2400;
const VIEW = 640;
const parcelCenter = (gx, gy) => ({ x: ((600 + (gx + 0.5) * 120) * VIEW) / MAP_PX, y: ((600 + (gy + 0.5) * 120) * VIEW) / MAP_PX });

const settle = (page, ms = 450) => page.waitForTimeout(ms);
const quiet = (page) => page.waitForFunction(() => document.getAnimations().length === 0, null, { timeout: 5000 }).catch(() => {});
const shot = async (page, name, selector) => {
  await quiet(page);
  await (selector ? page.locator(selector).first() : page).screenshot({ path: path.join(OUT, `${name}.png`) });
};

const surveyTimes = (page) =>
  page.evaluate(() => {
    const e = document.querySelector("[data-testid=map-canvas]");
    const n = (k) => Number(e.getAttribute(k));
    return {
      via: e.getAttribute("data-survey-via"),
      workerMs: n("data-survey-ms"),
      generateMs: n("data-survey-generate-ms"),
      baseRenderMs: n("data-survey-render-ms"),
      overlayMs: n("data-draw-ms"),
      firstReadyMs: n("data-first-ready-ms"),
    };
  });
const waitSurvey = (page) => page.waitForSelector("[data-survey=ready][data-first-ready-ms]", { timeout: 30000 });
const version = (page) => page.evaluate(() => Number(document.querySelector("[data-testid=map-canvas]")?.getAttribute("data-version") ?? 0));

async function measure(page, label, ms, action) {
  await page.evaluate(() => {
    window.__frames = [];
    const tick = (t) => {
      if (window.__frames === null) return;
      window.__frames.push(t);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const started = Date.now();
  if (action) await action();
  const left = ms - (Date.now() - started);
  if (left > 0) await page.waitForTimeout(left);
  const frames = await page.evaluate(() => {
    const f = window.__frames;
    window.__frames = null;
    return f;
  });
  const gaps = frames.slice(1).map((t, i) => t - frames[i]).sort((a, b) => a - b);
  return { label, fps: Math.round(((frames.length - 1) * 1000) / (frames.at(-1) - frames[0])), p95FrameMs: Math.round(gaps[Math.floor(gaps.length * 0.95)] * 10) / 10 };
}

async function playTurn(page, text) {
  await page.keyboard.press("4");
  await settle(page, 420);
  await page.fill(".desk-object-decree textarea.decree-text", text);
  await page.locator(".desk-object-decree textarea.decree-text").press("Enter");
  await page.waitForSelector('.desk-object-result[data-state="focused"] [data-testid=result-sheets]', { timeout: 15000 });
  await settle(page, 400);
  await page.keyboard.press("Escape");
  await settle(page, 420);
}

const liveBox = (page) => page.locator(".desk-object-map .survey-live canvas").boundingBox();

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const problems = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
  const check = (cond, message) => cond || problems.push(message);
  const timings = [];

  // ── 新しいゲーム（読み込み直後）
  await page.goto(`${BASE}?noadapt`);
  await page.evaluate(({ key, value }) => (localStorage.clear(), localStorage.setItem(key, value)), { key: SETTINGS_KEY, value: settings() });
  await page.reload();
  await waitSurvey(page);
  timings.push({ when: "読み込み直後の新しいゲーム", ...(await surveyTimes(page)) });
  await settle(page, 600);
  await shot(page, "01-overview-start");

  // 手元：拡大 1〜3 段、かざす
  await page.keyboard.press("1");
  await settle(page, 900);
  await shot(page, "02-hand-zoom1");
  let box = await liveBox(page);
  const office = parcelCenter(5, 5);
  await page.mouse.move(box.x + office.x, box.y + office.y);
  await settle(page, 300);
  check((await page.locator("[data-testid=parcel-tag]").count()) === 1, "hover: no parcel tag");
  await shot(page, "03-hover-tag");
  await page.mouse.wheel(0, -200);
  await settle(page, 500);
  await shot(page, "04-hand-zoom2", ".desk-object-map .survey-frame");
  await page.mouse.wheel(0, -200);
  await settle(page, 500);
  await shot(page, "05-hand-zoom3", ".desk-object-map .survey-frame");
  const fps = [];
  fps.push(
    await measure(page, "手元の地図：ドラッグで動かす", 3000, async () => {
      await page.mouse.move(box.x + 320, box.y + 320);
      await page.mouse.down();
      for (let i = 0; i < 20; i++) await page.mouse.move(box.x + 320 + (i % 10) * 12 - 60, box.y + 320 + Math.floor(i / 10) * 30, { steps: 2 });
      await page.mouse.up();
    }),
  );
  fps.push(
    await measure(page, "手元の地図：ホイールで拡大・縮小", 3000, async () => {
      for (const dy of [200, 200, -200, -200, 200, 200]) {
        await page.mouse.wheel(0, dy);
        await page.waitForTimeout(350);
      }
    }),
  );
  fps.push(await measure(page, "手元の地図：静止", 2000));
  await page.keyboard.press("Escape");
  await settle(page, 450);

  // ── 年を進める：毎年、区画の変化が描き込まれる
  for (const text of DECREES) {
    const before = await version(page);
    await playTurn(page, text);
    await page.waitForFunction((v) => Number(document.querySelector("[data-testid=map-canvas]")?.getAttribute("data-version")) > v, before, { timeout: 5000 }).catch(() =>
      problems.push(`turn "${text}": map not redrawn`),
    );
  }
  await settle(page, 500);
  await shot(page, "06-overview-year11");
  await page.keyboard.press("1");
  await settle(page, 900);
  await shot(page, "07-hand-year11");
  box = await liveBox(page);
  await page.mouse.move(box.x + office.x, box.y + office.y);
  await page.mouse.wheel(0, -200);
  await settle(page, 500);
  await shot(page, "08-hand-year11-zoom2", ".desk-object-map .survey-frame");

  // 区画を押す → 関係する記事と報告・メモを留める
  await page.mouse.click(box.x + 320, box.y + 320);
  await settle(page, 400);
  check((await page.locator("[data-testid=parcel-sheet]").count()) === 1, "click: no parcel sheet");
  await page.fill("[data-testid=parcel-pin-text]", "ここの家は増えたが井戸が遠い");
  await page.click("[data-testid=parcel-pin]");
  await settle(page, 600);
  await shot(page, "09-parcel-sheet-and-note");
  const pinned = await page.evaluate(() => JSON.parse(localStorage.getItem("imperial-decree/notes") ?? "{}").notes?.filter((n) => n.attachedTo?.kind === "parcel").length ?? 0);
  check(pinned === 1, `parcel note not saved (${pinned})`);
  await page.keyboard.press("Escape");
  await settle(page, 450);
  // メモ帳の留め先にも、選んでいる区画が出る
  await page.keyboard.press("7");
  await settle(page, 500);
  const parcelOption = await page.locator(".desk-object-notepad [data-testid=note-target] option[value^='parcel:']").count();
  check(parcelOption > 0, "notepad: selected parcel not offered as target");
  await page.keyboard.press("Escape");
  await settle(page, 450);

  // 新聞：{place} が地名一覧（区域の名）から埋まる
  await page.keyboard.press("2");
  await settle(page, 500);
  await shot(page, "10-newspaper-places", ".desk-object-newspaper");
  await page.keyboard.press("Escape");
  await settle(page, 450);

  // ── 亀裂印：空洞が側近報告で開示された建物だけ（セーブに開示済みの空洞を差し込む）
  await page.evaluate((key) => {
    const state = JSON.parse(localStorage.getItem(key));
    const target = state.buildings.find((b) => b.tile && b.kind !== "office" && b.kind !== "farm");
    if (target) Object.assign(target, { hollow: true, disclosed: true });
    const hidden = state.buildings.find((b) => b.tile && b !== target && b.kind !== "office" && b.kind !== "farm");
    if (hidden) Object.assign(hidden, { hollow: true, disclosed: false });
    localStorage.setItem(key, JSON.stringify(state));
  }, SAVE_KEY);
  await page.reload();
  await waitSurvey(page);
  await page.keyboard.press("1");
  await settle(page, 900);
  await shot(page, "11-crack-disclosed-only");
  await page.keyboard.press("Escape");
  await settle(page, 450);

  // ── 測量の遅れ（既定は無効の実験フラグ）
  await page.goto(`${BASE}?noadapt&surveydelay`);
  await waitSurvey(page);
  await page.keyboard.press("1");
  await settle(page, 900);
  await shot(page, "12-survey-delay-flag");
  await page.keyboard.press("Escape");
  await settle(page, 450);

  // ── 平面モード
  await page.goto(`${BASE}?noadapt`);
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: SETTINGS_KEY, value: settings({ flat: true }) });
  await page.reload();
  await waitSurvey(page);
  await settle(page, 800);
  await shot(page, "13-flat-map", ".flat-object-map");
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: SETTINGS_KEY, value: settings() });

  // ── 別のシード：新しく始めるたびに別の地形（何もしていない机で、新規ゲームの生成時間を測る）
  await page.reload();
  await waitSurvey(page);
  for (let n = 1; n <= 4; n++) {
    await settle(page, 1500);
    await page.click("text=新しく始める");
    await page.click(".confirm .button.danger");
    await page.waitForFunction(() => document.querySelector("[data-testid=map-canvas]")?.getAttribute("data-survey") === "loading", null, { timeout: 5000 }).catch(() => {});
    await waitSurvey(page);
    timings.push({ when: `新しく始める ${n}`, ...(await surveyTimes(page)) });
    await page.keyboard.press("1");
    await settle(page, 900);
    await shot(page, `${13 + n}-seed-${n}`, ".desk-object-map .survey-frame");
    await page.keyboard.press("Escape");
    await settle(page, 450);
  }

  const log = await page.evaluate(() => JSON.parse(localStorage.getItem("imperial-decree/log") ?? "[]"));
  const notesLogged = log.filter((e) => e.event === "note.created").map((e) => e.data.attachedTo);
  console.log(JSON.stringify({ timings, fps, notesLogged, problems }, null, 2));
  await browser.close();
  if (problems.length > 0) process.exit(1);
})();
