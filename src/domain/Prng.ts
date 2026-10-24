// seed 付き擬似乱数（mulberry32）。純粋関数として状態を受け渡す。
// 乱数の利用は services/Rng 経由で行い、ここを直接呼ぶのは Rng とシード派生のみ。

const UINT32 = 0x100000000;
const MULBERRY_INCREMENT = 0x6d2b79f5;

export type PrngState = number;

export const normalizeSeed = (seed: number): PrngState => seed >>> 0;

/** [0,1) の一様乱数と次の状態を返す */
export const nextFloat = (state: PrngState): readonly [number, PrngState] => {
  const next = (state + MULBERRY_INCREMENT) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / UINT32;
  return [value, next] as const;
};

/** seed と追加の値から独立した系列の seed を作る（任命候補の生成など、本系列を消費したくない用途） */
export const deriveSeed = (seed: number, salt: number): PrngState => {
  const [value] = nextFloat(normalizeSeed(seed ^ Math.imul(salt + 1, MULBERRY_INCREMENT)));
  return normalizeSeed(Math.floor(value * UINT32));
};
