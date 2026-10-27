// U4（演出と仕上げ、SPEC_v3.3 §4.5・§4.6・§5.7・§8・§9）の確認。
// ターン遷移シーケンスの各段・地図のインクの描き込み・並べ読み・音量の設定・動きを減らす・性能の自動調整・2種のエンディング・1ゲーム通しを撮り、
// 遷移の合計時間・遷移中の FPS・地形の生成時間を測る。音は Web Audio の呼び出し回数を数えて、実際に鳴らしているかを確かめる。
// 使い方: npm run build && npm run preview -- --port 4173 を起動した状態で  node scripts/screenshots-u4.cjs [URL]
// SCREENSHOT_DIR で保存先を変えられる。SKIP_FULL_GAME=1 で1ゲーム通しを省く。Playwright は環境にあるものを使う。

const { chromium } = require("playwright");
const path = require("node:path");
const fs = require("node:fs");

const BASE = process.argv[2] ?? "http://localhost:4173/";
const OUT = process.env.SCREENSHOT_DIR ?? path.join(__dirname, "..", "docs", "screenshots", "u4");
const SETTINGS_KEY = "imperial-decree/settings";
const SAVE_KEY = "imperial-decree/save";
const settings = (patch = {}) => JSON.stringify({ flat: false, motion: "full", textSize: "normal", showFps: false, ...patch });
const MAX_TURNS = 50;
// 素朴な勅令の巡回（モック参謀のテンプレートパーサーが読める言い回し）
const DECREES = ["道を造れ", "家を建てよ", "畑を開け", "井戸を掘れ", "家を二つ建てよ", "市場を開け", "道を大いに造れ", "倉を建てよ", "役所を建てよ", "見張り塔を建てよ", "家を建てよ", "畑を開け"];
const ORDER = ["stamp", "file", "waiting", "weather", "map", "delivery", "ledger", "ending", "idle"];

const settle = (page, ms = 450) => page.waitForTimeout(ms);
const quiet = (page) => page.waitForFunction(() => document.getAnimations().length === 0, null, { timeout: 5000 }).catch(() => {});
const shot = async (page, name, selector, { still = true } = {}) => {
  if (still) await quiet(page);
  await (selector ? page.locator(selector).first() : page).screenshot({ path: path.join(OUT, `${name}.png`) });
};
const deskAttr = (page, name) => page.evaluate((n) => document.querySelector("[data-testid=desk]")?.getAttribute(n), name);
const waitStep = (page, step) =>
  page.waitForFunction(
    ({ target, order }) => order.indexOf(document.querySelector("[data-testid=desk]")?.getAttribute("data-sequence-step") ?? "") >= order.indexOf(target),
    { target: step, order: ORDER },
    { timeout: 20000 },
  );
const stepMs = (page) => page.evaluate(() => Number(getComputedStyle(document.querySelector("[data-testid=desk]")).getPropertyValue("--seq-ms").replace("ms", "")) || 0);
const waitSurvey = (page) => page.waitForSelector("[data-survey=ready][data-first-ready-ms]", { timeout: 30000 });
const surveyTimes = (page) =>
  page.evaluate(() => {
    const e = document.querySelector("[data-testid=map-canvas]");
    const n = (k) => Number(e.getAttribute(k));
    return { via: e.getAttribute("data-survey-via"), generateMs: n("data-survey-generate-ms"), workerMs: n("data-survey-ms"), baseRenderMs: n("data-survey-render-ms"), firstReadyMs: n("data-first-ready-ms") };
  });

/** Web Audio の呼び出しを数える（音を実際に鳴らしているか） */
const countAudio = () => {
  const counts = { contexts: 0, oscillators: 0, buffers: 0 };
  window.__audioCounts = counts;
  const Ctx = window.AudioContext;
  if (!Ctx) return;
  window.AudioContext = class extends Ctx {
    constructor(...args) {
      super(...args);
      counts.contexts++;
    }
    createOscillator() {
      counts.oscillators++;
      return super.createOscillator();
    }
    createBufferSource() {
      counts.buffers++;
      return super.createBufferSource();
    }
  };
};

async function startFrames(page) {
  await page.evaluate(() => {
    window.__frames = [];
    const tick = (t) => {
      if (window.__frames === null) return;
      window.__frames.push(t);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
async function stopFrames(page, label) {
  const frames = await page.evaluate(() => {
    const f = window.__frames;
    window.__frames = null;
    return f;
  });
  const gaps = frames
    .slice(1)
    .map((t, i) => t - frames[i])
    .sort((a, b) => a - b);
  return { label, fps: Math.round(((frames.length - 1) * 1000) / (frames.at(-1) - frames[0])), p95FrameMs: Math.round(gaps[Math.floor(gaps.length * 0.95)] * 10) / 10, worstFrameMs: Math.round(gaps.at(-1)) };
}

async function openFresh(page, query, patch, save) {
  await page.goto(`${BASE}${query}`);
  await page.evaluate(
    ({ key, value, saveKey, save }) => {
      localStorage.clear();
      localStorage.setItem(key, value);
      if (save) localStorage.setItem(saveKey, save);
    },
    { key: SETTINGS_KEY, value: settings(patch), saveKey: SAVE_KEY, save },
  );
  await page.reload();
  await waitSurvey(page);
  await settle(page, 700);
}

/** 勅令を書いて押印する（立体の机：4 で手に取り、Enter で押す） */
async function stamp(page, text, flat = false) {
  const field = flat ? ".decree-text" : ".desk-object-decree textarea.decree-text";
  if (!flat) {
    await page.keyboard.press("4");
    await settle(page, 420);
  }
  await page.fill(field, text);
  await page.locator(field).press("Enter");
  // 押印で遷移が始まるまで待つ（始まる前の idle を「もう終わった」と取り違えないように）
  await page.waitForFunction(() => document.querySelector("[data-testid=desk]")?.getAttribute("data-sequence-step") !== "idle", null, { timeout: 5000 });
}
const resultInHand = (page, timeout = 20000) => page.waitForSelector('.desk-object-result[data-state="focused"] [data-testid=result-sheets], .flat-object [data-testid=result-sheets]', { timeout });
const ended = async (page) => (await page.locator("[data-testid=ending]").count()) > 0;

async function playTurn(page, text, { skip = false } = {}) {
  await stamp(page, text);
  if (skip) {
    await waitStep(page, "file");
    await page.click("[data-testid=sequence-skip]");
  }
  await resultInHand(page);
  await settle(page, 300);
  await page.keyboard.press("Escape");
  await settle(page, 420);
}

/** セーブを書き換えて、次の年でエンディングになる状態にする */
const stageSave = async (page, patch) =>
  page.evaluate(
    ({ key, patch }) => {
      const state = JSON.parse(localStorage.getItem(key));
      Object.assign(state.params, patch.params);
      if (patch.office && !state.buildings.some((b) => b.kind === "office")) state.buildings.push({ serial: 999, kind: "office", builtTurn: 1, hollow: false, disclosed: false, tile: [4, 4] });
      return JSON.stringify(state);
    },
    { key: SAVE_KEY, patch },
  );

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  await context.addInitScript(countAudio);
  const page = await context.newPage();
  const problems = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
  const check = (cond, message) => cond || problems.push(message);
  const report = { terrain: [], sequence: [], fps: [] };

  // ── 1. 遷移の各段（3倍ゆっくり：?seqscale=3）
  await openFresh(page, "?noadapt&seqscale=3");
  report.terrain.push({ when: "読み込み直後の新しいゲーム", ...(await surveyTimes(page)) });
  await shot(page, "01-desk-before");
  await playTurn(page, "道を造れ", { skip: true });
  await stamp(page, "道を造り家を建てよ");
  const captures = [
    ["stamp", 0.6, "02-seq-stamp"],
    ["file", 0.7, "03-seq-file"],
    ["weather", 0.6, "04-seq-window-light"],
    ["map", 0.3, "05-seq-map-ink-outline"],
    ["map", 0.75, "06-seq-map-ink-symbol"],
    ["delivery", 0.55, "07-seq-delivery"],
    ["ledger", 0.6, "08-seq-ledger"],
  ];
  let lastStep = null;
  let stepStarted = 0;
  for (const [step, fraction, name] of captures) {
    await waitStep(page, step);
    if (lastStep !== step) stepStarted = Date.now();
    lastStep = step;
    const wait = (await stepMs(page)) * fraction - (Date.now() - stepStarted);
    if (wait > 0) await page.waitForTimeout(wait);
    await shot(page, name, null, { still: false });
    if (name === "06-seq-map-ink-symbol") await shot(page, "06b-seq-map-ink-close", ".desk-object-map .survey-frame", { still: false });
  }
  await resultInHand(page);
  await settle(page, 400);
  await shot(page, "09-result-in-hand");
  await page.keyboard.press("Escape");
  await settle(page, 450);
  // 描き込んだ後の地図（今年の線は濃いインク、去年の線は古いインク）
  await page.keyboard.press("1");
  await settle(page, 900);
  await shot(page, "10-map-after-ink", ".desk-object-map .survey-frame");
  await page.keyboard.press("Escape");
  await settle(page, 450);

  // ── 2. 通常の速さ：合計時間と、遷移中の FPS（演出をすべて有効のまま：?noadapt）
  await openFresh(page, "?noadapt");
  for (const text of ["道を造れ", "家を建てよ", "畑を開け"]) {
    await stamp(page, text);
    await startFrames(page);
    await resultInHand(page);
    report.fps.push(await stopFrames(page, `遷移の演出（${text}）`));
    report.sequence.push({ motion: "full", decree: text, totalMs: Number(await deskAttr(page, "data-sequence-total-ms")) });
    await settle(page, 300);
    await page.keyboard.press("Escape");
    await settle(page, 450);
  }
  await settle(page, 1500);
  await startFrames(page);
  await page.waitForTimeout(2000);
  report.fps.push(await stopFrames(page, "俯瞰の机：静止"));
  check(
    report.sequence.every((s) => s.totalMs >= 4000 && s.totalMs <= 6000),
    `sequence total out of 4-6 s: ${report.sequence.map((s) => s.totalMs)}`,
  );

  // ── 3. 並べ読み：新聞を手に取り Tab で地図を半分引き寄せ、地名にかざす
  await page.keyboard.press("2");
  await settle(page, 500);
  check((await page.locator(".desk-object-newspaper [data-testid=map-ref]").count()) === 0, "refs shown before Tab");
  await page.keyboard.press("Tab");
  await settle(page, 700);
  const refs = page.locator(".desk-object-newspaper [data-testid=map-ref]");
  check((await refs.count()) > 0, "side-by-side: no refs after Tab");
  let highlighted = 0;
  for (let i = 0; i < Math.min(await refs.count(), 8) && highlighted === 0; i++) {
    await refs.nth(i).hover();
    await settle(page, 350);
    highlighted = Number((await page.locator("[data-testid=map-canvas]").first().getAttribute("data-highlighted")) ?? 0);
  }
  check(highlighted > 0, "side-by-side: hover did not highlight parcels");
  await shot(page, "11-side-by-side-newspaper", null, { still: false });
  await page.mouse.move(5, 995);
  await page.keyboard.press("Escape");
  await settle(page, 300);
  await page.keyboard.press("Escape");
  await settle(page, 450);
  // 書簡（側近報告）でも
  await page.keyboard.press("3");
  await settle(page, 500);
  await page.keyboard.press("Tab");
  await settle(page, 700);
  const letterRefs = page.locator(".desk-object-letters [data-testid=map-ref]");
  if ((await letterRefs.count()) > 0) {
    await letterRefs.first().hover();
    await settle(page, 350);
    await shot(page, "12-side-by-side-letters", null, { still: false });
  }
  // 側近報告は、建物に触れた行（と区域の名）だけが語になる。年によっては無いので、数だけ記録する
  report.letterRefs = await letterRefs.count();
  await page.mouse.move(5, 995);
  await page.keyboard.press("Escape");
  await settle(page, 300);
  await page.keyboard.press("Escape");
  await settle(page, 450);

  // ── 4. 設定：音量の3系統（主音量・効果音・環境音）
  await page.click("[data-testid=open-settings]");
  await settle(page, 400);
  await shot(page, "13-settings-volumes", "[data-testid=settings]");
  await page.keyboard.press("Escape");
  await settle(page, 300);
  const audio = await page.evaluate(() => window.__audioCounts);
  check(audio.contexts > 0 && audio.oscillators + audio.buffers > 0, `audio: nothing played ${JSON.stringify(audio)}`);
  report.audio = audio;

  // ── 5. 平面モードの並べ読み（地図が常に隣にある）
  await openFresh(page, "?noadapt", { flat: true });
  for (const text of ["家を建てよ", "畑を開け"]) {
    await stamp(page, text, true);
    await startFrames(page);
    await resultInHand(page);
    report.fps.push(await stopFrames(page, `平面：遷移の演出（${text}）`));
    report.sequence.push({ motion: "full", flat: true, decree: text, totalMs: Number(await deskAttr(page, "data-sequence-total-ms")) });
    await settle(page, 300);
    await page.click("[data-testid=close-result]");
    await settle(page, 450);
  }
  const flatRef = page.locator(".newspaper [data-testid=map-ref]");
  let flatHighlighted = 0;
  for (let i = 0; i < Math.min(await flatRef.count(), 8) && flatHighlighted === 0; i++) {
    await flatRef.nth(i).scrollIntoViewIfNeeded();
    await flatRef.nth(i).hover();
    await settle(page, 350);
    flatHighlighted = Number((await page.locator("[data-testid=map-canvas]").first().getAttribute("data-highlighted")) ?? 0);
  }
  check(flatHighlighted > 0, "flat side-by-side: hover did not highlight parcels");
  await shot(page, "14-flat-side-by-side", null, { still: false });

  // ── 6. 動きを減らす：移動は即時、遷移は短く
  await openFresh(page, "?noadapt", { motion: "reduce" });
  await stamp(page, "家を建てよ");
  await waitStep(page, "map");
  await shot(page, "15-reduced-motion-map", null, { still: false });
  await resultInHand(page);
  report.sequence.push({ motion: "reduce", decree: "家を建てよ", totalMs: Number(await deskAttr(page, "data-sequence-total-ms")) });
  await page.keyboard.press("Escape");
  await settle(page, 300);

  // ── 7. 性能の自動調整：CPU を絞って 45fps を下回らせ続けると、視差・ぼかし・環境の微動が止まる
  await openFresh(page, "", {});
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 40 });
  const lowStarted = Date.now();
  await page.keyboard.press("2");
  const lowPower = await page
    .waitForSelector(".desk.low-power", { state: "attached", timeout: 30000 })
    .then(() => true)
    .catch(() => false);
  report.lowPowerAfterMs = lowPower ? Date.now() - lowStarted : null;
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  check(lowPower, "low power was not engaged under CPU throttling");
  await settle(page, 800);
  await shot(page, "16-low-power-in-hand", null, { still: false });
  report.lowPowerBlur = await page.evaluate(() => getComputedStyle(document.querySelector(".focus-backdrop")).backdropFilter);
  await page.keyboard.press("Escape");
  await settle(page, 600);

  // ── 8. エンディング：成功（町の印章）
  await openFresh(page, "?noadapt");
  await playTurn(page, "道を造れ", { skip: true });
  const success = await stageSave(page, { params: { population: 420, infrastructure: 40, happiness: 70, treasury: 2000 }, office: true });
  await openFresh(page, "?noadapt&seqscale=2", {}, success);
  await stamp(page, "家を建てよ");
  await waitStep(page, "ending");
  await page.waitForTimeout((await stepMs(page)) * 0.8);
  await shot(page, "17-ending-seal", null, { still: false });
  check((await page.locator("[data-testid=town-seal]").count()) > 0, "success: no town seal");
  await resultInHand(page);
  await page.keyboard.press("Escape");
  await page.waitForSelector("[data-testid=ending]", { timeout: 10000 });
  await settle(page, 600);
  await shot(page, "18-ending-success-screen");

  // ── 9. エンディング：ゲームオーバー（ランプが消える）
  await openFresh(page, "?noadapt");
  await playTurn(page, "道を造れ", { skip: true });
  const ruin = await stageSave(page, { params: { treasury: -5000 } });
  await openFresh(page, "?noadapt&seqscale=2", {}, ruin);
  await stamp(page, "家を建てよ");
  await waitStep(page, "ending");
  await page.waitForTimeout((await stepMs(page)) * 0.9);
  await shot(page, "19-ending-lamp-out", null, { still: false });
  check(((await deskAttr(page, "class")) ?? "").includes("lamp-out"), "gameover: lamp not out");
  await resultInHand(page);
  await page.keyboard.press("Escape");
  await page.waitForSelector("[data-testid=ending]", { timeout: 10000 });
  await settle(page, 600);
  await shot(page, "20-ending-gameover-screen");

  // ── 10. 1ゲーム通し（立体の机。遷移は飛ばす）
  if (!process.env.SKIP_FULL_GAME) {
    await openFresh(page, "?noadapt");
    let turn = 1;
    while (turn <= MAX_TURNS && !(await ended(page))) {
      await stamp(page, DECREES[(turn - 1) % DECREES.length]);
      await waitStep(page, "file");
      await page.click("[data-testid=sequence-skip]").catch(() => {});
      await resultInHand(page);
      await settle(page, 150);
      await page.keyboard.press("Escape");
      await settle(page, 420);
      if (turn === 20) await shot(page, "21-full-game-year20");
      turn++;
    }
    const endingVisible = await page
      .waitForSelector("[data-testid=ending]", { timeout: 10000 })
      .then(() => true)
      .catch(() => false);
    check(endingVisible, `full game: no ending after ${turn - 1} turns`);
    await settle(page, 600);
    await shot(page, "22-full-game-ending");
    report.fullGame = { turnsPlayed: turn - 1, ending: endingVisible ? (await page.locator("[data-testid=ending]").innerText()).split("\n").slice(0, 2).join(" / ") : null };
  }

  console.log(JSON.stringify({ ...report, problems }, null, 2));
  await browser.close();
  process.exit(problems.length === 0 ? 0 : 1);
})();
