// U1（執務机の骨格、SPEC_v3.3 §2〜§4・§9）の確認。立体の机で1ゲームを最後まで遊び、
// 俯瞰・手元・平面モードのスクリーンショットを docs/screenshots/u1/ に保存し、場面ごとのフレームレートを測る。
// 使い方: npm run build && npm run preview -- --port 4173 を起動した状態で  node scripts/screenshots-u1.cjs [URL]
// SCREENSHOT_DIR で保存先を変えられる。Playwright は環境にあるものを使う。

const { chromium } = require("playwright");
const path = require("node:path");
const fs = require("node:fs");

const BASE = process.argv[2] ?? "http://localhost:4173/";
const OUT = process.env.SCREENSHOT_DIR ?? path.join(__dirname, "..", "docs", "screenshots", "u1");
const MAX_TURNS = 60;
const SETTINGS_KEY = "imperial-decree/settings";
const settings = (patch = {}) => JSON.stringify({ flat: false, motion: "system", textSize: "normal", showFps: false, ...patch });

const DECREES = [
  "道を造れ",
  "家を建てよ",
  "畑を開け",
  "道を大いに造れ",
  "井戸を掘れ",
  "家を二つ建てよ",
  "祭を開け",
  "市場を開け",
  "倉を建てよ",
  "役所を建てよ",
  "見張り塔を建てよ",
  "税を少し取れ",
];

const settle = (page, ms = 450) => page.waitForTimeout(ms);
/** 動き（transition）が終わってから撮る。ソフトウェア描画ではフレームが遅く、撮ると途中の色や位置が写るため */
const shot = async (page, name) => {
  // 地図の地形（Worker で生成）が出来上がるまで待つ（v3.4 M2）
  await page.waitForFunction(() => !document.querySelector('[data-terrain-ready="false"]'), null, { timeout: 30000 });
  await page.waitForFunction(() => document.getAnimations().length === 0, null, { timeout: 5000 }).catch(() => {});
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
};
const stateOf = (page, id) => page.getAttribute(`[data-object="${id}"]`, "data-state");

/** 場面のフレームレート：rAF の時刻を集め、平均・95 パーセンタイルのフレーム時間・最長フレームを出す */
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
  const span = frames.at(-1) - frames[0];
  return {
    label,
    fps: Math.round(((frames.length - 1) * 1000) / span),
    p95FrameMs: Math.round(gaps[Math.floor(gaps.length * 0.95)] * 10) / 10,
    worstFrameMs: Math.round(gaps.at(-1) * 10) / 10,
  };
}

/** 勅令を1年分：用紙を手に取り、書き、Enter で判を押し、届いた結果の束を置く */
async function playTurn(page, text, capture) {
  await page.keyboard.press("4");
  await settle(page, 420);
  await page.fill(".desk-object-decree textarea.decree-text", text);
  if (capture) await shot(page, capture.decree);
  if (!(await page.locator("[data-testid=stamp]").isEnabled())) return false;
  await page.locator(".desk-object-decree textarea.decree-text").press("Enter");
  if (capture) {
    await settle(page, 500);
    await shot(page, capture.stamp);
  }
  await page.waitForSelector('.desk-object-result[data-state="focused"] [data-testid=result-sheets]', { timeout: 15000 });
  await settle(page, 450);
  if (capture) {
    await shot(page, capture.result);
    await page.keyboard.press("ArrowRight");
    await settle(page, 500);
    await shot(page, `${capture.result}-2`);
  }
  await page.keyboard.press("Escape");
  await settle(page, 420);
  return true;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const problems = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));

  // 計測中は性能の自動調整を止める（?noadapt）。描画の環境を記録する
  await page.goto(`${BASE}?noadapt`);
  await page.evaluate(
    ({ key, value }) => {
      localStorage.clear();
      localStorage.setItem(key, value);
    },
    { key: SETTINGS_KEY, value: settings() },
  );
  await page.reload();
  await page.waitForSelector("[data-testid=desk-stage]");
  await page.evaluate(() => document.fonts.ready);
  await settle(page, 1200);
  const renderer = await page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl");
    const ext = gl && gl.getExtension("WEBGL_debug_renderer_info");
    return { renderer: gl ? gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) : "no webgl", userAgent: navigator.userAgent };
  });

  await shot(page, "01-overview-start");
  await page.hover('[data-object="newspaper"]');
  await settle(page, 500);
  await shot(page, "02-overview-hover");
  await page.mouse.move(5, 300);

  // 1年目：手元の勅令用紙・押印・結果の束
  await playTurn(page, "道を造れ", { decree: "03-hand-decree", stamp: "04-stamp", result: "05-hand-result" });

  // 2〜7年目
  let turn = 2;
  for (; turn <= 7; turn++) await playTurn(page, DECREES[turn % DECREES.length]);

  // 中盤：俯瞰と、各書類を手に取ったところ
  await settle(page, 600);
  await shot(page, "06-overview-midgame");
  for (const [key, name] of [["2", "07-hand-newspaper"], ["3", "09-hand-letters"], ["5", "10-hand-ledger"], ["1", "11-hand-map"]]) {
    await page.keyboard.press(key);
    await settle(page, 500);
    await shot(page, name);
    if (key === "2") {
      await page.keyboard.press("Tab");
      await settle(page, 500);
      await shot(page, "08-side-by-side");
      await page.keyboard.press("Tab");
      await settle(page, 400);
    }
    await page.keyboard.press("Escape");
    await settle(page, 450);
  }

  // フレームレート（演出をすべて有効にしたまま）
  const fps = [];
  fps.push(await measure(page, "3d: 俯瞰・静止", 3000));
  fps.push(
    await measure(page, "3d: 俯瞰・マウスを動かす（視差）", 3000, async () => {
      for (let i = 0; i < 30; i++) await page.mouse.move(200 + i * 35, 200 + (i % 10) * 45, { steps: 2 });
    }),
  );
  fps.push(
    await measure(page, "3d: 物にかざす（持ち上がる）", 3000, async () => {
      for (const id of ["newspaper", "map", "letters", "decree", "ledger", "result"]) {
        await page.hover(`[data-object="${id}"]`);
        await page.waitForTimeout(300);
      }
    }),
  );
  fps.push(
    await measure(page, "3d: 手に取る⇄置く（0.35秒の遷移）", 4000, async () => {
      for (const key of ["2", "Escape", "3", "Escape", "4", "Escape", "5", "Escape"]) {
        await page.keyboard.press(key);
        await page.waitForTimeout(420);
      }
    }),
  );
  await page.keyboard.press("2");
  await settle(page, 500);
  fps.push(await measure(page, "3d: 手元で新聞を読む・静止", 3000));
  fps.push(
    await measure(page, "3d: 手元で新聞をスクロール", 3000, async () => {
      await page.mouse.move(720, 400);
      for (let i = 0; i < 12; i++) {
        await page.mouse.wheel(0, i < 6 ? 120 : -120);
        await page.waitForTimeout(180);
      }
    }),
  );
  await page.keyboard.press("Escape");
  await settle(page, 450);

  // 設定：文字サイズ（特大）を手元で確かめ、平面モードを撮る
  await page.click("[data-testid=open-settings]");
  await settle(page, 400);
  await shot(page, "12-settings");
  await page.click("[data-testid=setting-text-xlarge]");
  await page.click("[data-testid=close-settings]");
  await page.keyboard.press("2");
  await settle(page, 500);
  await shot(page, "13-hand-newspaper-xlarge");
  await page.keyboard.press("Escape");
  await page.click("[data-testid=open-settings]");
  await page.click("[data-testid=setting-text-normal]");
  await page.click("[data-testid=setting-flat]");
  await page.click("[data-testid=close-settings]");
  await page.waitForSelector("[data-testid=flat-desk]");
  await settle(page, 700);
  await shot(page, "14-flat-mode");
  fps.push(await measure(page, "平面: 静止", 3000));
  fps.push(
    await measure(page, "平面: ページをスクロール", 3000, async () => {
      for (let i = 0; i < 12; i++) {
        await page.mouse.wheel(0, i < 6 ? 150 : -150);
        await page.waitForTimeout(180);
      }
    }),
  );
  await page.click("[data-testid=open-settings]");
  await page.click("[data-testid=setting-flat]");
  await page.click("[data-testid=close-settings]");
  await page.waitForSelector("[data-testid=desk-stage]");
  await settle(page, 600);

  // 性能の自動調整あり（既定）：45fps を 3 秒下回ると視差・ぼかし・照明の重ねを止める。
  // マウスを動かし続けて（視差で重くして）発動させ、発動後の同じ場面を測る
  await page.goto(BASE);
  await page.waitForSelector("[data-testid=desk-stage]");
  await settle(page, 2500);
  for (let i = 0; i < 160 && !(await page.evaluate(() => document.querySelector("[data-testid=desk]")?.classList.contains("low-power"))); i++) {
    await page.mouse.move(200 + (i % 30) * 35, 200 + (i % 10) * 45, { steps: 2 });
  }
  const lowPower = await page.evaluate(() => document.querySelector("[data-testid=desk]")?.classList.contains("low-power") ?? false);
  const tag = lowPower ? "3d・自動調整で軽量化中" : "3d・自動調整が発動せず";
  fps.push(await measure(page, `${tag}: 俯瞰・静止`, 3000));
  fps.push(
    await measure(page, `${tag}: 俯瞰・マウスを動かす`, 3000, async () => {
      for (let i = 0; i < 30; i++) await page.mouse.move(200 + i * 35, 200 + (i % 10) * 45, { steps: 2 });
    }),
  );
  fps.push(
    await measure(page, `${tag}: 物にかざす`, 3000, async () => {
      for (const id of ["newspaper", "map", "letters", "decree", "ledger", "result"]) {
        await page.hover(`[data-object="${id}"]`);
        await page.waitForTimeout(300);
      }
    }),
  );
  fps.push(
    await measure(page, `${tag}: 手に取る⇄置く`, 4000, async () => {
      for (const key of ["2", "Escape", "3", "Escape", "4", "Escape", "5", "Escape"]) {
        await page.keyboard.press(key);
        await page.waitForTimeout(420);
      }
    }),
  );
  await page.keyboard.press("2");
  await settle(page, 500);
  fps.push(await measure(page, `${tag}: 手元で新聞を読む・静止`, 3000));
  await page.keyboard.press("Escape");
  await settle(page, 450);

  // 残りを最後まで遊ぶ（立体の机のまま）
  for (; turn <= MAX_TURNS && (await page.locator("[data-testid=ending]").count()) === 0; turn++) {
    const played = await playTurn(page, DECREES[turn % DECREES.length]);
    if (!played) {
      problems.push(`turn ${turn}: stamp disabled (${await page.locator(".decree-status").first().innerText()})`);
      await page.keyboard.press("Escape");
      break;
    }
  }
  const ended = (await page.locator("[data-testid=ending]").count()) > 0;
  if (ended) {
    await page.mouse.move(5, 300);
    await settle(page, 600);
    await shot(page, "15-ending");
  }
  const endingText = ended ? await page.locator("[data-testid=ending]").innerText() : null;
  const log = await page.evaluate(() => JSON.parse(localStorage.getItem("imperial-decree/log") ?? "[]"));
  const counts = {};
  for (const entry of log) counts[entry.event] = (counts[entry.event] ?? 0) + 1;

  console.log(JSON.stringify({ environment: renderer, turnsPlayed: turn - 1, ended, endingText, logCounts: counts, fps, problems }, null, 2));
  await browser.close();
  if (!ended || problems.length > 0) process.exit(1);
})();
