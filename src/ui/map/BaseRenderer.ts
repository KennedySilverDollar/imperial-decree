import { boundsOf, type Point } from "./geometry2d";
import { CONTOUR_INTERVAL, HEIGHTMAP_SIZE, MAP_PX, RIVER_WIDTH, VILLAGE_ORIGIN, VILLAGE_SIZE } from "./mapConstants";
import type { Ctx2D } from "./pictograms";
import { hexToRgb, SURVEY } from "./surveyPalette";
import type { TerrainData } from "./TerrainGenerator";

// 測量図の生成時のレイヤ 1〜6（SPEC_v3.3 §5.4）：紙・淡彩・陰影・等高線・水系・森。
// Worker（OffscreenCanvas）でも、Worker の無い環境の本体（HTMLCanvas）でも同じ関数で描く。文字は描かない（書体は本体で読み込むため）。
// 紙・淡彩・陰影は画素ごとの計算なので半分の解像度で作って拡大し、線（等高線・水系・森）は原寸で描く。

const H = HEIGHTMAP_SIZE;
const CELL = MAP_PX / H;
const V0 = VILLAGE_ORIGIN;
const V1 = VILLAGE_ORIGIN + VILLAGE_SIZE;

export type MakeCanvas = (width: number, height: number) => OffscreenCanvas | HTMLCanvasElement;

/** 整数のハッシュ（紙の繊維・水彩のむら。乱数ではなく位置で決まる） */
const hash2 = (x: number, y: number, salt: number): number => {
  let h = Math.imul(x ^ Math.imul(y, 0x27d4eb2d), 0x165667b1) ^ salt;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** なめらかな値ノイズ（格子 step ごとのハッシュを双一次補間） */
const valueNoise = (x: number, y: number, step: number, salt: number): number => {
  const gx = Math.floor(x / step);
  const gy = Math.floor(y / step);
  const fx = x / step - gx;
  const fy = y / step - gy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(gx, gy, salt);
  const b = hash2(gx + 1, gy, salt);
  const c = hash2(gx, gy + 1, salt);
  const d = hash2(gx + 1, gy + 1, salt);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
};

/** 標高の格子ごとの色（淡彩×陰影×縁の焼け）を RGBA の画素で。1度しか回らないので、関数呼び出しと割り当てを避けて書く */
const cellImage = (terrain: TerrainData, data: Uint8ClampedArray): void => {
  const [pr, pg, pb] = hexToRgb(SURVEY.paper);
  const [lr, lg, lb] = hexToRgb(SURVEY.lowland);
  const [mr, mg, mb] = hexToRgb(SURVEY.midland);
  const [hr, hg, hb] = hexToRgb(SURVEY.highland);
  const [kr, kg, kb] = hexToRgb("#B3ABA2");
  const [wr, wg, wb] = hexToRgb(SURVEY.waterWash);
  // 光は左上から（§5.4-3）
  const lx = -0.62;
  const ly = -0.62;
  const lz = 0.48;
  const relief = 18;
  const hm = terrain.heightmap;
  const wet = terrain.water;
  const st = (e0: number, e1: number, v: number) => {
    const t = v <= e0 ? 0 : v >= e1 ? 1 : (v - e0) / (e1 - e0);
    return t * t * (3 - 2 * t);
  };
  for (let j = 0; j < H; j++) {
    const up = j > 0 ? -H : 0;
    const down = j < H - 1 ? H : 0;
    const y = (j + 0.5) * CELL;
    for (let i = 0; i < H; i++) {
      const k = j * H + i;
      const h = hm[k] as number;
      const t1 = st(0.28, 0.5, h);
      const t2 = st(0.55, 0.78, h);
      const t3 = st(0.84, 0.96, h);
      const x = (i + 0.5) * CELL;
      // 村域からの距離（村域の淡彩は、縁から外へなだらかに戻す）
      const ox = x < V0 ? V0 - x : x > V1 ? x - V1 : 0;
      const oy = y < V0 ? V0 - y : y > V1 ? y - V1 : 0;
      const villageFade = 0.35 + 0.65 * st(0, 220, Math.sqrt(ox * ox + oy * oy));
      // 水彩：むらのある濃さ。村域は区画を描き込むので薄く
      let alpha = 0.5 + 0.22 * (valueNoise(x, y, 220, 7) - 0.5);
      alpha *= villageFade;
      const water = wet[k] !== 0;
      // 陰影（乗算）：法線と光の向き。平らな所を 1 とする
      const dx = ((hm[k + (i < H - 1 ? 1 : 0)] as number) - (hm[k - (i > 0 ? 1 : 0)] as number)) * relief;
      const dy = ((hm[k + down] as number) - (hm[k + up] as number)) * relief;
      const lambert = (-dx * lx - dy * ly + lz) / Math.sqrt(dx * dx + dy * dy + 1);
      const shadeRaw = 1 + (lambert - lz) * 1.1;
      const shade = water ? 1 : shadeRaw < 0.72 ? 0.72 : shadeRaw > 1.08 ? 1.08 : shadeRaw;
      // 縁の焼け（茶色寄りに：青を多めに落とす）
      const edge = Math.min(x, y, MAP_PX - x, MAP_PX - y);
      const burn = 1 - 0.22 * (1 - st(0, 150, edge)) - 0.05 * (1 - st(0, 520, edge));
      const o = k * 4;
      if (water) {
        data[o] = (pr * 0.35 + wr * 0.65) * burn;
        data[o + 1] = (pg * 0.35 + wg * 0.65) * burn;
        data[o + 2] = (pb * 0.35 + wb * 0.65) * burn * burn;
      } else {
        const tr = lr + (mr - lr) * t1;
        const tg = lg + (mg - lg) * t1;
        const tb = lb + (mb - lb) * t1;
        const ur = tr + (hr - tr) * t2;
        const ug = tg + (hg - tg) * t2;
        const ub = tb + (hb - tb) * t2;
        const vr = ur + (kr - ur) * t3;
        const vg = ug + (kg - ug) * t3;
        const vb = ub + (kb - ub) * t3;
        data[o] = (pr * (1 - alpha) + vr * alpha) * shade * burn;
        data[o + 1] = (pg * (1 - alpha) + vg * alpha) * shade * burn;
        data[o + 2] = (pb * (1 - alpha) + vb * alpha) * shade * burn * burn;
      }
      data[o + 3] = 255;
    }
  }
};

/** 紙の繊維の模様（小さな画像を敷き詰めて乗算する）。明るい灰色の粒 */
const grainTile = (makeCanvas: MakeCanvas, size: number, salt: number, depth: number): OffscreenCanvas | HTMLCanvasElement | null => {
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext("2d") as Ctx2D | null;
  if (!ctx) return null;
  const image = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      // 横に長い繊維：横方向にゆっくり、縦に速く変わる値
      const fiber = 0.6 * hash2(x >> 2, y, salt) + 0.4 * hash2(x, y, salt + 1);
      const v = 255 - depth * fiber;
      const o = (y * size + x) * 4;
      image.data[o] = v;
      image.data[o + 1] = v;
      image.data[o + 2] = v - 2;
      image.data[o + 3] = 255;
    }
  ctx.putImageData(image, 0, 0);
  return canvas;
};

/** レイヤ 1〜3：紙・淡彩・陰影。標高の格子 1 マス＝1 画素で色を作って引き伸ばし、紙の繊維を乗算で重ねる */
const paintWash = (ctx: Ctx2D, terrain: TerrainData, makeCanvas: MakeCanvas, lap: (name: string) => void = () => {}): void => {
  const small = makeCanvas(H, H);
  const sctx = small.getContext("2d") as Ctx2D | null;
  if (!sctx) return;
  const image = sctx.createImageData(H, H);
  cellImage(terrain, image.data);
  sctx.putImageData(image, 0, 0);
  lap("washCells");
  ctx.save();
  // 水彩はなめらかな色の面なので、双一次の引き伸ばしで足りる（高品質の補間は重い）
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "low";
  ctx.drawImage(small as CanvasImageSource, 0, 0, MAP_PX, MAP_PX);
  lap("washScale");
  ctx.globalCompositeOperation = "multiply";
  for (const [size, salt, depth] of [
    [128, 3, 14],
    [96, 5, 9],
  ] as const) {
    const tile = grainTile(makeCanvas, size, salt, depth);
    const pattern = tile ? ctx.createPattern(tile as CanvasImageSource, "repeat") : null;
    if (!pattern) continue;
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, MAP_PX, MAP_PX);
  }
  ctx.restore();
};

/** 折り目（紙を四つに畳んだ跡） */
const paintFolds = (ctx: Ctx2D): void => {
  ctx.save();
  for (const [x0, y0, x1, y1] of [
    [MAP_PX / 2, 0, MAP_PX / 2, MAP_PX],
    [0, MAP_PX / 2, MAP_PX, MAP_PX / 2],
  ] as const) {
    ctx.strokeStyle = "rgba(255, 250, 235, 0.35)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.strokeStyle = "rgba(70, 50, 30, 0.10)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x0 + (x0 === x1 ? 2 : 0), y0 + (y0 === y1 ? 2 : 0));
    ctx.lineTo(x1 + (x0 === x1 ? 2 : 0), y1 + (y0 === y1 ? 2 : 0));
    ctx.stroke();
  }
  ctx.restore();
};

/** 等高線を取る格子（標高の格子を 2 マスずつまとめ、ならしたもの） */
const CONTOUR_STEP = 2;

/** レイヤ 4：等高線。標高をならして粗い格子で marching squares をかけ、切れ端をつないだ長い折れ線にして描く（5本ごとに太線） */
const paintContours = (ctx: Ctx2D, terrain: TerrainData): void => {
  const G = Math.floor(H / CONTOUR_STEP);
  const cell = MAP_PX / G;
  // 2×2 の平均で粗くし、3×3 で一度ならす
  const coarse = new Float32Array(G * G);
  const wet = new Uint8Array(G * G);
  for (let j = 0; j < G; j++)
    for (let i = 0; i < G; i++) {
      let sum = 0;
      let w = 0;
      for (let dj = 0; dj < CONTOUR_STEP; dj++)
        for (let di = 0; di < CONTOUR_STEP; di++) {
          const k = (j * CONTOUR_STEP + dj) * H + i * CONTOUR_STEP + di;
          sum += terrain.heightmap[k] as number;
          w |= terrain.water[k] as number;
        }
      coarse[j * G + i] = sum / (CONTOUR_STEP * CONTOUR_STEP);
      wet[j * G + i] = w ? 1 : 0;
    }
  const src = new Float32Array(G * G);
  for (let j = 0; j < G; j++)
    for (let i = 0; i < G; i++) {
      let sum = 0;
      let n = 0;
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          const ii = i + di;
          const jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= G || jj >= G) continue;
          sum += coarse[jj * G + ii] as number;
          n++;
        }
      src[j * G + i] = sum / n;
    }
  // 格子の辺の番号：横の辺 (i,j)-(i+1,j) は j*G+i、縦の辺 (i,j)-(i,j+1) は G*G + j*G+i
  const thin = new Path2D();
  const thick = new Path2D();
  // 各点のつながりは高々2本：first と second に分けて持つ（配列を作らない）
  interface Level {
    readonly points: Map<number, Point>;
    readonly first: Map<number, number>;
    readonly second: Map<number, number>;
  }
  const levels = new Map<number, Level>();
  const link = (entry: Level, from: number, to: number) => {
    if (!entry.first.has(from)) entry.first.set(from, to);
    else entry.second.set(from, to);
  };
  const pos = (i: number, j: number) => ({ x: (i + 0.5) * cell, y: (j + 0.5) * cell });
  for (let j = 0; j + 1 < G; j++)
    for (let i = 0; i + 1 < G; i++) {
      const k = j * G + i;
      if (wet[k] || wet[k + 1] || wet[k + G] || wet[k + G + 1]) continue;
      const a = src[k] as number;
      const b = src[k + 1] as number;
      const c = src[k + G + 1] as number;
      const d = src[k + G] as number;
      const lo = Math.min(a, b, c, d);
      const hi = Math.max(a, b, c, d);
      for (let level = Math.max(1, Math.ceil(lo / CONTOUR_INTERVAL)); level * CONTOUR_INTERVAL <= hi; level++) {
        const v = level * CONTOUR_INTERVAL;
        let entry = levels.get(level);
        if (!entry) {
          entry = { points: new Map(), first: new Map(), second: new Map() };
          levels.set(level, entry);
        }
        const crossing: number[] = [];
        const edge = (va: number, vb: number, id: number, pa: Point, pb: Point) => {
          if (va < v === vb < v) return;
          const t = (v - va) / (vb - va);
          entry.points.set(id, { x: pa.x + (pb.x - pa.x) * t, y: pa.y + (pb.y - pa.y) * t });
          crossing.push(id);
        };
        edge(a, b, j * G + i, pos(i, j), pos(i + 1, j));
        edge(b, c, G * G + j * G + i + 1, pos(i + 1, j), pos(i + 1, j + 1));
        edge(c, d, (j + 1) * G + i, pos(i + 1, j + 1), pos(i, j + 1));
        edge(d, a, G * G + j * G + i, pos(i, j + 1), pos(i, j));
        for (let s = 0; s + 1 < crossing.length; s += 2) {
          const p = crossing[s] as number;
          const q = crossing[s + 1] as number;
          link(entry, p, q);
          link(entry, q, p);
        }
      }
    }
  // 切れ端をつなぐ：端（つながりが1本）から歩き、残りは輪として歩く
  for (const [level, { points, first, second }] of levels) {
    const path = level % 5 === 0 ? thick : thin;
    const used = new Set<number>();
    const walk = (start: number) => {
      const origin = points.get(start) as Point;
      path.moveTo(origin.x, origin.y);
      used.add(start);
      let at = start;
      for (;;) {
        const a = first.get(at);
        const b = second.get(at);
        const next = a !== undefined && !used.has(a) ? a : b !== undefined && !used.has(b) ? b : undefined;
        if (next === undefined) {
          // 輪が閉じるなら始点へ戻る
          if (at !== start && (a === start || b === start)) path.lineTo(origin.x, origin.y);
          break;
        }
        const p = points.get(next) as Point;
        path.lineTo(p.x, p.y);
        used.add(next);
        at = next;
      }
    };
    for (const id of first.keys()) if (!second.has(id) && !used.has(id)) walk(id);
    for (const id of first.keys()) if (!used.has(id)) walk(id);
  }
  ctx.save();
  ctx.strokeStyle = SURVEY.contour;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 1.3;
  ctx.stroke(thin);
  ctx.globalAlpha = 0.75;
  ctx.lineWidth = 2.4;
  ctx.stroke(thick);
  ctx.restore();
};

const tracePolyline = (ctx: Ctx2D, line: readonly Point[]) => {
  ctx.beginPath();
  line.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
};

/** レイヤ 5：水系。川は青インクの二重線と内側の淡い水彩、沼は水平のハッチング */
const paintWater = (ctx: Ctx2D, terrain: TerrainData): void => {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const lake of terrain.lakes) {
    const b = boundsOf(lake);
    ctx.save();
    tracePolyline(ctx, lake);
    ctx.closePath();
    ctx.fillStyle = SURVEY.waterWash;
    ctx.globalAlpha = 0.85;
    ctx.fill();
    ctx.clip();
    ctx.globalAlpha = 0.7;
    ctx.strokeStyle = SURVEY.waterLine;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let y = b.minY + 6; y < b.maxY; y += 10) {
      ctx.moveTo(b.minX, y);
      ctx.lineTo(b.maxX, y);
    }
    ctx.stroke();
    ctx.restore();
    tracePolyline(ctx, lake);
    ctx.closePath();
    ctx.strokeStyle = SURVEY.waterLine;
    ctx.lineWidth = 7;
    ctx.stroke();
    ctx.strokeStyle = SURVEY.waterWash;
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  tracePolyline(ctx, terrain.river);
  ctx.strokeStyle = SURVEY.waterLine;
  ctx.lineWidth = RIVER_WIDTH + 4;
  ctx.stroke();
  ctx.strokeStyle = SURVEY.waterWash;
  ctx.lineWidth = RIVER_WIDTH - 1;
  ctx.stroke();
  // 流れの筋（水彩の中の細い線）
  ctx.strokeStyle = SURVEY.waterLine;
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 1;
  ctx.setLineDash([18, 26]);
  ctx.stroke();
  ctx.restore();
};

/** レイヤ 6：森。樹木の記号（丸い樹冠と幹）を、ずらした格子に点描する */
const paintForest = (ctx: Ctx2D, terrain: TerrainData): void => {
  const step = 24;
  const trees = new Path2D();
  for (let gy = 0; gy * step < MAP_PX; gy++)
    for (let gx = 0; gx * step < MAP_PX; gx++) {
      const x = (gx + 0.2 + 0.6 * hash2(gx, gy, 11) + (gy % 2) * 0.5) * step;
      const y = (gy + 0.2 + 0.6 * hash2(gx, gy, 13)) * step;
      const i = Math.min(H - 1, Math.floor(x / CELL));
      const j = Math.min(H - 1, Math.floor(y / CELL));
      const density = (terrain.forestMask[j * H + i] as number) / 255;
      if (density === 0 || hash2(gx, gy, 17) > density * 1.6) continue;
      const r = 5 + 2.5 * hash2(gx, gy, 19);
      trees.moveTo(x + r, y);
      trees.arc(x, y, r, 0, Math.PI * 2);
      trees.moveTo(x, y + r);
      trees.lineTo(x, y + r + 5);
    }
  ctx.save();
  ctx.strokeStyle = SURVEY.forest;
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = 1.6;
  ctx.lineCap = "round";
  ctx.stroke(trees);
  ctx.restore();
};

/** 生成時のレイヤ 1〜6 をまとめて描く。段ごとの時間（ミリ秒）を返す（性能の計測用） */
export const renderBase = (ctx: Ctx2D, terrain: TerrainData, makeCanvas: MakeCanvas): Readonly<Record<string, number>> => {
  const phases: Record<string, number> = {};
  let at = performance.now();
  const lap = (name: string) => {
    // 描画は溜めておいて後でまとめて行われるので、1画素だけ読んでここで描かせ、段ごとの本当の時間を測る
    ctx.getImageData(0, 0, 1, 1);
    const now = performance.now();
    phases[name] = Math.round(now - at);
    at = now;
  };
  paintWash(ctx, terrain, makeCanvas, lap);
  lap("washGrain");
  paintFolds(ctx);
  lap("folds");
  paintContours(ctx, terrain);
  lap("contours");
  paintForest(ctx, terrain);
  lap("forest");
  paintWater(ctx, terrain);
  lap("water");
  return phases;
};
