import { Either } from "effect";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DECREE_POLITICAL_COST, POLITICAL_CAPITAL_MAX } from "../domain/constants";
import { countTextChars, type Decree } from "../domain/Decree";
import type { GameState } from "../domain/GameState";
import type { IntentDeclaration } from "../domain/IntentDeclaration";
import type { TurnRecord } from "../domain/TurnRecord";
import { mapOf } from "../engine/MapUpdater";
import { messages } from "../i18n/messages";
import { AidePanel } from "./panels/AidePanel";
import { DecreePanel } from "./panels/DecreePanel";
import { EndingScreen } from "./panels/EndingScreen";
import { MapPanel } from "./panels/MapPanel";
import { NewspaperPanel } from "./panels/NewspaperPanel";
import { ResultStack } from "./panels/ResultStack";
import { freshId, gameApi, llmMode, type Result } from "./runtime";
import { validationMessage } from "./validation";

// 画面全体（SPEC §12.2）。ゲームの進行は TurnMachine（runtime.gameApi）に任せ、ここは表示と計測だけ。

type Phase = "playing" | "resolving" | "result" | "ended";

const SESSION_ID = freshId();

const errorText = (result: Result<GameState>): string | null =>
  Either.isLeft(result)
    ? result.left._tag === "ValidationError"
      ? validationMessage(result.left.issue)
      : messages.ui.errors.unexpected
    : null;

export function App() {
  const [game, setGame] = useState<GameState | null>(null);
  const [phase, setPhase] = useState<Phase>("playing");
  const [candidates, setCandidates] = useState<readonly string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const gameId = useRef(freshId());
  const restartIndex = useRef(0);
  const readySince = useRef(performance.now());

  const begin = useCallback((state: GameState, resumed: boolean) => {
    setGame(state);
    setPhase(state.ending === null ? "playing" : "ended");
    readySince.current = performance.now();
    gameApi.log({
      event: "game.start",
      data: { sessionId: SESSION_ID, gameId: gameId.current, seed: state.seed, restartIndex: restartIndex.current, resumed },
    });
  }, []);

  // 起動：セーブがあれば続きから、なければ新しく
  useEffect(() => {
    gameApi.log({ event: "session.start", data: { sessionId: SESSION_ID, llmMode } });
    void gameApi.load().then(async (saved) => {
      if (saved !== null && saved.ending === null) begin(saved, true);
      else begin(await gameApi.start(), false);
    });
  }, [begin]);

  // 任命候補は状態が変わるたびに取り直す（同じ年なら同じ顔ぶれ）
  useEffect(() => {
    if (game === null) return;
    void gameApi.candidates(game).then(setCandidates);
  }, [game]);

  const lastRecord: TurnRecord | null = game?.history.at(-1) ?? null;
  const map = useMemo(() => (game === null ? null : mapOf(game)), [game]);

  const submit = async (decree: Decree, intent: IntentDeclaration | null) => {
    if (game === null) return;
    gameApi.log({
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
    const result = await gameApi.play(game, decree, intent);
    if (Either.isLeft(result)) {
      setError(errorText(result));
      setPhase("playing");
      return;
    }
    const next = result.right;
    const record = next.history.at(-1);
    gameApi.log({
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
    if (next.ending !== null) {
      gameApi.log({ event: "game.end", data: { gameId: gameId.current, turns: game.turn, ending: next.ending } });
    }
    setGame(next);
    setPhase("result");
  };

  const closeResult = (stats: { flips: number; deepestSheet: number }) => {
    if (game === null || lastRecord === null) return;
    gameApi.log({ event: "result.closed", data: { gameId: gameId.current, turn: lastRecord.turn, ...stats } });
    setPhase(game.ending === null ? "playing" : "ended");
    readySince.current = performance.now();
  };

  const restart = async () => {
    if (game !== null) {
      gameApi.log({ event: "game.restart", data: { gameId: gameId.current, turn: game.turn, ended: game.ending !== null } });
    }
    setConfirmRestart(false);
    gameId.current = freshId();
    restartIndex.current += 1;
    begin(await gameApi.start(), false);
  };

  const appoint = async (candidateId: string) => {
    if (game === null) return;
    const result = await gameApi.appoint(game, candidateId);
    if (Either.isRight(result)) {
      gameApi.log({ event: "aide.appointed", data: { gameId: gameId.current, turn: game.turn, aideId: candidateId } });
      setGame(result.right);
    }
    setError(errorText(result));
  };

  const dismiss = async (aideId: string) => {
    if (game === null) return;
    const result = await gameApi.dismiss(game, aideId);
    if (Either.isRight(result)) {
      gameApi.log({ event: "aide.dismissed", data: { gameId: gameId.current, turn: game.turn, aideId } });
      setGame(result.right);
    }
    setError(errorText(result));
  };

  const exportLog = () => {
    const blob = new Blob([gameApi.exportLog()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `imperial-decree-log-${SESSION_ID}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (game === null || map === null) return <div className="desk loading">{messages.ui.loading}</div>;

  const ui = messages.ui;
  const busy = phase !== "playing";
  const hasAide = game.aides.length > 0;
  return (
    <div className="desk">
      <header className="desk-header">
        <h1 className="title">{ui.title}</h1>
        <span className="year" data-testid="year">
          {ui.year(game.turn)}
        </span>
        <span className="capital" aria-label={ui.politicalCapital}>
          {ui.politicalCapital}
          <span className="pips" data-testid="capital">
            {Array.from({ length: POLITICAL_CAPITAL_MAX }, (_, i) => (
              <span key={i} className={i < game.politicalCapital ? "pip filled" : "pip"} />
            ))}
          </span>
        </span>
        <span className="spacer" />
        {confirmRestart ? (
          <span className="confirm">
            {ui.newGameConfirm}
            <button className="button danger" onClick={() => void restart()}>
              {ui.confirm}
            </button>
            <button className="button" onClick={() => setConfirmRestart(false)}>
              {ui.cancel}
            </button>
          </span>
        ) : (
          <button className="button subtle on-wood" onClick={() => setConfirmRestart(true)}>
            {ui.newGame}
          </button>
        )}
        <button className="button subtle on-wood" onClick={exportLog}>
          {ui.exportLog}
        </button>
      </header>

      <main className="desk-grid">
        <div className="desk-column">
          <NewspaperPanel article={lastRecord?.newspaper ?? null} />
          <AidePanel
            aides={game.aides}
            reports={lastRecord?.aideReports ?? []}
            candidates={candidates}
            politicalCapital={game.politicalCapital}
            disabled={busy}
            onAppoint={(id) => void appoint(id)}
            onDismiss={(id) => void dismiss(id)}
          />
        </div>
        <div className="desk-column">
          <MapPanel map={map} />
          <DecreePanel
            turn={game.turn}
            busy={busy}
            thinking={phase === "resolving"}
            hasAide={hasAide}
            canIssue={!hasAide || game.politicalCapital >= DECREE_POLITICAL_COST}
            onSubmit={(decree, intent) => void submit(decree, intent)}
          />
          {error !== null && <p className="warning-text">{error}</p>}
        </div>
      </main>

      {phase === "result" && lastRecord !== null && <ResultStack record={lastRecord} onClose={closeResult} />}
      {phase === "ended" && game.ending !== null && (
        <EndingScreen ending={game.ending} turns={game.turn - 1} onRestart={() => void restart()} />
      )}
    </div>
  );
}
