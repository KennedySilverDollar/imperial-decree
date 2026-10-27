// ブラウザで1ゲームを最後まで遊び、主要パネルのスクリーンショットを docs/screenshots/ に保存する。
// 使い方: npm run build && npm run preview -- --port 4173 を起動した状態で  node scripts/screenshots.cjs [URL]
// （Playwright は環境にあるものを使う。プロジェクトの依存には入れていない）
// 平面モード（SPEC_v3.3 §9）で遊ぶ。立体の机の確認は scripts/screenshots-u1.cjs。
// SCREENSHOT_DIR を指定すると、そのディレクトリに保存する（docs/screenshots/ を上書きせずに通しで遊べるか確かめるとき）。

const { chromium } = require("playwright");
const path = require("node:path");
const fs = require("node:fs");

const URL = process.argv[2] ?? "http://localhost:4173/";
const OUT = process.env.SCREENSHOT_DIR ?? path.join(__dirname, "..", "docs", "screenshots");
const MAX_TURNS = 60;

// 素朴な勅令の巡回（テンプレートパーサーのモック参謀が読める言い回し。20種のうち序盤に効くもの）
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
const SAVE_KEY = "imperial-decree/save";
const LOG_KEY = "imperial-decree/log";
const SETTINGS_KEY = "imperial-decree/settings";
const FLAT_SETTINGS = JSON.stringify({ flat: true, motion: "system", textSize: "normal", showFps: false });

const shot = (page, name, selector) =>
  (selector ? page.locator(selector).first() : page).screenshot({ path: path.join(OUT, `${name}.png`) });

const settle = (page, ms = 500) => page.waitForTimeout(ms);

async function playTurn(page, text, { intent, capture } = {}) {
  await page.fill(".decree-text", text);
  if (intent) {
    await page.selectOption(".intent-margin select >> nth=0", intent.param);
    await page.fill(".intent-value", String(intent.value));
  }
  if (capture) await shot(page, capture.decree, ".decree-panel");
  await page.click("[data-testid=stamp]");
  if (capture) {
    await settle(page, 450);
    await shot(page, capture.stamp, ".decree-panel");
  }
  await page.waitForSelector("[data-testid=result-sheets]", { timeout: 15000 });
  await settle(page, 600);
  if (capture) {
    const sheets = await page.locator(".sheet").count();
    for (let i = 0; i < sheets; i++) {
      await shot(page, `${capture.result}-${i + 1}`, ".result-stack");
      if (i < sheets - 1) {
        await page.click("[data-testid=flip]");
        await settle(page, 550);
      }
    }
  }
  await page.click("[data-testid=close-result]");
  await settle(page, 300);
}

/** 側近の書簡の封蝋を割って開く（U2：未読の書簡は封をしてある） */
async function openLetters(page) {
  const seals = page.locator("[data-testid^=open-letter-]:enabled");
  while ((await seals.count()) > 0) {
    await seals.first().click();
    await settle(page, 150);
  }
}

/** 新聞の二面（投書・治安・広告・天候）へめくる。二面が無ければ何もしない */
async function toSecondPage(page) {
  const next = page.locator("[data-testid=newspaper-next]");
  if ((await next.count()) > 0 && (await next.isEnabled())) {
    await next.click();
    await settle(page, 200);
  }
}

/** 新聞を読む（閲覧時間の計測）。投書があれば少しとどまる（投書欄の参照の計測） */
async function readNewspaper(page) {
  if ((await page.locator("[data-testid=ending]").count()) > 0) return;
  await page.hover(".newspaper .newspaper-masthead");
  await settle(page, 300);
  await toSecondPage(page);
  const letter = page.locator("[data-testid=news-letter]");
  if ((await letter.count()) > 0) {
    await letter.first().hover();
    await settle(page, 1400);
  }
  await page.mouse.move(5, 5);
}

/**
 * 三角測量の場面を作る（v3.2 §1.8）：今年完成する倉庫の普請を、資材の手抜きつきでセーブに差し込み、1年進める。
 * 空洞になり、投書が載り、能力の高い側近が言及する年が出るまで、セーブ ID と乱数の状態を変えて試す。
 */
async function stageTriangulation(page) {
  const snapshot = await page.evaluate((key) => localStorage.getItem(key), SAVE_KEY);
  for (let attempt = 1; attempt <= 40; attempt++) {
    await page.evaluate(
      ({ key, snapshot, attempt }) => {
        const state = JSON.parse(snapshot);
        const occupied = new Set(state.buildings.filter((b) => b.tile).map((b) => b.tile.join(",")));
        for (const p of state.projects) for (const t of p.tiles) occupied.add(t.join(","));
        const tile = [[0, 9], [9, 0], [0, 0], [9, 9], [1, 8]].find((t) => !occupied.has(t.join(",")));
        const work = 50;
        state.projects.push({
          id: state.nextProjectId,
          kind: "granary",
          count: 1,
          repair: false,
          repairSerials: [],
          tiles: [tile],
          orderedTurn: Math.max(1, state.turn - 2),
          work,
          wood: 25,
          stone: 10,
          minTurns: 2,
          progress: work,
          elapsed: 2,
          worstOverload: 0,
          worstShortage: 1,
          waterDown: false,
        });
        state.nextProjectId += 1;
        state.saveId = `${state.saveId}-t${attempt}`;
        state.rngState = (state.rngState + attempt * 7919) >>> 0;
        localStorage.setItem(key, JSON.stringify(state));
      },
      { key: SAVE_KEY, snapshot, attempt },
    );
    await page.reload();
    await page.waitForSelector("[data-testid=stamp]");
    await settle(page, 400);
    await playTurn(page, "井戸を掘れ");
    await openLetters(page);
    await toSecondPage(page);
    const letter = await page.locator("[data-testid=news-letter]").allInnerTexts();
    const reports = await page.locator(".aide-panel").innerText();
    if (letter.some((t) => t.includes("倉庫")) && reports.includes("倉庫のうち1棟は、見かけ倒し")) return attempt;
  }
  return null;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const problems = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));

  await page.goto(URL);
  await page.evaluate(
    ({ key, value }) => {
      localStorage.clear();
      localStorage.setItem(key, value);
    },
    { key: SETTINGS_KEY, value: FLAT_SETTINGS },
  );
  await page.reload();
  await page.waitForSelector("[data-testid=stamp]");
  await page.evaluate(() => document.fonts.ready);
  await settle(page, 800);
  await shot(page, "01-desk-start");
  await shot(page, "02-newspaper-first-issue", ".newspaper");
  await shot(page, "03-map-start", ".map-panel");

  await shot(page, "13-ledger", "[data-testid=ledger]");

  // 1年目：タグ（規模・期限・優先度）と意図を付けて、勅令・判子・3段表示を撮る
  await page.selectOption(".tags label:nth-of-type(2) select", "large");
  await page.selectOption(".tags label:nth-of-type(3) select", "thisYear");
  await page.selectOption(".tags label:nth-of-type(4) select", "high");
  await playTurn(page, "道を造れ", {
    intent: { param: "infrastructure", value: 5 },
    capture: { decree: "04-decree-input", stamp: "05-stamp", result: "06-result-sheet" },
  });
  await openLetters(page);
  await shot(page, "07-aide-reports", ".aide-panel");
  await shot(page, "08-newspaper", ".newspaper");
  await readNewspaper(page);

  // 残りを最後まで遊ぶ
  let turn = 2;
  while (turn <= MAX_TURNS && (await page.locator("[data-testid=ending]").count()) === 0) {
    const text = DECREES[turn % DECREES.length];
    await page.fill(".decree-text", text);
    if (!(await page.locator("[data-testid=stamp]").isEnabled())) {
      problems.push(`turn ${turn}: stamp disabled (${await page.locator(".decree-status").innerText()})`);
      break;
    }
    await playTurn(page, text);
    await readNewspaper(page);
    if (turn === 8) {
      // 三角測量の場面（倉庫が空洞：投書が匂わせ、能力の高い側近が言及、地図は普通の倉庫）
      const attempt = await stageTriangulation(page);
      if (attempt === null) problems.push("triangulation: not staged");
      else {
        await shot(page, "14-triangulation-desk");
        await shot(page, "15-triangulation-newspaper", ".newspaper");
        await shot(page, "16-triangulation-aides", ".aide-panel");
        await shot(page, "17-triangulation-map", ".map-panel");
      }
      turn++;
    }
    if (turn === 10) {
      await openLetters(page);
      // 任命/解任：商人を解任すると候補が並ぶ（三角測量の場面で能力の高い商人が要るので、その後に行う）
      await page.click("[data-testid=aide-youngMerchant] >> text=解任する");
      await page.click("[data-testid=aide-youngMerchant] >> text=本当に解任する");
      await page.waitForSelector(".candidate");
      await settle(page, 400);
      await shot(page, "09-appoint-candidates", ".aide-panel");
      await page.locator(".candidate button").first().click();
      await settle(page, 400);
    }
    if (turn === 12) {
      await shot(page, "10-desk-midgame");
      await shot(page, "11-map-midgame", ".map-panel");
    }
    turn++;
  }

  if ((await page.locator("[data-testid=ending]").count()) === 0) {
    await shot(page, "debug-stuck");
    console.log(JSON.stringify({ stuckAtTurn: turn, problems }, null, 2));
    await browser.close();
    process.exit(1);
  }
  await settle(page, 600);
  await shot(page, "12-ending");
  const endingText = await page.locator("[data-testid=ending]").innerText();

  // ログ（KPI）が溜まっているか
  const log = await page.evaluate(() => JSON.parse(localStorage.getItem("imperial-decree/log") ?? "[]"));
  const counts = {};
  for (const entry of log) counts[entry.event] = (counts[entry.event] ?? 0) + 1;

  // リスタート
  await page.click("[data-testid=restart]");
  await page.waitForSelector("[data-testid=stamp]");
  await settle(page, 500);
  const yearAfterRestart = await page.locator("[data-testid=year]").innerText();

  console.log(JSON.stringify({ turnsPlayed: turn - 1, endingText, yearAfterRestart, logCounts: counts, problems }, null, 2));
  await browser.close();
})();
