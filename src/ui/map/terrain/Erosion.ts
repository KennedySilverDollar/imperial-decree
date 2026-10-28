import type { Grid } from "./grid";
import type { RandomFn } from "./rng";
import { EROSION } from "./terrainConstants";

// 侵食（SPEC_v3.4 §3.1 の 3）。粒子ベースの水力侵食と熱侵食（斜面の崩れ）。乱数は seed 付きで決定論。
// protect が 1 のセル（段丘面とその周り）は削らない。粒子はそこから出発せず、入ったら止まる。

/** 水力侵食。削った量の合計（m）を返す */
export const hydraulicErosion = (H: Float32Array, g: Grid, random: RandomFn, protect: Uint8Array | null): number => {
  const n = g.n;
  const particles = Math.round(n * n * EROSION.particlesPerCell);
  const { inertia, capacity, minCapacity, deposit, erode, evaporate, gravity, life } = EROSION;
  let moved = 0;
  for (let p = 0; p < particles; p++) {
    let px = 1 + random() * (n - 4);
    let py = 1 + random() * (n - 4);
    if (protect && protect[(py | 0) * n + (px | 0)]) continue;
    let dx = 0;
    let dy = 0;
    let speed = 1;
    let water = 1;
    let sediment = 0;
    for (let s = 0; s < life; s++) {
      const ix = px | 0;
      const iy = py | 0;
      const fx = px - ix;
      const fy = py - iy;
      const k = iy * n + ix;
      const h00 = H[k]!;
      const h10 = H[k + 1]!;
      const h01 = H[k + n]!;
      const h11 = H[k + n + 1]!;
      const gx = (h10 - h00) * (1 - fy) + (h11 - h01) * fy;
      const gy = (h01 - h00) * (1 - fx) + (h11 - h10) * fx;
      const h = h00 * (1 - fx) * (1 - fy) + h10 * fx * (1 - fy) + h01 * (1 - fx) * fy + h11 * fx * fy;
      dx = dx * inertia - gx * (1 - inertia);
      dy = dy * inertia - gy * (1 - inertia);
      const len = Math.hypot(dx, dy);
      if (len < 1e-9) break;
      dx /= len;
      dy /= len;
      px += dx;
      py += dy;
      if (px < 1 || px >= n - 3 || py < 1 || py >= n - 3) break;
      if (protect && protect[(py | 0) * n + (px | 0)]) break;
      const jx = px | 0;
      const jy = py | 0;
      const kx = px - jx;
      const ky = py - jy;
      const m = jy * n + jx;
      const nh = H[m]! * (1 - kx) * (1 - ky) + H[m + 1]! * kx * (1 - ky) + H[m + n]! * (1 - kx) * ky + H[m + n + 1]! * kx * ky;
      const dh = nh - h;
      const cap = Math.max(-dh * speed * water * capacity, minCapacity);
      if (sediment > cap || dh > 0) {
        const amount = dh > 0 ? Math.min(dh, sediment) : (sediment - cap) * deposit;
        sediment -= amount;
        H[k] = h00 + amount * (1 - fx) * (1 - fy);
        H[k + 1] = h10 + amount * fx * (1 - fy);
        H[k + n] = h01 + amount * (1 - fx) * fy;
        H[k + n + 1] = h11 + amount * fx * fy;
      } else {
        const amount = Math.min((cap - sediment) * erode, -dh);
        sediment += amount;
        H[k] = h00 - amount * (1 - fx) * (1 - fy);
        H[k + 1] = h10 - amount * fx * (1 - fy);
        H[k + n] = h01 - amount * (1 - fx) * fy;
        H[k + n + 1] = h11 - amount * fx * fy;
        moved += amount;
      }
      speed = Math.sqrt(Math.max(0, speed * speed - dh * gravity));
      water *= 1 - evaporate;
    }
  }
  return moved;
};

/** 熱侵食：安息角を超える斜面を崩す */
export const thermalErosion = (H: Float32Array, g: Grid, protect: Uint8Array | null): void => {
  const n = g.n;
  const talus = Math.tan((EROSION.thermalTalusDeg * Math.PI) / 180) * g.cell;
  const rate = EROSION.thermalRate;
  const slide = (i: number, j: number) => {
    const d = H[i]! - H[j]!;
    if (d > talus) {
      const t = rate * (d - talus);
      H[i] = H[i]! - t;
      H[j] = H[j]! + t;
    }
  };
  for (let it = 0; it < EROSION.thermalIterations; it++) {
    for (let y = 1; y < n - 1; y++) {
      for (let x = 1; x < n - 1; x++) {
        const i = y * n + x;
        if (protect && protect[i]) continue;
        slide(i, i + 1);
        slide(i, i + n);
        slide(i, i - 1);
        slide(i, i - n);
      }
    }
  }
};
