import { createNoise2D } from "simplex-noise";
import type { Grid } from "./grid";
import { createRandom, range } from "./rng";
import { PLANE_BLEND_M, PLANE_HALF_M, TERRAIN, VILLAGE_HALF_M, WORLD_M } from "./terrainConstants";
import type { Point, VillageFrame } from "./types";

// 基礎地形・山並み・谷・河岸段丘（SPEC_v3.4 §3.1 の 1〜2、§3.2）。
// 谷の断面は「川 → 氾濫原 → 崖線 → 段丘面（緩く川へ傾く）→ 丘 → 山並み」。段丘面は川に沿って連続し、
// 村域はその上に載る。段丘面の奥（丘の裾）には川に沿って下流へ流れる小川を彫り、丘の水が村域を横切らないようにする。村域とその周り（段丘面＋馴染ませ帯）だけは細かな起伏を消して平らにする。
// 村の前後では蛇行を消して、川が村域の一辺に沿って流れるようにする（DECISIONS §17.6 の発見1）。

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const CENTER = WORLD_M / 2;

export const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export interface TerrainLayout {
  /** 川の流れる向き（下流） */
  readonly flow: Point;
  /** flow に直交する向き */
  readonly normal: Point;
  /** 丘のある側（normal × side） */
  readonly side: 1 | -1;
  readonly meander: readonly [number, number, number, number, number, number];
  /** 村域中心の、地図中心からの下流方向の位置 */
  readonly along: number;
  /** 村域中心の、川の中心線からの距離 */
  readonly dist: number;
  /** 段丘面の川へ向かう傾き（勾配） */
  readonly tiltB: number;
  readonly micro: number;
  readonly noiseSeed: number;
  readonly frame: VillageFrame;
}

const meanderRaw = (L: Pick<TerrainLayout, "meander">, u: number): number => {
  const [a1, l1, p1, a2, l2, p2] = L.meander;
  return a1 * Math.sin((TAU * u) / l1 + p1) + a2 * Math.sin((TAU * u) / l2 + p2);
};

/** 川の中心線の、flow 軸からのずれ（村の前後は直線に近づける） */
export const riverOffset = (L: Pick<TerrainLayout, "meander" | "along">, u: number): number => {
  const c0 = meanderRaw(L, L.along);
  return c0 + (meanderRaw(L, u) - c0) * smoothstep(TERRAIN.straightNearM, TERRAIN.straightFarM, Math.abs(u - L.along));
};

/** 試行ごとのレイアウト。村域が地図の縁に近すぎるときは null（その試行は捨てる） */
export const makeLayout = (seed: number): TerrainLayout | null => {
  const random = createRandom(seed);
  const phi = range(random, 0, TAU);
  const flow: Point = [Math.cos(phi), Math.sin(phi)];
  const normal: Point = [-Math.sin(phi), Math.cos(phi)];
  const side: 1 | -1 = random() < 0.5 ? -1 : 1;
  const meander = [
    range(random, ...TERRAIN.meanderAmp1),
    range(random, ...TERRAIN.meanderLen1),
    range(random, 0, TAU),
    range(random, ...TERRAIN.meanderAmp2),
    range(random, ...TERRAIN.meanderLen2),
    range(random, 0, TAU),
  ] as const;
  const along = range(random, ...TERRAIN.villageAlongM);
  const dist = range(random, ...TERRAIN.villageDistM);
  const rot = range(random, -TERRAIN.villageRotRad, TERRAIN.villageRotRad);
  const tiltB = Math.tan(range(random, ...TERRAIN.tiltTowardRiverDeg) * DEG);
  const micro = range(random, ...TERRAIN.microReliefM);
  const noiseSeed = Math.floor(random() * 2 ** 31);

  const v = riverOffset({ meander, along }, along) + side * dist;
  const center: Point = [CENTER + along * flow[0] + v * normal[0], CENTER + along * flow[1] + v * normal[1]];
  const keep = TERRAIN.edgeKeepoutM;
  if (center[0] < keep || center[1] < keep || center[0] > WORLD_M - keep || center[1] > WORLD_M - keep) return null;
  // axisA：川と平行（下流向き）を rot だけ丘側へ回したもの。axisB：axisA に直交し丘側を向く
  const hill: Point = [normal[0] * side, normal[1] * side];
  const axisA: Point = [flow[0] * Math.cos(rot) + hill[0] * Math.sin(rot), flow[1] * Math.cos(rot) + hill[1] * Math.sin(rot)];
  const dot = axisA[0] * hill[0] + axisA[1] * hill[1];
  const bx = hill[0] - dot * axisA[0];
  const by = hill[1] - dot * axisA[1];
  const len = Math.hypot(bx, by);
  const frame: VillageFrame = { center, axisA, axisB: [bx / len, by / len], halfM: VILLAGE_HALF_M };
  return { flow, normal, side, meander, along, dist, tiltB, micro, noiseSeed, frame };
};

/** 丘の始まり（段丘面の奥の縁）。村域の奥から馴染ませ帯と余白をとった所 */
export const hillStartOf = (L: TerrainLayout): number => L.dist + PLANE_HALF_M + PLANE_BLEND_M + TERRAIN.benchBackM;

/** 標高（m）。地図全体を grid で覆う */
export const buildHeight = (L: TerrainLayout, g: Grid): Float32Array => {
  const random = createRandom(L.noiseSeed);
  const nLow = createNoise2D(random);
  const nHigh = createNoise2D(random);
  const nRidge = createNoise2D(random);
  const nMicro = createNoise2D(random);
  const { frame: F, flow, normal, side, along, micro, tiltB } = L;
  const n = g.n;
  const cell = g.cell;
  const T = TERRAIN;
  const scarpH = T.scarpHeightM;
  const fpHalf = T.floodplainHalfM;
  const scarpTop = T.scarpTopM;
  const hillStart = hillStartOf(L);
  const hillSlope = T.hillSlope;
  const farRise = T.farBankRiseM;
  const farWidth = T.farBankWidthM;
  const farSlope = T.farBankSlope;
  const ridgeStart = hillStart + T.ridgeAfterHillM;
  const ridgeFull = ridgeStart + T.ridgeRiseM;
  const ridgeAmp = T.ridgeAmpM;
  const lowAmp = T.lowFreqAmpM;
  const highAmp = T.highFreqAmpM;
  const edgeWobble = T.planeEdgeWobbleM;
  const roundHalf = PLANE_HALF_M + VILLAGE_HALF_M * (Math.SQRT2 ** 0.5 - 1);
  const blend = PLANE_BLEND_M;
  const toeHalfW = T.toeStreamHalfWidthM;
  const toeDepth = T.toeStreamDepthM;
  const toeWobble = T.toeStreamWobbleM;
  const straightNear = T.straightNearM;
  const straightFar = T.straightFarM;
  const [a1, l1, p1, a2, l2, p2] = L.meander;
  const c0 = meanderRaw(L, along);
  const rBase = T.riverBaseM;
  const rGrad = T.riverGradient;
  const [cxF, cyF] = F.center;
  const [ax, ay] = F.axisA;
  const [bx, by] = F.axisB;
  // 低周波の起伏（波長 1500m〜）は 1/4 の格子で求めて補間する（見た目は変わらず、評価回数が 1/16）
  const lowStep = 4;
  const ln = Math.ceil(n / lowStep) + 1;
  const low = new Float32Array(ln * ln);
  for (let j = 0; j < ln; j++) {
    for (let i = 0; i < ln; i++) {
      const x = i * lowStep * cell;
      const y = j * lowStep * cell;
      let v = 0;
      let amp = 1;
      let f = 1 / 1500;
      for (let o = 0; o < 3; o++) {
        v += amp * nLow(x * f, y * f);
        amp *= 0.5;
        f *= 2;
      }
      low[j * ln + i] = v;
    }
  }
  // 細かな起伏（波長 150m〜）と山並み（〜56m）は 1/2 の格子で求めて補間する（波長あたり5点以上を保つ）
  const hiStep = 2;
  const hn = Math.ceil(n / hiStep) + 1;
  const hiGrid = new Float32Array(hn * hn);
  const ridgeGrid = new Float32Array(hn * hn);
  for (let j = 0; j < hn; j++) {
    for (let i = 0; i < hn; i++) {
      const x = i * hiStep * cell;
      const y = j * hiStep * cell;
      let v = 0;
      let amp = 1;
      let f = 1 / 150;
      for (let o = 0; o < 3; o++) {
        v += amp * nHigh(x * f, y * f);
        amp *= 0.5;
        f *= 2;
      }
      hiGrid[j * hn + i] = v;
      let acc = 0;
      amp = 1;
      f = 1 / T.ridgeWaveM;
      for (let o = 0; o < 5; o++) {
        acc += amp * (1 - Math.abs(nRidge(x * f, y * f)));
        amp *= 0.5;
        f *= 2;
      }
      ridgeGrid[j * hn + i] = acc * acc * 0.6;
    }
  }
  const H = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    const y = (j + 0.5) * cell;
    const cy = y - CENTER;
    const lj = (j + 0.5) / lowStep;
    const lj0 = Math.min(ln - 2, Math.floor(lj));
    const ty = lj - lj0;
    for (let i = 0; i < n; i++) {
      const x = (i + 0.5) * cell;
      const cx = x - CENTER;
      const u = cx * flow[0] + cy * flow[1];
      const v = cx * normal[0] + cy * normal[1];
      const raw = a1 * Math.sin((TAU * u) / l1 + p1) + a2 * Math.sin((TAU * u) / l2 + p2);
      const off = c0 + (raw - c0) * smoothstep(straightNear, straightFar, Math.abs(u - along));
      const d = (v - off) * side; // 川の中心からの距離（丘側が正）
      let z = rBase - rGrad * u;
      let rough: number; // 起伏をつける強さ（谷底と段丘面では弱く）
      if (d >= 0) {
        z += scarpH * smoothstep(fpHalf, scarpTop, d);
        if (d > scarpTop) z += tiltB * (d - scarpTop);
        if (d > hillStart) z += hillSlope * (d - hillStart);
        // 段丘面は滑らか（面を横切る沢をつくらない）。起伏は丘に入ってから
        rough = smoothstep(hillStart - toeHalfW, hillStart + 200, d);
        // 丘の裾の小川：段丘面の奥の縁に沿って下流へ流れ、丘から下りる水を集めて村域の外へ運ぶ。
        // 位置は川の中心線からの距離で決まるので、川の曲がりに沿ってゆるく曲がる
        const toe = hillStart + toeWobble * nMicro(u / 700, 0.5);
        const t = (d - toe) / toeHalfW;
        if (t > -1 && t < 1) {
          const floor = rBase - rGrad * u + scarpH + tiltB * (toe - scarpTop) - toeDepth;
          z = Math.min(z, floor + (toeDepth + 1) * t * t);
        }
      } else {
        z += farRise * smoothstep(0, farWidth, -d);
        if (-d > farWidth) z += farSlope * (-d - farWidth);
        rough = smoothstep(fpHalf, farWidth * 2, -d);
      }
      const hj = (j + 0.5) / hiStep;
      const hj0 = Math.min(hn - 2, Math.floor(hj));
      const hy = hj - hj0;
      const hi = (i + 0.5) / hiStep;
      const hi0 = Math.min(hn - 2, Math.floor(hi));
      const hx = hi - hi0;
      const hq = hj0 * hn + hi0;
      const w00 = (1 - hx) * (1 - hy);
      const w10 = hx * (1 - hy);
      const w01 = (1 - hx) * hy;
      const w11 = hx * hy;
      if (d > ridgeStart) {
        const ridge = ridgeGrid[hq]! * w00 + ridgeGrid[hq + 1]! * w10 + ridgeGrid[hq + hn]! * w01 + ridgeGrid[hq + hn + 1]! * w11;
        z += ridgeAmp * smoothstep(ridgeStart, ridgeFull, d) * ridge;
      }
      const li = (i + 0.5) / lowStep;
      const li0 = Math.min(ln - 2, Math.floor(li));
      const tx = li - li0;
      const q = lj0 * ln + li0;
      const lowV = low[q]! * (1 - tx) * (1 - ty) + low[q + 1]! * tx * (1 - ty) + low[q + ln]! * (1 - tx) * ty + low[q + ln + 1]! * tx * ty;
      const high = hiGrid[hq]! * w00 + hiGrid[hq + 1]! * w10 + hiGrid[hq + hn]! * w01 + hiGrid[hq + hn + 1]! * w11;
      const dx = x - cxF;
      const dy = y - cyF;
      const a = dx * ax + dy * ay;
      const b = dx * bx + dy * by;
      // 角を丸めた正方形（4 ノルム）の外側だけ、境界をゆらす。村域の角（4 ノルム = 300·2^¼ ≈ 357）にも辺と同じ余白を残す
      const aa = a * a;
      const bb = b * b;
      const rq = Math.sqrt(Math.sqrt(aa * aa + bb * bb)) - roundHalf;
      const wobble = rq > -3 ? edgeWobble * nMicro(x / 220, y / 220) * smoothstep(-3, 40, rq) : 0;
      const m = 1 - smoothstep(0, blend, rq + wobble); // 段丘面（村域とその周り）で 1
      z += (lowAmp * lowV * (0.4 + 0.6 * rough) + highAmp * high * (0.25 + 0.75 * rough)) * (1 - m);
      if (m > 0) z += m * micro * (nMicro(x / 50, y / 50) + 0.5 * nMicro(x / 23, y / 23));
      H[j * n + i] = z;
    }
  }
  return H;
};

/** 侵食から守る範囲（段丘面＋馴染ませ帯）。SPEC_v3.4 §3.2・DECISIONS §17.6 の C */
export const planeProtectMask = (F: VillageFrame, g: Grid): Uint8Array => {
  const mask = new Uint8Array(g.n * g.n);
  const lim = PLANE_HALF_M + PLANE_BLEND_M;
  for (let j = 0; j < g.n; j++) {
    for (let i = 0; i < g.n; i++) {
      const dx = (i + 0.5) * g.cell - F.center[0];
      const dy = (j + 0.5) * g.cell - F.center[1];
      const a = dx * F.axisA[0] + dy * F.axisA[1];
      const b = dx * F.axisB[0] + dy * F.axisB[1];
      if (Math.max(Math.abs(a), Math.abs(b)) < lim) mask[j * g.n + i] = 1;
    }
  }
  return mask;
};
