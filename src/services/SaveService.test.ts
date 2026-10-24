import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { createInitialState } from "../domain/GameState";
import { makeSaveServiceInMemory, makeSaveServiceStorage, type StorageLike } from "./SaveService";

const fakeStorage = (): StorageLike & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
};

describe("SaveService", () => {
  const state = createInitialState(5);

  it("インメモリ：保存・読込・消去", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const { service } = yield* makeSaveServiceInMemory;
        const empty = yield* service.load;
        yield* service.save(state);
        const loaded = yield* service.load;
        yield* service.clear;
        return { empty, loaded, cleared: yield* service.load };
      }),
    );
    expect(result).toEqual({ empty: null, loaded: state, cleared: null });
  });

  it("localStorage 実装：JSON で保存し、読み戻せる", async () => {
    const storage = fakeStorage();
    const service = makeSaveServiceStorage(storage, "k");
    await Effect.runPromise(service.save(state));
    expect(JSON.parse(storage.data.get("k") ?? "")).toEqual(state);
    expect(await Effect.runPromise(service.load)).toEqual(state);
  });

  it("バージョン不一致は読み込まない", async () => {
    const storage = fakeStorage();
    storage.setItem("k", JSON.stringify({ ...state, schemaVersion: 999 }));
    expect(await Effect.runPromise(makeSaveServiceStorage(storage, "k").load)).toBeNull();
  });

  it("壊れたデータ・書き込み失敗は SaveError", async () => {
    const storage = fakeStorage();
    storage.setItem("k", "{broken");
    const loaded = await Effect.runPromise(Effect.either(makeSaveServiceStorage(storage, "k").load));
    expect(loaded._tag === "Left" && loaded.left._tag).toBe("SaveError");
    const full: StorageLike = { ...storage, setItem: () => { throw new Error("QuotaExceeded"); } };
    const saved = await Effect.runPromise(Effect.either(makeSaveServiceStorage(full, "k").save(state)));
    expect(saved._tag === "Left" && saved.left).toMatchObject({ _tag: "SaveError", operation: "save" });
  });
});
