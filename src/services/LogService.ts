import { Clock, Context, Effect, Layer, Ref } from "effect";
import { LOG_MAX_ENTRIES, LOG_STORAGE_KEY } from "../domain/constants";
import type { StorageLike } from "./SaveService";

// 計測・呼び出しログ（SPEC §15 のプロト KPI、LLM フォールバックなど）。

export interface LogEntry {
  readonly event: string;
  readonly data?: unknown;
}

/** 保存されるログ。時刻は Clock から付与する */
export interface StoredLogEntry extends LogEntry {
  readonly at: number;
}

export interface LogServiceShape {
  readonly log: (entry: LogEntry) => Effect.Effect<void>;
}

export class LogService extends Context.Tag("LogService")<LogService, LogServiceShape>() {}

export const LogServiceSilent: Layer.Layer<LogService> = Layer.succeed(LogService, { log: () => Effect.void });

/** テスト用：記録したエントリを Ref に貯める */
export const makeLogServiceMemory = Effect.map(Ref.make<readonly LogEntry[]>([]), (ref) => ({
  entries: Ref.get(ref),
  service: { log: (entry: LogEntry) => Ref.update(ref, (list) => [...list, entry]) } satisfies LogServiceShape,
}));

export const readStoredLog = (storage: StorageLike, key: string = LOG_STORAGE_KEY): readonly StoredLogEntry[] => {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(key) ?? "[]");
    return Array.isArray(parsed) ? (parsed as StoredLogEntry[]) : [];
  } catch {
    return [];
  }
};

/** localStorage 実装。古いものから捨て、最大 LOG_MAX_ENTRIES 件を保持する。書き込み失敗でゲームは止めない。
 *  読み込みは最初の1回だけで、以降はメモリ上の配列に追記して書き出す */
export const makeLogServiceStorage = (storage: StorageLike, key: string = LOG_STORAGE_KEY): LogServiceShape => {
  let cache: StoredLogEntry[] | null = null;
  return {
    log: (entry) =>
      Effect.flatMap(Clock.currentTimeMillis, (at) =>
        Effect.sync(() => {
          cache ??= [...readStoredLog(storage, key)];
          cache.push({ ...entry, at });
          if (cache.length > LOG_MAX_ENTRIES) cache.splice(0, cache.length - LOG_MAX_ENTRIES);
          try {
            storage.setItem(key, JSON.stringify(cache));
          } catch {
            // 容量超過などは記録を諦める（CLAUDE.md §4-8 の精神：計測でゲームを止めない）
          }
        }),
      ),
  };
};

export const LogServiceLocalStorage = (storage: StorageLike): Layer.Layer<LogService> =>
  Layer.succeed(LogService, makeLogServiceStorage(storage));
