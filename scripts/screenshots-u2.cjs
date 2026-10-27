// U2（書類の作り込み、SPEC_v3.3 §3.2・§4.2〜§4.4・§6・§7・§8.3）の確認。
// 立体の机と平面モードのそれぞれで「勅令を書いて判を押し、結果の束をめくって読み、台帳と既決箱で過去を確かめ、メモを留める」を通し、
// スクリーンショットを docs/screenshots/u2/ に保存する。あわせて書類の操作中のフレームレートと、初回読み込みの転送量（書体を含む）を測る。
// 使い方: npm run build && npm run preview -- --port 4173 を起動した状態で  node scripts/screenshots-u2.cjs [URL]
// SCREENSHOT_DIR で保存先を変えられる。Playwright は環境にあるものを使う。

const { chromium } = require("playwright");
const path = require("node:path");
const fs = require("node:fs");

const BASE = process.argv[2] ?? "http://localhost:4173/";
const OUT = process.env.SCREENSHOT_DIR ?? path.join(__dirname, "..", "docs", "screenshots", "u2");
const SETTINGS_KEY = "imperial-decree/settings";
const settings = (patch = {}) => JSON.stringify({ flat: false, motion: "system", textSize: "normal", showFps: false, ...patch });

const DECREES = ["家を建てよ", "畑を開け", "井戸を掘れ", "市場を開け", "倉を建てよ"];

const settle = (page, ms = 450) => page.waitForTimeout(ms);
/** 動き（transition）が終わってから撮る */
const quiet = (page) => page.waitForFunction(() => document.getAnimations().length === 0, null, { timeout: 5000 }).catch(() => {});
const shot = async (page, name, selector) => {
  await quiet(page);
  await (selector ? page.locator(selector).first() : page).screenshot({ path: path.join(OUT, `${name}.png`) });
};

/** 場面のフレームレート（screenshots-u1.cjs と同じ測り方） */
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

/** 初回読み込みの転送量：CDP で各応答の転送バイト数を足す。書体は種類ごとに分けて数える */
async function measureLoad(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  const urls = new Map();
  const bytes = new Map();
  cdp.on("Network.responseReceived", (e) => urls.set(e.requestId, e.response.url));
  cdp.on("Network.loadingFinished", (e) => bytes.set(e.requestId, e.encodedDataLength));
  const total = () => {
    const by = { total: 0, fonts: 0, fontFiles: 0, byFamily: {} };
    for (const [id, n] of bytes) {
      const url = urls.get(id) ?? "";
      by.total += n;
      if (url.endsWith(".woff2")) {
        by.fonts += n;
        by.fontFiles += 1;
        const family = path.basename(url).replace(/-\d+-400-normal.*|-400-normal.*|-\d+-\d+-normal.*/, "").replace(/-[\w]{8}\.woff2$/, "");
        by.byFamily[family] = (by.byFamily[family] ?? 0) + n;
      }
    }
    const kb = (n) => Math.round(n / 1024);
    return {
      totalKB: kb(by.total),
      fontsKB: kb(by.fonts),
      fontFiles: by.fontFiles,
      byFamilyKB: Object.fromEntries(Object.entries(by.byFamily).map(([k, v]) => [k, kb(v)])),
    };
  };
  await page.goto(BASE);
  await page.evaluate((key) => localStorage.setItem(key, JSON.stringify({ flat: false, motion: "system", textSize: "normal", showFps: false })), SETTINGS_KEY);
  bytes.clear();
  urls.clear();
  await page.reload();
  await page.waitForSelector("[data-testid=desk-stage]");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(2500);
  const initial = total();
  // 書類をひととおり手に取ると、画面に出た文字の範囲の書体が追加で読み込まれる
  for (const key of ["2", "Escape", "3", "Escape", "4", "Escape", "5", "Escape", "7", "Escape", "8", "Escape"]) {
    await page.keyboard.press(key);
    await page.waitForTimeout(450);
  }
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1000);
  const afterDocuments = total();
  await context.close();
  return { initial, afterDocuments };
}

const inHand = (id) => `.desk-object-${id}[data-state="focused"]`;

/** 立体の机で1年分：用紙を手に取り、書き、判を押し、届いた結果の束を置く */
async function playTurn3d(page, text) {
  await page.keyboard.press("4");
  await settle(page, 420);
  await page.fill(".desk-object-decree textarea.decree-text", text);
  await page.locator(".desk-object-decree textarea.decree-text").press("Enter");
  await page.waitForSelector(`${inHand("result")} [data-testid=result-sheets]`, { timeout: 15000 });
  await settle(page, 450);
  await page.keyboard.press("Escape");
  await settle(page, 420);
}

/** 結果の束をドラッグで1枚めくる（左へ引く） */
async function dragFlip(page, scope) {
  const box = await page.locator(`${scope} [data-testid=result-sheets]`).boundingBox();
  const x = box.x + box.width * 0.7;
  const y = box.y + box.height * 0.5;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 60, y, { steps: 4 });
  await page.mouse.move(x - 140, y, { steps: 4 });
  await page.mouse.up();
  await settle(page, 600);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const problems = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
  const check = (cond, message) => {
    if (!cond) problems.push(message);
  };

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
  await shot(page, "01-overview-start");

  // ── 1年目：勅令用紙（付箋・筆・意図の鉛筆書き・朱の残り文字数）
  const fps = [];
  await page.keyboard.press("4");
  await settle(page, 450);
  const decree = ".desk-object-decree";
  await page.selectOption(`${decree} .tags label:nth-of-type(2) select`, "large");
  await page.selectOption(`${decree} .tags label:nth-of-type(3) select`, "thisYear");
  await page.fill(`${decree} textarea.decree-text`, "道を造り、村の東と西を結べ");
  await page.selectOption(`${decree} .intent-margin select >> nth=0`, "infrastructure");
  await page.fill(`${decree} .intent-value`, "5");
  await settle(page, 300);
  await shot(page, "02-hand-decree");
  await shot(page, "03-decree-sheet-closeup", `${decree} .decree-sheet`);

  // 超過：判子は光らず、持ち上がらない
  await page.fill(`${decree} textarea.decree-text`, "道を造り、村の東と西を結び、川沿いに石を敷き、橋のたもとまで延ばせ");
  await settle(page, 300);
  check(!(await page.locator("[data-testid=stamp]").isEnabled()), "over limit: stamp still enabled");
  await shot(page, "04-decree-over-limit");
  await page.fill(`${decree} textarea.decree-text`, "道を造り、村の東と西を結べ");
  await settle(page, 200);
  check(await page.locator("[data-testid=stamp]").isEnabled(), "within limit: stamp disabled");

  // 押印：持ち上げ→朱肉→押印（1.2秒）。途中を2枚撮る
  await page.click("[data-testid=stamp]");
  await page.waitForTimeout(380);
  await page.screenshot({ path: path.join(OUT, "05-stamp-inkpad.png") });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, "06-stamp-press.png") });

  // 結果の束：クリックとドラッグで1枚ずつめくる
  await page.waitForSelector(`${inHand("result")} [data-testid=result-sheets]`, { timeout: 15000 });
  await settle(page, 600);
  const sheets = await page.locator(`${inHand("result")} .sheet`).count();
  check(sheets === 4, `result: expected 4 sheets with intent, got ${sheets}`);
  await shot(page, "07-result-1-interpretation");
  await page.click(`${inHand("result")} [data-testid=flip]`);
  await settle(page, 600);
  await shot(page, "08-result-2-correction");
  await dragFlip(page, inHand("result"));
  await shot(page, "09-result-3-actual");
  await page.keyboard.press("ArrowRight");
  await settle(page, 600);
  await shot(page, "10-result-4-intent");
  await page.keyboard.press("Escape");
  await settle(page, 450);

  // 側近の書簡：未読は封蝋。封を割って開く
  await page.keyboard.press("3");
  await settle(page, 500);
  await shot(page, "11-letters-sealed");
  const seals = page.locator(`${inHand("letters")} [data-testid^=open-letter-]`);
  const sealCount = await seals.count();
  check(sealCount > 0, "letters: no sealed letter");
  await seals.first().click();
  await settle(page, 600);
  await shot(page, "12-letters-one-open");
  while ((await seals.count()) > 0) {
    await seals.first().click();
    await settle(page, 300);
  }
  await page.keyboard.press("Escape");
  await settle(page, 450);
  await shot(page, "13-overview-letters-read");

  // 新聞：一面と二面
  await page.keyboard.press("2");
  await settle(page, 500);
  await shot(page, "14-newspaper-page1");
  await page.keyboard.press("ArrowRight");
  await settle(page, 500);
  await shot(page, "15-newspaper-page2");
  await page.keyboard.press("Escape");
  await settle(page, 450);

  // 2〜6年目
  for (const text of DECREES) await playTurn3d(page, text);

  // 台帳：最新の年と、めくって過去の年
  await page.keyboard.press("5");
  await settle(page, 500);
  await shot(page, "16-ledger-latest");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await settle(page, 500);
  await shot(page, "17-ledger-past-year");
  fps.push(
    await measure(page, "3d: 台帳をめくる", 3000, async () => {
      for (let i = 0; i < 6; i++) {
        await page.keyboard.press(i < 3 ? "ArrowLeft" : "ArrowRight");
        await page.waitForTimeout(400);
      }
    }),
  );
  await page.keyboard.press("Escape");
  await settle(page, 450);

  // メモ：記事に留める。もう1枚は書簡に留める
  await page.keyboard.press("7");
  await settle(page, 500);
  const notepad = inHand("notepad");
  await page.fill(`${notepad} textarea.note-text`, "道の記事は代官の報告と食い違う。来年もう一度確かめる");
  const articleOption = await page.locator(`${notepad} [data-testid=note-target] option[value^="article:"]`).first().getAttribute("value");
  await page.selectOption(`${notepad} [data-testid=note-target]`, articleOption);
  await settle(page, 200);
  await shot(page, "18-notepad-writing");
  await page.click(`${notepad} [data-testid=tear-note]`);
  await settle(page, 300);
  await page.fill(`${notepad} textarea.note-text`, "商人の書簡は数字が丸すぎる");
  const aideOption = await page.locator(`${notepad} [data-testid=note-target] option[value$=":youngMerchant"]`).first().getAttribute("value");
  await page.selectOption(`${notepad} [data-testid=note-target]`, aideOption);
  await page.click(`${notepad} [data-testid=tear-note]`);
  await settle(page, 300);
  await shot(page, "19-notepad-torn");
  await page.keyboard.press("Escape");
  await settle(page, 450);
  await page.keyboard.press("2");
  await settle(page, 500);
  check((await page.locator(`${inHand("newspaper")} [data-testid=pinned-note]`).count()) > 0, "newspaper: pinned note not shown");
  await shot(page, "20-newspaper-pinned-note");
  fps.push(
    await measure(page, "3d: 新聞の面をめくる", 3000, async () => {
      for (let i = 0; i < 6; i++) {
        await page.keyboard.press(i % 2 === 0 ? "ArrowRight" : "ArrowLeft");
        await page.waitForTimeout(400);
      }
    }),
  );
  await page.keyboard.press("Escape");
  await settle(page, 450);
  await page.keyboard.press("3");
  await settle(page, 500);
  await shot(page, "21-letters-pinned-note");
  await page.keyboard.press("Escape");
  await settle(page, 450);

  // 既決箱：過去の年の結果の束・新聞・書簡
  await page.keyboard.press("8");
  await settle(page, 500);
  const archive = inHand("archive");
  await page.click(`${archive} [data-testid=archive-year-1]`);
  await page.click(`${archive} [data-testid=archive-doc-result]`);
  await settle(page, 400);
  await shot(page, "22-archive-result-year1");
  await page.click(`${archive} [data-testid=archive-doc-newspaper]`);
  await settle(page, 400);
  await shot(page, "23-archive-newspaper-year1");
  await page.click(`${archive} [data-testid=archive-year-3]`);
  await page.click(`${archive} [data-testid=archive-doc-letters]`);
  await settle(page, 400);
  await shot(page, "24-archive-letters-year3");
  // 側近が補正した年（朱の訂正線と「訂」の印）を既決箱から探して撮る
  await page.click(`${archive} [data-testid=archive-doc-result]`);
  let corrected = null;
  for (const button of await page.locator(`${archive} [data-testid^=archive-year-]`).all()) {
    await button.click();
    await settle(page, 200);
    await page.locator(`${archive} .sheet-controls .button`).nth(1).click();
    await settle(page, 400);
    if ((await page.locator(`${archive} .sheet-current .correction-mark`).count()) > 0) {
      corrected = await button.innerText();
      break;
    }
  }
  if (corrected !== null) await shot(page, "24b-archive-correction");
  await page.keyboard.press("Escape");
  await settle(page, 450);
  await page.mouse.move(5, 300);
  await shot(page, "25-overview-u2");

  // フレームレート：俯瞰・押印・結果の束をめくる
  fps.push(await measure(page, "3d: 俯瞰・静止（書類が増えた机）", 3000));
  fps.push(
    await measure(page, "3d: 物にかざす（メモ帳・既決箱を含む）", 3000, async () => {
      for (const id of ["newspaper", "letters", "decree", "ledger", "result", "notepad", "archive"]) {
        await page.hover(`[data-object="${id}"]`);
        await page.waitForTimeout(300);
      }
    }),
  );
  await page.keyboard.press("4");
  await settle(page, 450);
  await page.fill(`${decree} textarea.decree-text`, "見張り塔を建てよ");
  fps.push(
    await measure(page, "3d: 押印（1.2秒）と結果の束が届く", 3500, async () => {
      await page.click("[data-testid=stamp]");
    }),
  );
  await page.waitForSelector(`${inHand("result")} [data-testid=result-sheets]`, { timeout: 15000 });
  await settle(page, 450);
  fps.push(
    await measure(page, "3d: 結果の束をめくる", 3000, async () => {
      for (let i = 0; i < 2; i++) {
        await page.keyboard.press("ArrowRight");
        await page.waitForTimeout(600);
      }
      await dragFlip(page, inHand("result"));
    }),
  );
  await page.keyboard.press("Escape");
  await settle(page, 450);

  // 再読み込み：メモが残る
  await page.reload();
  await page.waitForSelector("[data-testid=desk-stage]");
  await settle(page, 800);
  await page.keyboard.press("7");
  await settle(page, 500);
  const notesAfterReload = await page.locator(`${inHand("notepad")} [data-testid=torn-note]`).count();
  check(notesAfterReload === 2, `notes after reload: expected 2, got ${notesAfterReload}`);
  await page.keyboard.press("Escape");
  await settle(page, 450);

  // ── 平面モード：同じ一連
  await page.click("[data-testid=open-settings]");
  await page.click("[data-testid=setting-flat]");
  await page.click("[data-testid=close-settings]");
  await page.waitForSelector("[data-testid=flat-desk]");
  await settle(page, 700);
  await shot(page, "26-flat-desk");
  await page.fill(".decree-text", "税を少し取れ");
  await page.selectOption(".tags label:nth-of-type(2) select", "small");
  await settle(page, 200);
  await shot(page, "27-flat-decree", ".decree-panel");
  await page.click("[data-testid=stamp]");
  await page.waitForSelector("[data-testid=result-sheets]", { timeout: 15000 });
  await settle(page, 600);
  await shot(page, "28-flat-result-1", ".result-stack");
  await page.click("[data-testid=flip]");
  await settle(page, 500);
  await shot(page, "29-flat-result-2", ".result-stack");
  await page.click("[data-testid=close-result]");
  await settle(page, 300);
  await shot(page, "30-flat-letters-sealed", ".aide-panel");
  for (let s = page.locator("[data-testid^=open-letter-]:enabled"); (await s.count()) > 0; ) {
    await s.first().click();
    await settle(page, 200);
  }
  await shot(page, "31-flat-letters-open", ".aide-panel");
  await page.click("[data-testid=newspaper-next]");
  await settle(page, 300);
  await shot(page, "32-flat-newspaper-page2", "[data-testid=newspaper]");
  await page.locator("[data-testid=ledger] button").first().click();
  await settle(page, 300);
  await shot(page, "33-flat-ledger-past", "[data-testid=ledger]");
  await page.fill(".notepad textarea.note-text", "税の年。幸福度の下がり方を見る");
  await page.click("[data-testid=tear-note]");
  await settle(page, 300);
  await shot(page, "34-flat-notepad", "[data-testid=notepad]");
  await page.click("[data-testid=archive-year-2]");
  await page.click("[data-testid=archive-doc-result]");
  await settle(page, 400);
  await shot(page, "35-flat-archive", "[data-testid=archive]");
  fps.push(await measure(page, "平面: 静止", 3000));
  fps.push(
    await measure(page, "平面: ページをスクロール", 3000, async () => {
      for (let i = 0; i < 12; i++) {
        await page.mouse.wheel(0, i < 6 ? 200 : -200);
        await page.waitForTimeout(180);
      }
    }),
  );

  const log = await page.evaluate(() => JSON.parse(localStorage.getItem("imperial-decree/log") ?? "[]"));
  const counts = {};
  for (const entry of log) counts[entry.event] = (counts[entry.event] ?? 0) + 1;
  const handled = log.filter((e) => e.event === "desk.handled");
  const dwellByObject = {};
  for (const e of handled) dwellByObject[e.data.object] = (dwellByObject[e.data.object] ?? 0) + e.data.dwellMs;
  const notesLogged = log.filter((e) => e.event === "note.created" || e.event === "note.attached").map((e) => `${e.event}:${e.data.attachedTo}`);

  const load = await measureLoad(browser);
  console.log(JSON.stringify({ correctedYear: corrected, logCounts: counts, dwellMsByObject: dwellByObject, notesLogged, fps, load, problems }, null, 2));
  await browser.close();
  if (problems.length > 0) process.exit(1);
})();
