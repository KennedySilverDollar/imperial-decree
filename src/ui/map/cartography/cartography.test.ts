import { beforeAll, describe, expect, it } from "vitest";
import { BUILDING_IDS } from "../../../domain/Buildings";
import { messages } from "../../../i18n/messages";
import { planBuilding } from "../BuildingLayout";
import { composeMap, faceAngleOf, parcelShapesOf } from "../composeMap";
import type { MapViewModel } from "../MapViewModel";
import { generateTerrain } from "../terrain/generateTerrain";
import { pointInPolygon, toLocal } from "../terrain/geometry";
import { VEGETATION_CLASS } from "../terrain/Vegetation";
import type { Point, River, TerrainDataV2, Toponym } from "../terrain/types";
import { loadTerrain, terrainSupported } from "../terrainClient";
import { bakeRegion, bakeSpecs, bakeToWorld, hillshade, worldToBake } from "./Bake";
import { planDetails } from "./BuildingPlans";
import { contourLines, type HeightRegion } from "./Contours";
import { hachures, HACHURE_MIN_SLOPE } from "./Hachure";
import { HAND_MAX_WOBBLE_PX, HAND_WIDTH_JITTER, widthRuns, wobble } from "./HandDrawn";
import { drawProgress, inkPhases, isFresh, paperAge, paperTint } from "./Ink";
import { LABEL_FONT_PX, LABEL_KINDS_BY_LOD, layoutLabels, LITE_DROPPED, ridgeAxis, type PlacedLabel } from "./Labels";
import { parcelAt, scaleBarM } from "./Layers";
import { clampView, defaultView, LOD_WIDTH_M, lodOf, MAX_VIEW_M, MIN_VIEW_M, panBy, screenToWorld, zoomAt } from "./lod";
import { vegetationSymbols } from "./Symbols";

// 画法（SPEC_v3.4 §6・§7・§8.3・§8.4、§12.4）の純関数の試験。描画そのもの（Canvas）は docs/screenshots/m3 で目視する。

/** 円錐の地形：中心で高さ peak、半径 radius で 0 */
const cone = (n: number, cell: number, peak: number, radius: number): HeightRegion => {
  const h = new Float32Array(n * n);
  const c = ((n - 1) / 2) * cell;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) h[j * n + i] = Math.max(0, peak * (1 - Math.hypot(i * cell - c, j * cell - c) / radius));
  return { h, n, cell, origin: [0, 0] };
};

const plane = (n: number, cell: number, slope: number, base = 0): HeightRegion => {
  const h = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) h[j * n + i] = base + slope * i * cell;
  return { h, n, cell, origin: [0, 0] };
};

describe("等高線（marching squares の自前実装、§6.3）", () => {
  it("円錐の等高線は、高さに応じた半径の閉じた輪になる", () => {
    const r = cone(81, 1, 40, 36);
    // 0m は円錐の裾（平らな所との境）なので除く
    const lines = contourLines(r, 10, 2).filter((l) => l.level > 0);
    expect(new Set(lines.map((l) => l.level))).toEqual(new Set([10, 20, 30]));
    for (const l of lines) {
      const first = l.points[0]!;
      const last = l.points[l.points.length - 1]!;
      expect(Math.hypot(first[0] - last[0], first[1] - last[1])).toBeLessThan(1e-9);
      const want = 36 * (1 - l.level / 40);
      for (const p of l.points) expect(Math.abs(Math.hypot(p[0] - 40, p[1] - 40) - want)).toBeLessThan(0.75);
    }
    // 計曲線は indexEvery 本ごと
    expect(lines.filter((l) => l.index).map((l) => l.level)).toEqual([20]);
  });

  it("負の標高でも計曲線の判定が正しい", () => {
    const r = plane(20, 1, 1, -12);
    const index = contourLines(r, 2, 5).filter((l) => l.index).map((l) => l.level);
    expect(index).toEqual([-10, 0]);
  });

  it("間引き（急斜面）に指定したセルには等高線を引かない", () => {
    const r = plane(20, 1, 1);
    expect(contourLines(r, 2, 5, () => true)).toEqual([]);
  });
});

describe("ケバ（§6.3）", () => {
  it("平らな所には引かず、斜面では上から下への向きに、傾斜に応じて引く", () => {
    expect(hachures(plane(60, 1, 0.01), 4, 7)).toEqual([]);
    const marks = hachures(plane(60, 1, 0.5), 4, 7);
    expect(marks.length).toBeGreaterThan(20);
    for (const m of marks) {
      // 標高は x に比例して上がるので、下り向き（from → to）は x が減る向き
      expect(m.to[0]).toBeLessThan(m.from[0]);
      expect(m.weight).toBeGreaterThan(0);
      expect(m.weight).toBeLessThanOrEqual(2.2);
    }
    expect(HACHURE_MIN_SLOPE).toBeGreaterThan(0.01);
  });

  it("同じ seed なら同じ線（決定論）", () => {
    const r = cone(80, 2, 60, 70);
    expect(hachures(r, 6, 3)).toEqual(hachures(r, 6, 3));
  });
});

describe("手仕事の揺らぎ（§6.2）", () => {
  const line: Point[] = Array.from({ length: 200 }, (_, k) => [k * 3, 40 + Math.sin(k / 9) * 20]);

  it("手ぶれは上限（HAND_MAX_WOBBLE_PX）を超えない（可読性を優先）", () => {
    const w = wobble(line, 11, 5);
    w.forEach((p, k) => expect(Math.hypot(p[0] - line[k]![0], p[1] - line[k]![1])).toBeLessThanOrEqual(HAND_MAX_WOBBLE_PX + 1e-9));
    expect(wobble(line, 11)).toEqual(wobble(line, 11));
  });

  it("線の太さの揺らぎは ±HAND_WIDTH_JITTER の内側", () => {
    for (const run of widthRuns(line, 4)) {
      expect(run.scale).toBeGreaterThanOrEqual(1 - HAND_WIDTH_JITTER - 1e-9);
      expect(run.scale).toBeLessThanOrEqual(1 + HAND_WIDTH_JITTER + 1e-9);
    }
  });
});

describe("紙の経年とインク（§8.3・§8.4）", () => {
  it("紙は年とともに古びる（単調・上限あり）", () => {
    let prev = -1;
    for (let t = 1; t <= 80; t++) {
      expect(paperAge(t)).toBeGreaterThanOrEqual(prev);
      prev = paperAge(t);
    }
    expect(paperAge(1)).toBe(0);
    expect(paperAge(500)).toBe(1);
    expect(paperTint(50).alpha).toBeGreaterThan(paperTint(1).alpha);
  });

  it("今年描き込んだ線だけが新しい墨", () => {
    expect(isFresh(9, 10)).toBe(true);
    expect(isFresh(8, 10)).toBe(false);
  });

  it("描き込みは外形 → 屋根 → 着彩の順。動きを減らす設定では即時", () => {
    expect(drawProgress(0, true)).toBe(1);
    expect(drawProgress(0, false)).toBe(0);
    const early = inkPhases(0.3);
    expect(early.outline).toBeGreaterThan(0);
    expect(early.roof).toBe(0);
    expect(early.fill).toBe(0);
    const mid = inkPhases(0.6);
    expect(mid.outline).toBe(1);
    expect(mid.roof).toBeGreaterThan(0);
    expect(mid.fill).toBe(0);
    expect(inkPhases(1)).toEqual({ outline: 1, roof: 1, fill: 1 });
  });
});

describe("縮尺（L0〜L3、§7.1）", () => {
  it("表示の幅から段階が決まる", () => {
    expect(lodOf(LOD_WIDTH_M[0])).toBe(0);
    expect(lodOf(LOD_WIDTH_M[1])).toBe(1);
    expect(lodOf(LOD_WIDTH_M[2])).toBe(2);
    expect(lodOf(LOD_WIDTH_M[3])).toBe(3);
  });

  it("ホイールのズームは指した点を動かさず、範囲の内側に収める", () => {
    const v = { center: [2000, 2000] as Point, widthM: 1500 };
    const at: Point = [0.3, 0.7];
    const before = screenToWorld(v, at);
    const z = zoomAt(v, 0.5, at, 4000);
    const after = screenToWorld(z, at);
    expect(Math.hypot(before[0] - after[0], before[1] - after[1])).toBeLessThan(1e-6);
    expect(zoomAt(v, 1e-3, at, 4000).widthM).toBe(MIN_VIEW_M);
    expect(zoomAt(v, 1e3, at, 4000).widthM).toBe(MAX_VIEW_M);
    const far = clampView({ center: [-500, 9000], widthM: 600 }, 4000);
    expect(far.center).toEqual([300, 3700]);
  });

  it("ドラッグのパンは指の動きに地図がついてくる", () => {
    const v = { center: [2000, 2000] as Point, widthM: 1000 };
    expect(panBy(v, 0.1, -0.2, 4000).center).toEqual([1900, 2200]);
  });

  it("縮尺の目盛りは表示の幅の 1/5 前後の切りのよい値", () => {
    expect(scaleBarM(4000)).toBe(1000);
    expect(scaleBarM(1500)).toBe(250);
    expect(scaleBarM(600)).toBe(100);
    expect(scaleBarM(120)).toBe(25);
  });
});

describe("注記（§6.5）", () => {
  const river: River = {
    points: Array.from({ length: 60 }, (_, k) => [100 + k * 50, 2000 + Math.sin(k / 8) * 60] as Point),
    widths: Array.from({ length: 60 }, () => 12),
    levels: Array.from({ length: 60 }, (_, k) => 100 - k),
    name: "高根川",
    main: true,
    areaKm2: 30,
  };
  const toponyms: Toponym[] = [
    { kind: "region", name: "檜木郷", anchor: [2000, 2000] },
    { kind: "district", name: "上町", anchor: [1700, 2010] },
    { kind: "mountain", name: "鷹岳", anchor: [1600, 1990] },
    { kind: "hill", name: "栗ヶ丘", anchor: [2600, 2600] },
    { kind: "lake", name: "白池", anchor: [3000, 1200] },
    { kind: "wetland", name: "葦谷地", anchor: [500, 600] },
    { kind: "destination", name: "秋野宿", anchor: [3990, 200] },
    { kind: "river", name: "高根川", anchor: [1600, 2000] },
  ];
  const input = { toponyms, rivers: [river], destinationText: messages.toponyms.direction };
  const boxes = (labels: readonly PlacedLabel[], pxPerM: number) =>
    labels.flatMap((l) => l.chars.map((c) => ({ l, half: (LABEL_FONT_PX[l.kind] / pxPerM) * 0.6, at: c.at })));

  it("置いた注記の字どうしは重ならない", () => {
    for (const lod of [0, 1, 2, 3] as const) {
      const pxPerM = 396 / LOD_WIDTH_M[lod];
      const labels = layoutLabels(input, { lod, pxPerM, lite: false, focus: [2000, 2000] });
      const b = boxes(labels, pxPerM);
      for (let i = 0; i < b.length; i++) {
        for (let j = i + 1; j < b.length; j++) {
          if (b[i]!.l === b[j]!.l) continue;
          const d = Math.max(Math.abs(b[i]!.at[0] - b[j]!.at[0]), Math.abs(b[i]!.at[1] - b[j]!.at[1]));
          expect(d).toBeGreaterThanOrEqual(Math.min(b[i]!.half, b[j]!.half) * 2 - 1e-6);
        }
      }
    }
  });

  it("段階ごとに出す種類を切り替え、郡名は注記にしない（表題の枠に出す）", () => {
    for (const lod of [0, 1, 2, 3] as const) {
      const labels = layoutLabels(input, { lod, pxPerM: 396 / LOD_WIDTH_M[lod], lite: false, focus: [2000, 2000] });
      for (const l of labels) expect(LABEL_KINDS_BY_LOD[lod]).toContain(l.kind);
      expect(labels.some((l) => (l.kind as string) === "region")).toBe(false);
    }
  });

  it("重なるときは優先度の高い方（川名 > 山名 > 地名 > 区画名）を残す", () => {
    // 川の近くに小字を置き、縮尺を粗くして必ず重なるようにする
    const crowded = { ...input, toponyms: [toponyms[1]!, toponyms[7]!] };
    const labels = layoutLabels(crowded, { lod: 2, pxPerM: 0.05, lite: false, focus: [1700, 2000] });
    expect(labels[0]?.kind).toBe("river");
    expect(labels.every((l) => l.kind !== "district") || labels.length === 2).toBe(true);
  });

  it("川名は川筋に沿い、逆さにならない。地名は地名一覧の名前だけ", () => {
    const labels = layoutLabels(input, { lod: 1, pxPerM: 396 / 1500, lite: false, focus: [2000, 2000] });
    const r = labels.find((l) => l.kind === "river");
    expect(r?.text).toBe("高根川");
    for (const c of r?.chars ?? []) expect(Math.cos(c.angle)).toBeGreaterThan(0);
    const names = new Set(toponyms.map((t) => t.name));
    for (const l of labels) expect(names.has(l.text) || l.text === messages.toponyms.direction("秋野宿")).toBe(true);
  });

  it("街道の先の注記は地図の内側へ寄せる。軽量モードでは一部の注記を省く", () => {
    const labels = layoutLabels(input, { lod: 1, pxPerM: 396 / 1500, lite: false, focus: [2000, 2000] });
    const dest = labels.find((l) => l.kind === "destination");
    for (const c of dest?.chars ?? []) expect(c.at[0]).toBeLessThan(3990);
    const lite = layoutLabels(input, { lod: 1, pxPerM: 396 / 1500, lite: true, focus: [2000, 2000] });
    expect(lite.some((l) => LITE_DROPPED.includes(l.kind))).toBe(false);
  });

  it("山名は尾根の向きに並べる（東西に延びる尾根なら水平に近い）", () => {
    const n = 120;
    const h = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) h[j * n + i] = 200 - Math.abs(j - 60) * 4 - Math.abs(i - 60) * 0.3;
    const angle = ridgeAxis({ h, n, cell: 10, origin: [0, 0] }, [600, 600]);
    expect(Math.abs(Math.sin(angle))).toBeLessThan(0.2);
  });
});

describe("植生の記号（§6.1 レイヤ6）", () => {
  it("水域には置かず、skip の範囲を避け、決定論", () => {
    const classAt = (p: Point) => (p[0] < 500 ? VEGETATION_CLASS.water : p[0] < 1000 ? VEGETATION_CLASS.conifer : VEGETATION_CLASS.broadleaf);
    const area = { x0: 0, y0: 0, x1: 1500, y1: 1500 };
    const syms = vegetationSymbols(classAt, area, 40, 3, (p) => p[1] < 300);
    expect(syms.length).toBeGreaterThan(100);
    for (const s of syms) {
      expect(s.at[0]).toBeGreaterThanOrEqual(500);
      expect(s.at[1]).toBeGreaterThanOrEqual(300);
      expect(s.kind).toBe(s.at[0] < 1000 ? "conifer" : "broadleaf");
    }
    expect(vegetationSymbols(classAt, area, 40, 3)).toEqual(vegetationSymbols(classAt, area, 40, 3));
  });
});

describe("実際の地形で（ベイクの座標・建物平面・区画の当たり判定）", () => {
  let terrain: TerrainDataV2;
  beforeAll(() => {
    const r = generateTerrain("save-carto", { surroundN: 512, villageN: 512, precheckN: 128 });
    if (!r.ok) throw new Error("terrain failed");
    terrain = r.data;
  }, 60_000);

  it("ベイクの座標変換は往復で一致し、b3 は回転（鏡映でない）で村域の窓を覆う", () => {
    for (const s of bakeSpecs(terrain)) {
      expect(s.ux[0] * s.uy[1] - s.ux[1] * s.uy[0]).toBeCloseTo(1, 9);
      const p: Point = [1234.5, 2345.6];
      const q = worldToBake(s, p);
      const back = bakeToWorld(s, q[0], q[1]);
      expect(back[0]).toBeCloseTo(p[0], 6);
      expect(back[1]).toBeCloseTo(p[1], 6);
    }
    const b3 = bakeSpecs(terrain).find((s) => s.id === "b3")!;
    const F = terrain.village.frame;
    for (const [u, v] of [
      [0, 0],
      [b3.sizeM, 0],
      [0, b3.sizeM],
      [b3.sizeM, b3.sizeM],
    ] as const) {
      const [a, b] = toLocal(F, bakeToWorld(b3, u, v));
      expect(Math.abs(Math.abs(a) - terrain.village.windowHalfM)).toBeLessThan(1e-6);
      expect(Math.abs(Math.abs(b) - terrain.village.windowHalfM)).toBeLessThan(1e-6);
    }
  });

  it("陰影は平らな所で 1（紙の色のまま）、陰の斜面だけ暗くする", () => {
    const flat = hillshade(plane(10, 1, 0));
    for (const v of flat) expect(v).toBeCloseTo(1, 1);
    const region = bakeRegion(terrain, { ...bakeSpecs(terrain)[1]!, regionN: 64 });
    const shade = hillshade(region);
    for (const v of shade) {
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("建物平面（17種）の細部は、その建物の区画の内側に収まり、同じ入力なら同じ線（hash(saveId, 建物ID)）", () => {
    const shapes = parcelShapesOf(terrain);
    const F = terrain.village.frame;
    for (const kind of BUILDING_IDS) {
      for (const shape of [shapes[11]!, shapes[37]!, shapes[88]!]) {
        const plan = planBuilding("save-carto", { id: shape.gridIndex * 17 + 3, kind, gridIndex: shape.gridIndex }, shape, faceAngleOf(shape.x, shape.y), F);
        const details = planDetails(plan);
        if (kind !== "road" && kind !== "residential") expect(details.length).toBeGreaterThan(0);
        for (const d of details) for (const p of d.points) expect(pointInPolygon(p, shape.polygon)).toBe(true);
        expect(planDetails(plan)).toEqual(details);
      }
    }
  });

  it("区画の当たり判定：各区画の中心はその区画", () => {
    const vm: MapViewModel = {
      saveId: "save-carto",
      turn: 1,
      parcels: Array.from({ length: 100 }, (_, g) => ({ gridIndex: g, x: g % 10, y: Math.floor(g / 10), use: "empty", onCross: false })),
      roadPlan: [],
      roads: [],
      buildings: [],
      construction: [],
      notes: [],
      surveyedUntil: 1,
    };
    const comp = composeMap(vm, terrain);
    for (const sh of comp.shapes) expect(parcelAt(comp, sh.site)).toBe(sh.gridIndex);
    expect(parcelAt(comp, [1, 1])).toBeNull();
    expect(defaultView(terrain.village.frame).widthM).toBe(LOD_WIDTH_M[1]);
  });
});

describe("フォールバック（不変条件29）", () => {
  it("Worker がない環境では地形を作らず null（抽象グリッドを出す）", async () => {
    expect(terrainSupported()).toBe(false);
    await expect(loadTerrain("save-none")).resolves.toBeNull();
  });
});
