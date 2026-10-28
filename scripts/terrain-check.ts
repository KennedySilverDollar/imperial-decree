// 地形 v2 の検証（SPEC_v3.4 §12.1、`npm run terrain:check`）。
// saveId = saveIdFor(1..N) の地形を本番の解像度で生成し、validateTerrain で
// 建設可能性・川の条件・街道の到達・地名の一意性を確かめ、再試行回数と生成時間の統計を出す。
// 使い方: npm run terrain:check -- [シード数=1000] [並列数=CPU数]
import { availableParallelism } from "node:os";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";
import { saveIdFor } from "../src/domain/GameState";
import { generateTerrain } from "../src/ui/map/terrain/generateTerrain";
import { hashTerrain } from "../src/ui/map/terrain/hashTerrain";
import { validateTerrain } from "../src/ui/map/terrain/validate";

interface Row {
  readonly seed: number;
  readonly ok: boolean;
  readonly attempts: number;
  readonly failures: readonly string[];
  readonly issues: readonly string[];
  readonly ms: number;
  readonly hash: string;
  readonly fords: number;
  readonly oldChannels: number;
  readonly lakes: number;
  readonly rivers: number;
  readonly from: string;
}

const run = (seed: number): Row => {
  const r = generateTerrain(saveIdFor(seed));
  const base = { seed, attempts: r.attempts, failures: r.failures, ms: r.timings.total ?? 0 };
  if (!r.ok) return { ...base, ok: false, issues: ["generation failed"], hash: "", fords: 0, oldChannels: 0, lakes: 0, rivers: 0, from: "" };
  const issues = validateTerrain(r.data);
  return {
    ...base,
    ok: issues.length === 0,
    issues,
    hash: hashTerrain(r.data),
    fords: r.data.fords.length,
    oldChannels: r.data.oldChannels.length,
    lakes: r.data.lakes.length,
    rivers: r.data.rivers.length,
    from: r.data.highway.from,
  };
};

if (!isMainThread) {
  const { seeds } = workerData as { seeds: number[] };
  parentPort?.postMessage(seeds.map(run));
} else {
  const count = Number(process.argv[2] ?? 1000);
  const workers = Number(process.argv[3] ?? availableParallelism());
  const started = Date.now();
  const jobs = Array.from({ length: workers }, (_, w) => {
    const seeds: number[] = [];
    for (let s = 1 + w; s <= count; s += workers) seeds.push(s);
    return new Promise<Row[]>((resolve, reject) => {
      // Worker の中でも tsx で TypeScript を読めるように、ローダーを登録してからこのファイルを読み込む
      const boot = `import("tsx/esm/api").then(({ register }) => { register(); return import(${JSON.stringify(import.meta.url)}); });`;
      const worker = new Worker(boot, { eval: true, workerData: { seeds } });
      worker.on("message", resolve);
      worker.on("error", reject);
    });
  });
  const rows = (await Promise.all(jobs)).flat().sort((a, b) => a.seed - b.seed);
  const pct = (k: number) => `${((100 * k) / rows.length).toFixed(1)}%`;
  const failed = rows.filter((r) => !r.ok);
  const hist = new Map<number, number>();
  for (const r of rows) hist.set(r.attempts, (hist.get(r.attempts) ?? 0) + 1);
  const reasons = new Map<string, number>();
  for (const r of rows) for (const f of r.failures) reasons.set(f, (reasons.get(f) ?? 0) + 1);
  const ms = rows.map((r) => r.ms).sort((a, b) => a - b);
  const q = (p: number) => Math.round(ms[Math.min(ms.length - 1, Math.floor(ms.length * p))]!);
  const tally = <K>(key: (r: Row) => K) => {
    const m = new Map<K, number>();
    for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]), "en", { numeric: true })).map(([k, v]) => `${String(k)}:${v}`).join(" ");
  };
  console.log(`地形 v2 の検証：${rows.length} シード（saveIdFor(1..${count})）、並列 ${workers}、${((Date.now() - started) / 1000).toFixed(0)} 秒`);
  console.log(`合格 ${rows.length - failed.length}/${rows.length}（${pct(rows.length - failed.length)}）`);
  console.log(`試行回数の分布 ${[...hist.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}:${v}`).join(" ")}  平均 ${(rows.reduce((s, r) => s + r.attempts, 0) / rows.length).toFixed(2)}  最大 ${Math.max(...rows.map((r) => r.attempts))}`);
  console.log(`再試行の理由 ${[...reasons.entries()].map(([k, v]) => `${k}:${v}`).join(" ") || "なし"}`);
  console.log(`生成時間（1シード、ms。Node＋tsx、並列で CPU を共有） p50 ${q(0.5)} p90 ${q(0.9)} p99 ${q(0.99)} 最大 ${q(1)}`);
  console.log(`川の本数 ${tally((r) => r.rivers)}`);
  console.log(`湖の数 ${tally((r) => r.lakes)}  旧河道の数 ${tally((r) => r.oldChannels)}  渡河点の数 ${tally((r) => r.fords)}`);
  console.log(`街道の出発点 ${tally((r) => r.from)}`);
  for (const r of failed.slice(0, 20)) console.log(`  不合格 seed ${r.seed}: ${r.issues.join("; ")}`);
  process.exitCode = failed.length === 0 ? 0 : 1;
}
