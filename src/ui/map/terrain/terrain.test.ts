import { beforeAll, describe, expect, it } from "vitest";
import { generateTerrain, type TerrainOptions } from "./generateTerrain";
import { pointInPolygon, pointSegmentDistance, polygonClearance, polylineClearance, toLocal } from "./geometry";
import { hashTerrain } from "./hashTerrain";
import { armEndPoint } from "./Highway";
import {
  HYDROLOGY,
  PARCEL_SLOPE_MAX_DEG,
  RIVER_CLEARANCE_M,
  SURROUND_N,
  VILLAGE_CELLS,
  VILLAGE_N,
  WATER_CLEARANCE_M,
} from "./terrainConstants";
import type { TerrainDataV2, TerrainResult } from "./types";
import { validateTerrain } from "./validate";
import { VEGETATION_CLASS } from "./Vegetation";

// 地形 v2（SPEC_v3.4 §12.1）。本番の解像度は1シードで決定論と条件を確かめ、
// 条件の網羅は小さい解像度（512²）の複数シードで確かめる（条件は解像度に依存しない。1000シードは npm run terrain:check）。

const SMALL: TerrainOptions = { surroundN: 512, villageN: 512, precheckN: 128 };
const SMALL_IDS = ["save-1", "save-2", "save-3", "save-a", "save-b", "save-c"];

const okData = (r: TerrainResult): TerrainDataV2 => {
  if (!r.ok) throw new Error(`generation failed: ${r.failures.join(",")}`);
  return r.data;
};

const small = new Map<string, TerrainResult>();
let production: TerrainResult;
let productionAgain: TerrainResult;

beforeAll(() => {
  for (const id of SMALL_IDS) small.set(id, generateTerrain(id, SMALL));
  production = generateTerrain("save-1");
  productionAgain = generateTerrain("save-1");
}, 120_000);

const each = (fn: (d: TerrainDataV2, id: string) => void) => {
  for (const id of SMALL_IDS) fn(okData(small.get(id)!), id);
  fn(okData(production), "save-1@production");
};

describe("決定論", () => {
  it("同じ saveId から同じ TerrainDataV2（ハッシュが一致）。本番の解像度", () => {
    expect(hashTerrain(okData(production))).toBe(hashTerrain(okData(productionAgain)));
    expect(okData(production).surround.size).toBe(SURROUND_N);
    expect(okData(production).village.size).toBe(VILLAGE_N);
  });

  it("同じ saveId なら小さい解像度でも同じ、違う saveId なら違う", () => {
    expect(hashTerrain(okData(generateTerrain("save-2", SMALL)))).toBe(hashTerrain(okData(small.get("save-2")!)));
    const hashes = SMALL_IDS.map((id) => hashTerrain(okData(small.get(id)!)));
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it("再試行の記録が試行回数と合い、上限を超えたら ok: false（同じ結果）", () => {
    for (const id of SMALL_IDS) {
      const r = small.get(id)!;
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.data.attempt).toBe(r.attempts - 1);
        expect(r.failures).toHaveLength(r.attempts - 1);
      }
    }
    const none = generateTerrain("save-1", { ...SMALL, maxAttempts: 0 });
    expect(none.ok).toBe(false);
    expect(none.attempts).toBe(0);
  });
});

describe("村域100区画が建設可能（§3.2）", () => {
  it("100区画すべて傾斜 ≤ 5°（区画内の平均。BB-13）で、gridIndex がセルと1対1", () => {
    each((d) => {
      expect(d.parcels).toHaveLength(VILLAGE_CELLS * VILLAGE_CELLS);
      d.parcels.forEach((p, k) => {
        expect(p.gridIndex).toBe(k);
        expect(p.slope).toBeLessThanOrEqual(PARCEL_SLOPE_MAX_DEG);
      });
    });
  });

  it("100区画すべて水域でない（川・湖・湿地・旧河道が村域から離れ、水のセルもない）", () => {
    each((d) => {
      const F = d.village.frame;
      for (const r of d.rivers) expect(polylineClearance(F, r.points, r.widths.map((w) => w / 2))).toBeGreaterThanOrEqual(RIVER_CLEARANCE_M);
      for (const poly of [...d.lakes, ...d.wetlands, ...d.oldChannels]) expect(polygonClearance(F, poly)).toBeGreaterThanOrEqual(WATER_CLEARANCE_M);
      for (const p of d.parcels) {
        for (const q of p.polygon) {
          for (const lake of d.lakes) expect(pointInPolygon(q, lake)).toBe(false);
        }
      }
      const n = d.surround.size;
      const cell = d.worldM / n;
      let inside = 0;
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const [a, b] = toLocal(F, [(i + 0.5) * cell, (j + 0.5) * cell]);
          if (Math.max(Math.abs(a), Math.abs(b)) < F.halfM && d.vegetation[j * n + i] === VEGETATION_CLASS.water) inside++;
        }
      }
      expect(inside).toBe(0);
    });
  });
});

describe("水文（§3.3）", () => {
  it("川は単調に下流へ流れる（水面の標高が下がり続ける。窪地は湖として埋めた水面）", () => {
    each((d) => {
      expect(d.rivers.length).toBeGreaterThan(0);
      for (const r of d.rivers) {
        for (let k = 0; k + 1 < r.levels.length; k++) expect(r.levels[k + 1]!).toBeLessThanOrEqual(r.levels[k]! + 1e-6);
        expect(r.widths.every((w) => w > 0)).toBe(true);
      }
    });
  });

  it("本流は先頭にあり、地図の縁（または湖）で終わる。支流は本流より小さい", () => {
    each((d) => {
      const main = d.rivers[0]!;
      expect(main.main).toBe(true);
      expect(d.rivers.filter((r) => r.main)).toHaveLength(1);
      const end = main.points[main.points.length - 1]!;
      const onEdge = [end[0], end[1], d.worldM - end[0], d.worldM - end[1]].some((v) => Math.abs(v) < 0.5);
      expect(onEdge || d.lakes.some((l) => pointInPolygon(end, l))).toBe(true);
      for (const r of d.rivers.slice(1)) expect(r.areaKm2).toBeLessThanOrEqual(main.areaKm2);
    });
  });

  it("川は村域の内部に入らない（蛇行を付けた後の形で）", () => {
    each((d) => {
      for (const r of d.rivers) {
        for (const p of r.points) {
          const [a, b] = toLocal(d.village.frame, p);
          expect(Math.max(Math.abs(a), Math.abs(b))).toBeGreaterThan(d.village.frame.halfM);
        }
      }
    });
  });

  it("旧河道は1〜2か所、本流のそばにあり、村域から離れている", () => {
    each((d) => {
      const main = d.rivers[0]!;
      expect(d.oldChannels.length).toBeGreaterThanOrEqual(HYDROLOGY.oldChannelCount[0]);
      expect(d.oldChannels.length).toBeLessThanOrEqual(HYDROLOGY.oldChannelCount[1]);
      for (const poly of d.oldChannels) {
        expect(polygonClearance(d.village.frame, poly)).toBeGreaterThanOrEqual(HYDROLOGY.oldChannelVillageKeepM);
        const near = Math.min(
          ...poly.map((p) => Math.min(...main.points.slice(1).map((q, k) => pointSegmentDistance(p, main.points[k]!, q)))),
        );
        expect(near).toBeLessThan(200);
      }
    });
  });

  it("蛇行は村域に近づかない（川岸と村域の間に余白が残る）", () => {
    each((d) => {
      const main = d.rivers[0]!;
      expect(polylineClearance(d.village.frame, main.points, main.widths.map((w) => w / 2))).toBeGreaterThanOrEqual(RIVER_CLEARANCE_M);
    });
  });
});

describe("街道（§4.4）", () => {
  it("十字の本通りの一端から始まり、地図の縁まで届き、村域の中を通らない", () => {
    each((d) => {
      const hw = d.highway.points;
      const start = armEndPoint(d.village.frame, d.highway.from);
      expect(Math.hypot(hw[0]![0] - start[0], hw[0]![1] - start[1])).toBeLessThan(0.5);
      const end = hw[hw.length - 1]!;
      expect([end[0], end[1], d.worldM - end[0], d.worldM - end[1]].some((v) => Math.abs(v) < 0.5)).toBe(true);
      expect(polylineClearance(d.village.frame, hw.slice(1), [])).toBeGreaterThanOrEqual(0);
      expect(d.highway.destination.length).toBeGreaterThan(0);
    });
  });
});

describe("地名（§6.5）", () => {
  it("一意で、小字が全区画に付き、領地名と街道の行き先がある", () => {
    each((d) => {
      const names = d.toponyms.map((t) => t.name);
      expect(new Set(names).size).toBe(names.length);
      const districts = d.toponyms.filter((t) => t.kind === "district").map((t) => t.name);
      for (const p of d.parcels) expect(districts).toContain(p.name);
      expect(d.toponyms.some((t) => t.kind === "region")).toBe(true);
      expect(d.toponyms.find((t) => t.kind === "destination")?.name).toBe(d.highway.destination);
      expect(d.toponyms.find((t) => t.kind === "river")?.name).toBe(d.rivers[0]!.name);
    });
  });
});

describe("validateTerrain", () => {
  it("生成した地形に問題が見つからない", () => {
    each((d) => expect(validateTerrain(d)).toEqual([]));
  });

  it("村域に川を通すと見つける", () => {
    const d = okData(small.get("save-1")!);
    const F = d.village.frame;
    const broken: TerrainDataV2 = { ...d, rivers: [{ ...d.rivers[0]!, points: [F.center, [F.center[0] + 1, F.center[1]]], widths: [10, 10], levels: [1, 0] }] };
    expect(validateTerrain(broken).some((m) => m.startsWith("river 0: clearance"))).toBe(true);
  });
});
