import { Context, Effect, Layer, Ref } from "effect";
import { SAVE_SCHEMA_VERSION, SAVE_STORAGE_KEY } from "../domain/constants";
import type { GameState } from "../domain/GameState";
import { SaveError } from "./errors";

// セーブ（SPEC §11.7）。1スロット、JSON。バージョン不一致は読み込まない（DECISIONS D-53）。

export interface SaveServiceShape {
  readonly save: (state: GameState) => Effect.Effect<void, SaveError>;
  readonly load: Effect.Effect<GameState | null, SaveError>;
  readonly clear: Effect.Effect<void, SaveError>;
}

export class SaveService extends Context.Tag("SaveService")<SaveService, SaveServiceShape>() {}

const decode = (raw: string | null): Effect.Effect<GameState | null, SaveError> =>
  raw === null
    ? Effect.succeed(null)
    : Effect.try({
        try: () => JSON.parse(raw) as unknown,
        catch: (error) => new SaveError({ operation: "load", detail: String(error) }),
      }).pipe(
        Effect.map((parsed) =>
          typeof parsed === "object" &&
          parsed !== null &&
          (parsed as { schemaVersion?: unknown }).schemaVersion === SAVE_SCHEMA_VERSION
            ? (parsed as GameState)
            : null,
        ),
      );

export const makeSaveServiceInMemory = Effect.map(Ref.make<string | null>(null), (ref) => ({
  raw: Ref.get(ref),
  service: {
    save: (state: GameState) => Ref.set(ref, JSON.stringify(state)),
    load: Effect.flatMap(Ref.get(ref), decode),
    clear: Ref.set(ref, null),
  } satisfies SaveServiceShape,
}));

export const SaveServiceInMemory: Layer.Layer<SaveService> = Layer.effect(
  SaveService,
  Effect.map(makeSaveServiceInMemory, ({ service }) => service),
);

/** localStorage 実装。テストのため Storage 互換オブジェクトを受け取る */
export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const makeSaveServiceStorage = (storage: StorageLike, key: string = SAVE_STORAGE_KEY): SaveServiceShape => ({
  save: (state) =>
    Effect.try({
      try: () => storage.setItem(key, JSON.stringify(state)),
      catch: (error) => new SaveError({ operation: "save", detail: String(error) }),
    }),
  load: Effect.try({
    try: () => storage.getItem(key),
    catch: (error) => new SaveError({ operation: "load", detail: String(error) }),
  }).pipe(Effect.flatMap(decode)),
  clear: Effect.try({
    try: () => storage.removeItem(key),
    catch: (error) => new SaveError({ operation: "clear", detail: String(error) }),
  }),
});

export const SaveServiceLocalStorage = (storage: StorageLike): Layer.Layer<SaveService> =>
  Layer.succeed(SaveService, makeSaveServiceStorage(storage));
