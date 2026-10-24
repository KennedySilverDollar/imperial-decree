// ブラウザで1ゲームを最後まで遊び、主要パネルのスクリーンショットを docs/screenshots/ に保存する。
// 使い方: pnpm build && pnpm preview --port 4173 を起動した状態で  node scripts/screenshots.cjs [URL]
// （Playwright は環境にあるものを使う。プロジェクトの依存には入れていない）

const { chromium } = require("playwright");
const path = require("node:path");
const fs = require("node:fs");

const URL = process.argv[2] ?? "http://localhost:4173/";
const OUT = path.join(__dirname, "..", "docs", "screenshots");
const MAX_TURNS = 60;

// 素朴な勅令の巡回（テンプレートパーサーのモック参謀が読める言い回し）
const DECREES = ["道を造れ", "家を建てよ", "道を大いに造れ", "祭を開け", "井戸を掘れ", "家を建てよ", "税を少し取れ", "役所を建てよ"];

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

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const problems = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));

  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector("[data-testid=stamp]");
  await page.evaluate(() => document.fonts.ready);
  await settle(page, 800);
  await shot(page, "01-desk-start");
  await shot(page, "02-newspaper-first-issue", ".newspaper");
  await shot(page, "03-map-start", ".map-panel");

  // 1年目：タグと意図を付けて、勅令・判子・3段表示を撮る
  await page.selectOption(".tags label:nth-of-type(2) select", "large");
  await playTurn(page, "道を造れ", {
    intent: { param: "infrastructure", value: 5 },
    capture: { decree: "04-decree-input", stamp: "05-stamp", result: "06-result-sheet" },
  });
  await shot(page, "07-aide-reports", ".aide-panel");
  await shot(page, "08-newspaper", ".newspaper");

  // 任命/解任：商人を解任すると候補が並ぶ
  await page.click("[data-testid=aide-youngMerchant] >> text=解任する");
  await page.click("[data-testid=aide-youngMerchant] >> text=本当に解任する");
  await page.waitForSelector(".candidate");
  await settle(page, 400);
  await shot(page, "09-appoint-candidates", ".aide-panel");
  await page.locator(".candidate button").first().click();
  await settle(page, 400);

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
