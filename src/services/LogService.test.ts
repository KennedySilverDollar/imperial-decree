import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { LOG_MAX_ENTRIES } from "../domain/constants";
import { makeLogServiceStorage, readStoredLog } from "./LogService";
import type { StorageLike } from "./SaveService";

const fakeStorage = (): StorageLike => {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
};

describe("LogService（localStorage）", () => {
  it("時刻付きで追記し、最大件数を超えたら古いものから捨てる", async () => {
    const storage = fakeStorage();
    const logger = makeLogServiceStorage(storage, "log");
    for (let i = 0; i < LOG_MAX_ENTRIES + 3; i++) await Effect.runPromise(logger.log({ event: "e", data: i }));
    const entries = readStoredLog(storage, "log");
    expect(entries).toHaveLength(LOG_MAX_ENTRIES);
    expect(entries[0]?.data).toBe(3);
    expect(typeof entries[0]?.at).toBe("number");
  });

  it("書き込みに失敗してもゲームを止めない", async () => {
    const broken: StorageLike = { ...fakeStorage(), setItem: () => { throw new Error("QuotaExceeded"); } };
    await expect(Effect.runPromise(makeLogServiceStorage(broken).log({ event: "e" }))).resolves.toBeUndefined();
  });
});
