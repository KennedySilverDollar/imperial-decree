import { describe, expect, it } from "vitest";
import { polygonArea } from "./geometry";
import { gridOf } from "./grid";
import { extractRivers, lakeMask, OUTLET, route } from "./Hydrology";
import { maskToPolygons } from "./MarchingSquares";
import { createRandom, terrainSeed } from "./rng";
import { TOPONYM_COUNTS } from "./terrainConstants";
import { districtOf, generateToponymNames, placeNamesFor } from "./Toponyms";

// 地形の部品の単体テスト（水文・輪郭・地名・乱数）と、地図の描画層の依存関係（不変条件26・27）。

describe("乱数", () => {
  it("seed = hash(saveId, terrain) で、同じ seed から同じ列", () => {
    expect(terrainSeed("save-1")).toBe(terrainSeed("save-1"));
    expect(terrainSeed("save-1")).not.toBe(terrainSeed("save-2"));
    const a = createRandom(42);
    const b = createRandom(42);
    for (let k = 0; k < 10; k++) expect(a()).toBe(b());
  });
});

describe("水文", () => {
  const g = gridOf(64);
  const n = g.n;
  // 右へ下る斜面の中ほどに深さ 30m・半径 6 セルの窪地
  const tilted = () => {
    const H = new Float32Array(n * n);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const r = Math.hypot(i - 32, j - 32);
        H[j * n + i] = (n - i) * 2 + (r < 6 ? -30 * (1 - r / 6) : 0) + Math.abs(j - 32) * 0.5;
      }
    }
    return H;
  };

  it("窪地は水面まで埋まり、流れは外周の出口まで必ずたどれる（水面は下流へ下がる）", () => {
    const H = tilted();
    const r = route(H, g);
    expect(r.level[32 * n + 32]!).toBeGreaterThan(H[32 * n + 32]! + 1);
    for (let i = 0; i < n * n; i++) {
      let cur = i;
      for (let step = 0; step < n * n && r.parent[cur]! >= 0; step++) {
        const p = r.parent[cur]!;
        expect(r.level[p]!).toBeLessThanOrEqual(r.level[cur]! + 1e-4);
        cur = p;
      }
      expect(r.parent[cur]).toBe(OUTLET);
    }
    const total = [...r.acc].filter((_, i) => r.parent[i] === OUTLET).reduce((s, v) => s + v, 0);
    expect(total).toBe(n * n);
  });

  it("深い窪地は湖、川は単調に下る折れ線で外周に出る", () => {
    const H = tilted();
    const r = route(H, g);
    const lakes = lakeMask(H, r, g);
    expect(lakes[32 * n + 32]).toBe(1);
    const rivers = extractRivers(r, g);
    expect(rivers.length).toBeGreaterThan(0);
    const main = rivers[0]!;
    expect(main.main).toBe(true);
    for (let k = 0; k + 1 < main.levels.length; k++) expect(main.levels[k + 1]!).toBeLessThanOrEqual(main.levels[k]! + 1e-6);
  });
});

describe("輪郭（marching squares）", () => {
  const g = gridOf(32);
  it("正方形のマスクは1つの多角形になり、面積がほぼ一致する。穴は埋める", () => {
    const mask = new Uint8Array(32 * 32);
    for (let j = 8; j < 20; j++) for (let i = 10; i < 22; i++) mask[j * 32 + i] = 1;
    mask[14 * 32 + 16] = 0; // 穴
    const polys = maskToPolygons(mask, g, 0.1);
    expect(polys).toHaveLength(1);
    const area = polygonArea(polys[0]!);
    const expected = 12 * 12 * g.cell * g.cell;
    expect(Math.abs(area - expected) / expected).toBeLessThan(0.1);
  });

  it("離れた2つの塊は2つの多角形", () => {
    const mask = new Uint8Array(32 * 32);
    for (let j = 2; j < 6; j++) for (let i = 2; i < 6; i++) mask[j * 32 + i] = 1;
    for (let j = 20; j < 26; j++) for (let i = 20; i < 26; i++) mask[j * 32 + i] = 1;
    expect(maskToPolygons(mask, g)).toHaveLength(2);
  });
});

describe("地名", () => {
  it("saveId だけで決まり、すべて一意（500 シード）", () => {
    for (let k = 0; k < 500; k++) {
      const names = generateToponymNames(`save-${k.toString(36)}`);
      const all = [names.region, ...names.rivers, ...names.mountains, ...names.hills, ...names.lakes, ...names.wetlands, names.pass, names.destination, ...names.districts];
      expect(new Set(all).size).toBe(all.length);
      expect(names.districts).toHaveLength(TOPONYM_COUNTS.districts);
    }
    expect(generateToponymNames("save-1")).toEqual(generateToponymNames("save-1"));
    expect(placeNamesFor("save-1")).toEqual(generateToponymNames("save-1").districts);
  });

  it("小字の番号は 0〜8 をすべて使い、十字の本通りは 0", () => {
    const seen = new Set<number>();
    for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) seen.add(districtOf(x, y));
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    for (let k = 0; k < 10; k++) {
      expect(districtOf(4, k)).toBe(0);
      expect(districtOf(k, 4)).toBe(0);
    }
  });
});

describe("地図の描画層の依存関係（不変条件26・27。ESLint の補い：推移的な import も見る）", () => {
  // src 以下の全ソースを文字列で読み、相対 import をたどる（import type は消えるので数えない）
  const files = import.meta.glob<string>("/src/**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true });
  const normalize = (path: string): string => {
    const out: string[] = [];
    for (const part of path.split("/")) {
      if (part === "..") out.pop();
      else if (part !== "." && part !== "") out.push(part);
    }
    return `/${out.join("/")}`;
  };
  const resolveImport = (from: string, spec: string): string => {
    if (!spec.startsWith(".")) return spec;
    const base = normalize(`${from.slice(0, from.lastIndexOf("/"))}/${spec}`);
    return [".ts", ".tsx", "/index.ts"].map((ext) => base + ext).find((f) => f in files) ?? base;
  };
  const closure = (entry: string): Set<string> => {
    const seen = new Set<string>();
    const stack = [entry];
    while (stack.length > 0) {
      const file = stack.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      const text = files[file];
      if (text === undefined) continue;
      for (const m of text.matchAll(/^import\s+(?!type\b)[^;]*?from\s+"([^"]+)"/gms)) stack.push(resolveImport(file, m[1]!));
    }
    return seen;
  };
  const mapSources = Object.keys(files).filter((f) => f.startsWith("/src/ui/map/") && !/\.test\.tsx?$/.test(f));
  const forbiddenState = /^\/src\/domain\/(GameState|Construction|Events|DerivedStats|Map)\.ts$/;

  it("import をたどれている（地名から Prng と文言に届く。engine の新聞からは GameState に届く）", () => {
    const toponyms = closure("/src/ui/map/terrain/Toponyms.ts");
    expect(toponyms.has("/src/domain/Prng.ts")).toBe(true);
    expect(toponyms.has("/src/i18n/messages.ts")).toBe(true);
    expect([...closure("/src/engine/TurnMachine.ts")].some((f) => forbiddenState.test(f))).toBe(true);
  });

  it("src/ui/map/ のどのファイルからも GameState・Construction・Events・DerivedStats・Map に届かない", () => {
    expect(mapSources.length).toBeGreaterThan(10);
    for (const file of mapSources) {
      const reached = [...closure(file)].filter((f) => forbiddenState.test(f));
      expect({ file, reached }).toEqual({ file, reached: [] });
    }
  });

  it("地形生成（terrain/。Worker を除く）は DOM・Phaser・React・Effect に届かない", () => {
    for (const file of mapSources.filter((f) => f.startsWith("/src/ui/map/terrain/") && !f.endsWith("terrain.worker.ts"))) {
      const reached = [...closure(file)].filter((f) => /^(phaser|react|react-dom|effect)(\/|$)/.test(f));
      expect({ file, reached }).toEqual({ file, reached: [] });
    }
  });
});
