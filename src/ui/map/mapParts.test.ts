import { ESLint } from "eslint";
import { beforeAll, describe, expect, it } from "vitest";
import { BUILDING_IDS } from "../../domain/Buildings";
import { convexOverlap, planBuilding } from "./BuildingLayout";
import { faceAngleOf, parcelShapesOf } from "./composeMap";
import { GLYPH_BOX, glyphSvg, SVG_GLYPHS } from "./glyphs/buildingGlyphs";
import { generateTerrain } from "./terrain/generateTerrain";
import { pointInPolygon } from "./terrain/geometry";
import type { TerrainDataV2 } from "./terrain/types";

// 地図の部品（GameState を使わないもの）：絵記号17種、17種の建物の配置、ESLint の制限（不変条件26）。

let terrain: TerrainDataV2;

beforeAll(() => {
  const r = generateTerrain("save-parts", { surroundN: 512, villageN: 512, precheckN: 128 });
  if (!r.ok) throw new Error("terrain failed");
  terrain = r.data;
}, 60_000);

describe("建物の絵記号（AA-12）", () => {
  it("17種すべてに SVG のパスがあり、24×24 の枠の中に収まる", () => {
    expect(Object.keys(SVG_GLYPHS).sort()).toEqual([...BUILDING_IDS].sort());
    for (const id of BUILDING_IDS) {
      const d = SVG_GLYPHS[id].path;
      expect(d).toMatch(/^[MLHVZAQ0-9.\s-]+$/);
      // 絶対座標の数値（弧の半径・フラグも含む）は枠の内側
      for (const n of d.match(/-?\d+(\.\d+)?/g) ?? []) {
        expect(Number(n)).toBeGreaterThanOrEqual(0);
        expect(Number(n)).toBeLessThanOrEqual(GLYPH_BOX);
      }
      expect(glyphSvg(id)).toContain(`d="${d}"`);
    }
  });
});

describe("建物の配置（17種、hash(saveId, 建物ID) の決定論）", () => {
  it("17種すべてが、どの区画でも区画の内側に収まり、棟どうしが重ならない", () => {
    const shapes = parcelShapesOf(terrain);
    const F = terrain.village.frame;
    for (const kind of BUILDING_IDS) {
      for (const shape of shapes) {
        const plan = planBuilding("save-parts", { id: shape.gridIndex * 31 + 7, kind, gridIndex: shape.gridIndex }, shape, faceAngleOf(shape.x, shape.y), F);
        // 道路は路面だけ（棟がない）。ほかは棟が少なくとも1つ
        expect(plan.parts.filter((p) => kind === "road" || p.role === "structure").length).toBeGreaterThan(0);
        for (const part of plan.parts) for (const q of part.polygon) expect(pointInPolygon(q, shape.polygon)).toBe(true);
        const structures = plan.parts.filter((p) => p.role === "structure");
        structures.forEach((p, i) => structures.forEach((q, j) => j > i && expect(convexOverlap(p.polygon, q.polygon)).toBe(false)));
      }
    }
  });

  it("同じ saveId・建物ID なら同じ姿、建物ID が違えば姿が変わりうる", () => {
    const shape = parcelShapesOf(terrain)[23]!;
    const F = terrain.village.frame;
    const plan = (id: number) => planBuilding("save-parts", { id, kind: "residential", gridIndex: 23 }, shape, 0, F);
    expect(plan(5)).toEqual(plan(5));
    const variants = new Set(Array.from({ length: 12 }, (_, k) => JSON.stringify(plan(k).parts)));
    expect(variants.size).toBeGreaterThan(1);
  });
});

describe("ESLint の制限（不変条件26・27）", () => {
  const lint = async (filePath: string, code: string) => {
    const eslint = new ESLint();
    const [result] = await eslint.lintText(code, { filePath });
    return (result?.messages ?? []).map((m) => m.ruleId);
  };

  it("src/ui/map/ から GameState・DerivedStats・Construction・Events・Map を import すると違反になる", async () => {
    for (const mod of ["GameState", "DerivedStats", "Construction", "Events", "Map"]) {
      const rules = await lint("src/ui/map/__lint_probe__.ts", `import type { X } from "../../domain/${mod}";\nexport type Y = X;\n`);
      expect(rules).toContain("no-restricted-imports");
    }
    // 地図の外（投影を作る src/ui/game/）なら違反にならない
    expect(await lint("src/ui/game/__lint_probe__.ts", `import type { GameState } from "../../domain/GameState";\nexport type Y = GameState;\n`)).not.toContain(
      "no-restricted-imports",
    );
  }, 60_000);

  it("地形生成（terrain/）で DOM のグローバルを使うと違反になる", async () => {
    expect(await lint("src/ui/map/terrain/__lint_probe__.ts", "export const w = document.title;\n")).toContain("no-restricted-globals");
  }, 60_000);
});
