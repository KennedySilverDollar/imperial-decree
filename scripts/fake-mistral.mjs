// ローカル試験用の「偽 Mistral」（chat/completions 互換の最小実装）。本物の LLM ではない。
// Mistral に接続できない環境で、プロキシ（wrangler dev）と画面の結線や障害時の挙動を確かめるためだけに使う。
// 使い方: node scripts/fake-mistral.mjs [port]   （.dev.vars に MISTRAL_BASE_URL=http://127.0.0.1:8788）
//   FAKE_MISTRAL_REJECT_SCHEMA=1 で json_schema を 422 で拒否し、プロキシの JSON モードへのフォールバックを試せる

import http from "node:http";

const port = Number(process.argv[2] ?? 8788);
const rejectSchema = process.env.FAKE_MISTRAL_REJECT_SCHEMA === "1";

const KEYWORDS = [
  ["役所", "build", "office"],
  ["市場", "build", "market"],
  ["井戸", "build", "well"],
  ["家", "build", "residential"],
  ["住", "build", "residential"],
  ["道", "build", "road"],
  ["税", "tax", "tax"],
  ["祭", "invest", "welfare"],
  ["福祉", "invest", "welfare"],
  ["治安", "reform", "security"],
  ["汚職", "reform", "security"],
];

const translate = (decree) => {
  const hit = KEYWORDS.find(([word]) => decree.includes(word));
  if (!hit) return { action: "build", target: "road", magnitude: 0, budget: 0, confidence: 0.1 };
  const [, action, target] = hit;
  const magnitude = /大|多く/.test(decree) ? 80 : /少し|小/.test(decree) ? 25 : 50;
  return { action, target, magnitude: /減|軽/.test(decree) ? -magnitude : magnitude, budget: 0, confidence: 0.8 };
};

http
  .createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const body = JSON.parse(raw || "{}");
      const mode = body.response_format?.type;
      console.log(`[fake-mistral] ${req.method} ${req.url} mode=${mode} auth=${req.headers.authorization ? "yes" : "no"}`);
      if (rejectSchema && mode === "json_schema") {
        res.writeHead(422, { "Content-Type": "application/json" }).end(JSON.stringify({ message: "json_schema not supported (fake)" }));
        return;
      }
      const user = JSON.parse(body.messages?.[1]?.content ?? "{}");
      const content = JSON.stringify(translate(String(user.decree ?? "")));
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ choices: [{ message: { content } }] }));
    });
  })
  .listen(port, "127.0.0.1", () => console.log(`[fake-mistral] listening on http://127.0.0.1:${port}`));
