import { beforeAll, describe, expect, it } from "vitest";
import { createInitialState } from "../../domain/GameState";
import { projectMapView } from "./projectMapView";
import { composeMap } from "../map/composeMap";
import { generateTerrain } from "../map/terrain/generateTerrain";
import type { TerrainDataV2 } from "../map/terrain/types";
import { buildRelief, clipToModel, heightAt, RELIEF_HALF_M, reliefGrid, reliefInfo, reliefLines } from "../map/model3d/ReliefMesh";
import { clampCamera, DEFAULT_CAMERA, dragCamera, drawRelief, lightFrom, projector, RELIEF_PITCH_MAX, RELIEF_PITCH_MIN, zoomCamera } from "../map/model3d/ReliefModel";

// 地形模型（SPEC_v3.4 §10、M4）。GameState から投影を作るので src/ui/game/ に置く（地図の描画層は GameState を import しない）：形は MapViewModel と地形だけから作り、地図の構図と同じ建物・普請中・道を持つ。空洞・進捗は持たない。

let terrain: TerrainDataV2;
beforeAll(() => {
  const r = generateTerrain("save-relief", { surroundN: 512, villageN: 512, precheckN: 128 });
  if (!r.ok) throw new Error("terrain failed");
  terrain = r.data;
}, 60_000);

/** Canvas 2D の代わり：呼ばれた塗りの回数だけを数える */
const fakeCtx = () => {
  const calls = { fill: 0, stroke: 0 };
  const noop = () => {};
  const ctx = new Proxy(
    { calls },
    {
      get: (target, key) => {
        if (key === "calls") return target.calls;
        if (key === "fill") return () => void calls.fill++;
        if (key === "stroke") return () => void calls.stroke++;
        return noop;
      },
      set: () => true,
    },
  );
  return ctx as unknown as CanvasRenderingContext2D & { calls: typeof calls };
};

describe("模型の形（ReliefMesh）", () => {
  it("格子は ±RELIEF_HALF_M を覆い、村域の周りが細かい", () => {
    const L = reliefLines();
    expect(L[0]).toBe(-RELIEF_HALF_M);
    expect(L[L.length - 1]).toBe(RELIEF_HALF_M);
    for (let k = 1; k < L.length; k++) expect(L[k]!).toBeGreaterThan(L[k - 1]!);
    const step = (t: number) => {
      const k = L.findIndex((v) => v > t);
      return L[k]! - L[k - 1]!;
    };
    expect(step(0)).toBeLessThan(step(RELIEF_HALF_M - 200));
  });

  it("高さは 0 以上で、格子点では格子の値を返す", () => {
    const g = reliefGrid(terrain);
    for (const h of g.heights) expect(h).toBeGreaterThanOrEqual(0);
    expect(g.base).toBeLessThan(0);
    const n = g.lines.length;
    expect(heightAt(g, g.lines[3]!, g.lines[5]!)).toBeCloseTo(g.heights[5 * n + 3]!, 4);
  });

  it("多角形を模型の正方形で切る", () => {
    const H = RELIEF_HALF_M;
    expect(clipToModel([[0, 0], [10, 0], [10, 10]])).toHaveLength(3);
    expect(clipToModel([[H + 10, 0], [H + 20, 0], [H + 20, 10]])).toEqual([]);
    for (const [a, b] of clipToModel([[-H - 100, -50], [H + 100, -50], [H + 100, 50], [-H - 100, 50]])) {
      expect(Math.abs(a)).toBeLessThanOrEqual(H + 1e-9);
      expect(Math.abs(b)).toBeLessThanOrEqual(H + 1e-9);
    }
  });

  it("地図と同じ構図から作り、建物・普請中・道は地図と同じ（情報は地図の部分集合）。決定論", () => {
    const state = createInitialState(3);
    const view = projectMapView(state);
    const comp = composeMap(view, terrain);
    const scene = buildRelief(terrain, comp);
    const info = reliefInfo(scene);
    const withStructure = comp.buildings.filter((b) => b.parts.some((p) => p.role === "structure")).map((b) => b.id);
    expect(info.buildings).toEqual([...withStructure].sort((p, q) => p - q));
    expect(info.construction).toBe(comp.construction.length);
    expect(info.roads > 0).toBe(comp.roads.pieces.length > 0);
    expect(buildRelief(terrain, composeMap(view, terrain))).toEqual(scene);
    // 箱・面のどれも空洞・進捗の欄を持たない
    expect(JSON.stringify(scene.boxes)).not.toMatch(/hollow|progress|disclosed/);
  });

  it("見えない値（空洞・開示）だけが違う状態からは同じ模型", () => {
    const state = createInitialState(5);
    const hidden = { ...state, buildings: state.buildings.map((b) => ({ ...b, hollow: !b.hollow, disclosed: !b.disclosed })) };
    const a = buildRelief(terrain, composeMap(projectMapView(state), terrain));
    const b = buildRelief(terrain, composeMap(projectMapView(hidden), terrain));
    expect(b).toEqual(a);
  });
});

describe("模型の描画（ReliefModel）", () => {
  it("カメラは傾き・寄りの範囲に収め、ドラッグで回す・傾ける", () => {
    expect(clampCamera({ yaw: 0, pitch: 10, zoom: 100 }).pitch).toBe(RELIEF_PITCH_MAX);
    expect(clampCamera({ yaw: 0, pitch: -1, zoom: 0 }).pitch).toBe(RELIEF_PITCH_MIN);
    const turned = dragCamera(DEFAULT_CAMERA, 100, 0, 400);
    expect(turned.yaw).toBeGreaterThan(DEFAULT_CAMERA.yaw);
    expect(turned.pitch).toBe(DEFAULT_CAMERA.pitch);
    expect(dragCamera(DEFAULT_CAMERA, 0, 100, 400).pitch).toBeGreaterThan(DEFAULT_CAMERA.pitch);
    expect(zoomCamera(DEFAULT_CAMERA, 2).zoom).toBe(2);
  });

  it("正射影：模型の中心は画面の中心、高い所ほど画面の上・手前", () => {
    const P = projector({ yaw: 0.7, pitch: 0.8, zoom: 1 }, 400, 0);
    const [x, y] = P.project(0, 0, 0);
    expect(x).toBeCloseTo(200);
    expect(y).toBeCloseTo(200);
    const [, yHigh, dHigh] = P.project(0, 0, 50);
    const [, , dLow] = P.project(0, 0, 0);
    expect(yHigh).toBeLessThan(y);
    expect(dHigh).toBeLessThan(dLow);
  });

  it("光は机のランプへ向かう単位ベクトル", () => {
    const l = lightFrom([-1000, -700, 520], [-560, -520, 30], [1, -0.9, 1]);
    expect(Math.hypot(...l.lamp)).toBeCloseTo(1);
    expect(l.lamp[0]).toBeLessThan(0);
    expect(l.lamp[2]).toBeGreaterThan(0);
  });

  it("同じ形・同じ向きなら同じ数の面を描く（向きで台座の見える側面が変わる）", () => {
    const scene = buildRelief(terrain, composeMap(projectMapView(createInitialState(3)), terrain));
    const light = lightFrom([-1000, -700, 520], [0, 0, 0], [1, -0.9, 1]);
    const a = drawRelief(fakeCtx(), 400, scene, DEFAULT_CAMERA, light);
    const b = drawRelief(fakeCtx(), 400, scene, DEFAULT_CAMERA, light);
    expect(a).toEqual(b);
    const front = drawRelief(fakeCtx(), 400, scene, { yaw: 0, pitch: 0.8, zoom: 1 }, light);
    // yaw = 0 なら手前の1面だけ、斜めなら2面
    expect(a.primitives - front.primitives).toBe(1);
  });
});
