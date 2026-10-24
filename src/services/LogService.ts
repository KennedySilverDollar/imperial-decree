import { Context, Effect, Layer, Ref } from "effect";

// 呼び出しログ（LLM フォールバック等）。P0 では記録のみ。

export interface LogEntry {
  readonly event: string;
  readonly data?: unknown;
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
