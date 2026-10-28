import { deriveSeed, hashString, nextFloat, normalizeSeed } from "../../../domain/Prng";

// 地形用の乱数（BB-17）。domain/Prng（mulberry32）の状態を閉じ込めた関数にして、simplex-noise にも渡す。
// 地形の乱数はゲーム本体の Rng の系列とは独立（表示専用）。Math.random は使わない。

export type RandomFn = () => number;

export const createRandom = (seed: number): RandomFn => {
  let state = normalizeSeed(seed);
  return () => {
    const [value, next] = nextFloat(state);
    state = next;
    return value;
  };
};

/** seed = hash(saveId, "terrain")（不変条件18） */
export const terrainSeed = (saveId: string): number => hashString(`${saveId}:terrain`);

/** 試行ごと・用途ごとの独立した系列 */
export const subSeed = (seed: number, salt: number): number => deriveSeed(seed, salt);

export const range = (random: RandomFn, lo: number, hi: number): number => lo + (hi - lo) * random();
