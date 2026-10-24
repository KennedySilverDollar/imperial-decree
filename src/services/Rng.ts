import { Context, Effect, Layer, Ref } from "effect";
import { nextFloat, normalizeSeed, type PrngState } from "../domain/Prng";

// seed 付き乱数サービス（CLAUDE.md §4-3）。状態は GameState.rngState に保存して再現性を保つ。

export interface RngShape {
  /** [0,1) の一様乱数 */
  readonly next: Effect.Effect<number>;
  readonly getState: Effect.Effect<PrngState>;
  readonly setState: (state: PrngState) => Effect.Effect<void>;
}

export class Rng extends Context.Tag("Rng")<Rng, RngShape>() {}

export const makeRng = (seed: number): Effect.Effect<RngShape> =>
  Effect.map(Ref.make(normalizeSeed(seed)), (ref) => ({
    next: Ref.modify(ref, (state) => nextFloat(state)),
    getState: Ref.get(ref),
    setState: (state) => Ref.set(ref, normalizeSeed(state)),
  }));

export const RngLive = (seed: number): Layer.Layer<Rng> => Layer.effect(Rng, makeRng(seed));

// --- 補助 ---
export const random: Effect.Effect<number, never, Rng> = Effect.flatMap(Rng, (rng) => rng.next);

export const chance = (probability: number): Effect.Effect<boolean, never, Rng> =>
  Effect.map(random, (value) => value < probability);

export const randRange = (min: number, max: number): Effect.Effect<number, never, Rng> =>
  Effect.map(random, (value) => min + (max - min) * value);

export const pick = <A>(items: readonly A[]): Effect.Effect<A | undefined, never, Rng> =>
  Effect.map(random, (value) => items[Math.floor(value * items.length)]);

/** テスト用：決まった値を順に返す Rng（尽きたら fallback を返し続ける） */
export const RngScripted = (values: readonly number[], fallback = 0.99): Layer.Layer<Rng> =>
  Layer.effect(
    Rng,
    Effect.map(Ref.make(0), (index) => ({
      next: Ref.modify(index, (i) => [values[i] ?? fallback, i + 1] as const),
      getState: Ref.get(index),
      setState: () => Effect.void,
    })),
  );
