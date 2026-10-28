import { Either } from "effect";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { countTextChars, type Decree } from "../../domain/Decree";
import type { GameState } from "../../domain/GameState";
import type { IntentDeclaration } from "../../domain/IntentDeclaration";
import type { TurnRecord } from "../../domain/TurnRecord";
import { targetUsageOf } from "../../engine/Telemetry";
import { messages } from "../../i18n/messages";
import type { MapViewModel } from "../map/MapViewModel";
import { validationMessage } from "../validation";
import type { GameApi, Result } from "./GameApi";
import { projectMapView } from "./projectMapView";

// ゲームロジックを呼ぶ層（TurnMachine へのアダプタ）。状態の更新と計測ログはここだけで行い、
// 描画層はこのフックが返す値を読んで、操作を actions 経由で頼むだけ（CLAUDE.md §4-5・不変条件17）。

export type Phase = "playing" | "resolving" | "result" | "ended";

export interface ResultReading {
  readonly flips: number;
  readonly deepestSheet: number;
}

export interface GameSession {
  /** 計測ログの束ね（ページを開くごとに1つ） */
  readonly sessionId: string;
  readonly game: GameState | null;
  readonly phase: Phase;
  readonly candidates: readonly string[];
  readonly error: string | null;
  readonly lastRecord: TurnRecord | null;
  /** 地図に渡す投影（MapViewModel。不変条件26） */
  readonly view: MapViewModel | null;
  readonly actions: {
    readonly submit: (decree: Decree, intent: IntentDeclaration | null) => Promise<void>;
    readonly closeResult: (reading: ResultReading) => void;
    readonly restart: () => Promise<void>;
    readonly appoint: (candidateId: string) => Promise<void>;
    readonly dismiss: (aideId: string) => Promise<void>;
    readonly logNewspaperRead: (reading: { issueTurn: number; dwellMs: number; articleCount: number; hasLetters: boolean }) => void;
    readonly logLettersRead: (issueTurn: number, articleIds: readonly string[], dwellMs: number) => void;
    readonly exportLog: () => string;
  };
}

const errorText = (result: Result<GameState>): string | null =>
  Either.isLeft(result)
    ? result.left._tag === "ValidationError"
      ? validationMessage(result.left.issue)
      : messages.ui.errors.unexpected
    : null;

const defaultId = (): string => crypto.randomUUID();

export function useGameSession(api: GameApi, newId: () => string = defaultId): GameSession {
  const [game, setGame] = useState<GameState | null>(null);
  const [phase, setPhase] = useState<Phase>("playing");
  const [candidates, setCandidates] = useState<readonly string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sessionId] = useState(newId);
  const gameId = useRef<string>("");
  const restartIndex = useRef(0);
  const readySince = useRef(performance.now());

  const begin = useCallback(
    (state: GameState, resumed: boolean) => {
      setGame(state);
      setPhase(state.ending === null ? "playing" : "ended");
      readySince.current = performance.now();
      api.log({
        event: "game.start",
        data: { sessionId, gameId: gameId.current, seed: state.seed, restartIndex: restartIndex.current, resumed },
      });
    },
    [api, sessionId],
  );

  // 起動：セーブがあれば続きから、なければ新しく
  useEffect(() => {
    gameId.current = newId();
    api.log({ event: "session.start", data: { sessionId, llmMode: api.llmMode } });
    let cancelled = false;
    void api.load().then(async (saved) => {
      if (cancelled) return;
      if (saved !== null && saved.ending === null) begin(saved, true);
      else {
        const fresh = await api.start();
        if (!cancelled) begin(fresh, false);
      }
    });
    return () => {
      cancelled = true;
    };
    // 起動時に一度だけ
  }, [api, begin, newId, sessionId]);

  // 任命候補は状態が変わるたびに取り直す（同じ年なら同じ顔ぶれ）
  useEffect(() => {
    if (game === null) return;
    let cancelled = false;
    void api.candidates(game).then((list) => {
      if (!cancelled) setCandidates(list);
    });
    return () => {
      cancelled = true;
    };
  }, [api, game]);

  const lastRecord: TurnRecord | null = game?.history.at(-1) ?? null;
  const view = useMemo(() => (game === null ? null : projectMapView(game)), [game]);

  const submit = async (decree: Decree, intent: IntentDeclaration | null) => {
    if (game === null) return;
    api.log({
      event: "turn.submitted",
      data: {
        gameId: gameId.current,
        turn: game.turn,
        chars: countTextChars(decree.text),
        tags: decree.tags.map((tag) => tag.kind),
        intentDeclared: intent !== null,
        deliberationMs: Math.round(performance.now() - readySince.current),
      },
    });
    setPhase("resolving");
    setError(null);
    const result = await api.play(game, decree, intent);
    if (Either.isLeft(result)) {
      setError(errorText(result));
      setPhase("playing");
      return;
    }
    const next = result.right;
    const record = next.history.at(-1);
    api.log({
      event: "turn.resolved",
      data: {
        gameId: gameId.current,
        turn: game.turn,
        source: record?.interpretation?.source ?? null,
        intentDeclared: intent !== null,
        intentAchieved: record?.intentEvaluation?.achieved ?? null,
        bonusHappiness: record?.bonusHappiness ?? 0,
      },
    });
    if (record) {
      for (const usage of targetUsageOf(record)) {
        api.log({ event: "target.used", data: { gameId: gameId.current, turn: game.turn, ...usage } });
      }
    }
    if (next.ending !== null) {
      api.log({ event: "game.end", data: { gameId: gameId.current, turns: game.turn, ending: next.ending } });
    }
    setGame(next);
    setPhase("result");
  };

  const closeResult = (reading: ResultReading) => {
    if (game === null || lastRecord === null || phase !== "result") return;
    api.log({ event: "result.closed", data: { gameId: gameId.current, turn: lastRecord.turn, ...reading } });
    setPhase(game.ending === null ? "playing" : "ended");
    readySince.current = performance.now();
  };

  const restart = async () => {
    if (game !== null) {
      api.log({ event: "game.restart", data: { gameId: gameId.current, turn: game.turn, ended: game.ending !== null } });
    }
    gameId.current = newId();
    restartIndex.current += 1;
    begin(await api.start(), false);
  };

  const appoint = async (candidateId: string) => {
    if (game === null) return;
    const result = await api.appoint(game, candidateId);
    if (Either.isRight(result)) {
      api.log({ event: "aide.appointed", data: { gameId: gameId.current, turn: game.turn, aideId: candidateId } });
      setGame(result.right);
    }
    setError(errorText(result));
  };

  const dismiss = async (aideId: string) => {
    if (game === null) return;
    const result = await api.dismiss(game, aideId);
    if (Either.isRight(result)) {
      api.log({ event: "aide.dismissed", data: { gameId: gameId.current, turn: game.turn, aideId } });
      setGame(result.right);
    }
    setError(errorText(result));
  };

  return {
    sessionId,
    game,
    phase,
    candidates,
    error,
    lastRecord,
    view,
    actions: {
      submit,
      closeResult,
      restart,
      appoint,
      dismiss,
      logNewspaperRead: (reading) => api.log({ event: "newspaper.read", data: { gameId: gameId.current, ...reading } }),
      logLettersRead: (issueTurn, articleIds, dwellMs) =>
        api.log({ event: "newspaper.letters", data: { gameId: gameId.current, issueTurn, articleIds, dwellMs } }),
      exportLog: api.exportLog,
    },
  };
}
