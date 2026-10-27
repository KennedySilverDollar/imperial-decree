// 地形の検査（SPEC_v3.3 §5.2・§13.1 / 不変条件19）：多数の saveId で地形を生成し、
// 「村域の 100 区画がすべて建設可能（水も急傾斜も無い）」と「川・沼が村域に入らない」を確かめる。
// 使い方: npm run terrain:check -- [件数（既定 1000）] [--jobs 並列数（既定 CPU 数）]
// 結果は PASS/FAIL と、何回目の試行で建設可能になったか（再試行の分布）、安全な地形に落ちた件数、生成時間。

import { spawn } from "node:child_process";
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import { saveIdFor } from "../src/domain/GameState";
import { terrainSeed } from "../src/domain/Landscape";
import { deriveSeed } from "../src/domain/Prng";
import { RIVER_GAP, TERRAIN_MAX_ATTEMPTS } from "../src/ui/map/mapConstants";
import { allParcelsBuildable, distanceToVillage, generateTerrain } from "../src/ui/map/TerrainGenerator";

interface Row {
  readonly index: number;
  readonly saveId: string;
  readonly attempts: number;
  readonly buildable: boolean;
  readonly riverClear: boolean;
  readonly lakeClear: boolean;
  readonly lakes: number;
  readonly ms: number;
}

/** 本番の新規ゲームと同じ形の saveId（seed は決まった系列から） */
const saveIdAt = (index: number): string => saveIdFor(deriveSeed(0x7e44a1, index));

const checkOne = (index: number): Row => {
  const saveId = saveIdAt(index);
  const started = performance.now();
  const terrain = generateTerrain(terrainSeed(saveId));
  const ms = performance.now() - started;
  return {
    index,
    saveId,
    attempts: terrain.attempts,
    buildable: allParcelsBuildable(terrain),
    riverClear: terrain.river.every((p) => distanceToVillage(p) >= RIVER_GAP),
    lakeClear: terrain.lakes.every((lake) => lake.every((p) => distanceToVillage(p) >= RIVER_GAP)),
    lakes: terrain.lakes.length,
    ms,
  };
};

const args = process.argv.slice(2);
const rangeAt = args.indexOf("--range");
if (rangeAt >= 0) {
  // 子プロセス：担当の範囲を調べ、1件1行の JSON を出す
  const from = Number(args[rangeAt + 1]);
  const to = Number(args[rangeAt + 2]);
  for (let i = from; i < to; i++) process.stdout.write(`${JSON.stringify(checkOne(i))}\n`);
} else {
  const count = Number(args.find((a) => /^\d+$/.test(a)) ?? 1000);
  const jobsAt = args.indexOf("--jobs");
  const jobs = Math.max(1, jobsAt >= 0 ? Number(args[jobsAt + 1]) : availableParallelism());
  const self = fileURLToPath(import.meta.url);
  const started = performance.now();
  const chunk = Math.ceil(count / jobs);
  const runs = Array.from({ length: jobs }, (_, j) => {
    const from = j * chunk;
    const to = Math.min(count, from + chunk);
    return new Promise<Row[]>((resolve, reject) => {
      if (from >= to) return resolve([]);
      const child = spawn(process.execPath, [...process.execArgv, self, "--range", String(from), String(to)], { stdio: ["ignore", "pipe", "inherit"] });
      let out = "";
      child.stdout.on("data", (d: Buffer) => (out += d.toString()));
      child.on("error", reject);
      child.on("close", (code) => (code === 0 ? resolve(out.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Row)) : reject(new Error(`job ${j} exited ${code}`))));
    });
  });
  const rows = (await Promise.all(runs)).flat().sort((a, b) => a.index - b.index);
  const failures = rows.filter((r) => !r.buildable || !r.riverClear || !r.lakeClear);
  const histogram: Record<string, number> = {};
  for (const r of rows) histogram[r.attempts > TERRAIN_MAX_ATTEMPTS ? "安全な地形" : `${r.attempts}回目`] = (histogram[r.attempts > TERRAIN_MAX_ATTEMPTS ? "安全な地形" : `${r.attempts}回目`] ?? 0) + 1;
  const times = rows.map((r) => r.ms).sort((a, b) => a - b);
  const pct = (p: number) => Math.round(times[Math.min(times.length - 1, Math.floor(times.length * p))] ?? 0);
  console.log(`地形の検査：${rows.length} 件（並列 ${jobs}、${((performance.now() - started) / 1000).toFixed(1)} 秒）`);
  console.log(`  村域100区画が全て建設可能：${rows.filter((r) => r.buildable).length} / ${rows.length}`);
  console.log(`  川が村域に入らない：${rows.filter((r) => r.riverClear).length} / ${rows.length}、沼が村域に入らない：${rows.filter((r) => r.lakeClear).length} / ${rows.length}`);
  console.log(`  建設可能になった試行：${Object.entries(histogram).map(([k, v]) => `${k} ${v}`).join("、")}（上限 ${TERRAIN_MAX_ATTEMPTS} 回）`);
  console.log(`  沼のある地形：${rows.filter((r) => r.lakes > 0).length} 件`);
  console.log(`  生成時間（Node、1件）：中央値 ${pct(0.5)}ms・95% ${pct(0.95)}ms・最大 ${pct(1)}ms`);
  for (const f of failures.slice(0, 10)) console.log(`  不合格：#${f.index} ${f.saveId} ${JSON.stringify(f)}`);
  console.log(failures.length === 0 ? "PASS" : `FAIL（${failures.length} 件）`);
  if (failures.length > 0) process.exit(1);
}
