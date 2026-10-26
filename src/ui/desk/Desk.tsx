import { useEffect, useReducer, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { DECREE_POLITICAL_COST } from "../../domain/constants";
import { messages } from "../../i18n/messages";
import { FpsOverlay } from "../dev/FpsOverlay";
import { useFpsMonitor } from "../dev/fps";
import type { GameSession } from "../game/useGameSession";
import { AidePanel } from "../panels/AidePanel";
import { DecreePanel } from "../panels/DecreePanel";
import { EndingScreen } from "../panels/EndingScreen";
import { LedgerPanel } from "../panels/LedgerPanel";
import { MapPanel } from "../panels/MapPanel";
import { NewspaperPanel } from "../panels/NewspaperPanel";
import { ResultStack, sheetCountOf } from "../panels/ResultStack";
import { resolveReducedMotion, type Settings } from "../settings/settings";
import { SettingsPanel } from "../settings/SettingsPanel";
import { checkDraft } from "./decreeDraft";
import { HEADER_HEIGHT_PX, TEXT_SCALES } from "./deskConstants";
import { deskReducer, freshResultView, initialDeskState, sheetKey } from "./deskState";
import { DeskStage } from "./DeskStage";
import { FlatDesk } from "./FlatDesk";
import { commandForKey, keyTargetOf, type KeyCommand } from "./keyboard";
import { motionTimings } from "./motion";
import { DESK_OBJECT_IDS, type DeskObjectId, type PickableId } from "./objects";
import { Lamp } from "./objects/Lamp";
import { StampObject } from "./objects/StampObject";

// 執務机の全体（SPEC_v3.3 §3・§4・§9）。ゲームの状態は GameSession から読むだけで、
// 机の UI 状態（手元・重なり・書きかけ・めくり位置）は deskReducer が持つ（GameState には入れない）。
// 立体（DeskStage）と平面（FlatDesk）は同じ書類（render）を並べ方だけ変えて描くので、表示される情報は同じになる。

const useStageSize = () => {
  const read = () => ({ width: window.innerWidth, height: Math.max(320, window.innerHeight - HEADER_HEIGHT_PX) });
  const [size, setSize] = useState(read);
  useEffect(() => {
    const onResize = () => setSize(read());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return size;
};

interface Props {
  readonly session: GameSession;
  readonly settings: Settings;
  readonly onSettings: (patch: Partial<Settings>) => void;
  readonly systemReducedMotion: boolean;
  /** ?fps で FPS を出す（設定の showFps とどちらでもよい） */
  readonly fpsFromQuery: boolean;
  /** 45fps を下回り続けたら演出を切る（§9） */
  readonly adaptive: boolean;
}

export function Desk({ session, settings, onSettings, systemReducedMotion, fpsFromQuery, adaptive }: Props) {
  const { game, phase, lastRecord, map, candidates, error, actions } = session;
  const [desk, dispatch] = useReducer(deskReducer, "", initialDeskState);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [lowPower, setLowPower] = useState(false);
  const [instant, setInstant] = useState(false);
  const stage = useStageSize();
  const stampTimer = useRef<number | null>(null);
  const pendingStamp = useRef<(() => void) | null>(null);
  const transitionUntil = useRef(0);

  const mode: "flat" | "3d" = settings.flat ? "flat" : "3d";
  const reduced = resolveReducedMotion(settings.motion, systemReducedMotion);
  const timings = motionTimings(reduced);
  const showFps = settings.showFps || fpsFromQuery;
  // 性能の自動調整（§9）は立体の机にだけ効かせる
  useFpsMonitor({ onSustainedLow: () => adaptive && mode === "3d" && setLowPower(true) });

  // 年が替わる・始め直すと、新しい勅令用紙にする
  const key = game === null ? "" : sheetKey(game.saveId, game.turn);
  useEffect(() => {
    if (key !== "") dispatch({ type: "newSheet", key });
  }, [key]);

  // 結果の書類束が届いたら手元に来る
  const resultTurn = phase === "result" ? (lastRecord?.turn ?? null) : null;
  useEffect(() => {
    if (resultTurn !== null) dispatch({ type: "resultArrived", turn: resultTurn });
  }, [resultTurn]);

  // 差し戻し（検証エラー）で受付に戻ったら、押した判を消して書き直せるようにする
  useEffect(() => {
    if (phase === "playing") dispatch({ type: "stampEnd" });
  }, [phase]);

  // 始め直して束が無くなったら手元から下ろす
  useEffect(() => {
    if (lastRecord === null && desk.focused === "result") dispatch({ type: "putDown" });
  }, [lastRecord, desk.focused]);

  useEffect(() => {
    transitionUntil.current = performance.now() + timings.focusMs;
  }, [desk.focused, desk.sideBySide, timings.focusMs]);

  useEffect(
    () => () => {
      if (stampTimer.current !== null) window.clearTimeout(stampTimer.current);
    },
    [],
  );

  const busy = phase !== "playing";
  const hasAide = (game?.aides.length ?? 0) > 0;
  const canIssue = game !== null && (!hasAide || game.politicalCapital >= DECREE_POLITICAL_COST);
  const locked = busy || desk.stamping;
  const check = checkDraft(desk.draft, { canIssue, locked });
  const decreeInHand = mode === "flat" || desk.focused === "decree";
  const resultView = lastRecord === null ? null : desk.result?.turn === lastRecord.turn ? desk.result : freshResultView(lastRecord.turn);

  const putDown = () => {
    if (desk.focused === "result" && phase === "result" && resultView !== null) {
      actions.closeResult({ flips: resultView.flips, deepestSheet: resultView.deepest + 1 });
    }
    dispatch({ type: "putDown" });
  };

  const pickUp = (id: PickableId) => {
    if (id === "result" && lastRecord === null) return;
    if (mode === "flat" && id !== "result") {
      // 平面では全部が見えているので、その書類まで移ってキーボードの焦点を置くだけ
      const el = document.querySelector<HTMLElement>(`.flat-object[data-object="${id}"]`);
      el?.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
      el?.focus({ preventScroll: true });
      return;
    }
    if (desk.focused === id) return;
    // 届いた結果を読み終えずに別の書類を取ったら、結果の束は机に戻したことにする
    if (desk.focused === "result" && phase === "result") putDown();
    dispatch({ type: "pickUp", id });
  };

  const finishStamp = () => {
    if (stampTimer.current !== null) window.clearTimeout(stampTimer.current);
    stampTimer.current = null;
    const run = pendingStamp.current;
    pendingStamp.current = null;
    run?.();
  };

  const stamp = () => {
    if (!check.ready || !decreeInHand || check.declaration === "invalid") return;
    const { decree } = check;
    const intent = check.declaration;
    dispatch({ type: "stampStart" });
    pendingStamp.current = () => {
      if (mode === "3d") dispatch({ type: "putDown" });
      void actions.submit(decree, intent);
    };
    stampTimer.current = window.setTimeout(finishStamp, timings.stampMs);
  };

  const skip = () => {
    if (pendingStamp.current !== null) finishStamp();
    setInstant(true);
    requestAnimationFrame(() => setInstant(false));
  };

  const run = (command: KeyCommand) => {
    switch (command.kind) {
      case "pickUp":
        return pickUp(command.id);
      case "putDown":
        return putDown();
      case "toggleSideBySide":
        return dispatch({ type: "toggleSideBySide" });
      case "page":
        if (lastRecord !== null && resultView !== null) {
          dispatch({ type: "flip", turn: lastRecord.turn, to: resultView.top + command.delta, sheetCount: sheetCountOf(lastRecord) });
        }
        return;
      case "stamp":
        return stamp();
      case "skip":
        return skip();
    }
  };

  // §4.7 のキー操作。エンディングと設定の画面が開いている間は机に届けない
  const runRef = useRef(run);
  runRef.current = run;
  const ctx = useRef<{ mode: "flat" | "3d"; focused: PickableId | null; blocked: boolean }>({ mode, focused: desk.focused, blocked: false });
  ctx.current = { mode, focused: mode === "flat" && desk.focused !== "result" ? null : desk.focused, blocked: phase === "ended" || settingsOpen };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || ctx.current.blocked) return;
      const animating = pendingStamp.current !== null || performance.now() < transitionUntil.current;
      const command = commandForKey(
        { key: e.key, isComposing: e.isComposing, target: keyTargetOf(e.target), modifiers: e.ctrlKey || e.metaKey || e.altKey },
        { mode: ctx.current.mode, focused: ctx.current.focused, animating },
      );
      if (command === null) return;
      e.preventDefault();
      runRef.current(command);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (game === null || map === null) return <div className="desk loading">{messages.ui.loading}</div>;

  const ui = messages.ui;
  const objects = DESK_OBJECT_IDS.filter((id) => id !== "result" || lastRecord !== null);

  const render = (id: DeskObjectId, interactive: boolean): ReactNode => {
    switch (id) {
      case "lamp":
        return <Lamp />;
      case "ledger":
        return <LedgerPanel params={game.params} delta={lastRecord?.actualResult ?? null} politicalCapital={game.politicalCapital} />;
      case "map":
        return (
          <MapPanel
            map={map}
            works={game.projects.map((p) => ({ id: p.id, building: p.kind, count: p.count, repair: p.repair, orderedTurn: p.orderedTurn }))}
          />
        );
      case "letters":
        return (
          <AidePanel
            aides={game.aides}
            reports={lastRecord?.aideReports ?? []}
            candidates={candidates}
            politicalCapital={game.politicalCapital}
            disabled={busy || !interactive}
            onAppoint={(candidateId) => void actions.appoint(candidateId)}
            onDismiss={(aideId) => void actions.dismiss(aideId)}
          />
        );
      case "newspaper":
        return <NewspaperPanel newspaper={lastRecord?.newspaper ?? null} onRead={actions.logNewspaperRead} onLettersRead={actions.logLettersRead} />;
      case "result":
        return lastRecord === null ? null : (
          <ResultStack
            record={lastRecord}
            top={resultView?.top ?? 0}
            onFlip={(to, count) => dispatch({ type: "flip", turn: lastRecord.turn, to, sheetCount: count })}
            inHand={interactive && desk.focused === "result"}
            onClose={putDown}
          />
        );
      case "decree":
        return (
          <DecreePanel
            draft={desk.draft}
            check={check}
            onDraft={(draft) => dispatch({ type: "draft", draft })}
            interactive={interactive}
            locked={locked}
            stamping={desk.stamping}
            thinking={phase === "resolving"}
            canIssue={canIssue}
            hasAide={hasAide}
            error={error}
            onEnter={stamp}
          />
        );
      case "stamp":
        return <StampObject ready={interactive && check.ready && decreeInHand} stamping={desk.stamping} onStamp={stamp} />;
    }
  };

  const rootStyle: CSSProperties & Record<string, string | number> = {
    "--focus-ms": `${timings.focusMs}ms`,
    "--reduced-fade-ms": `${timings.fadeMs}ms`,
    "--stamp-ms": `${timings.stampMs}ms`,
    "--text-zoom": TEXT_SCALES[settings.textSize],
  };

  return (
    <div className={`desk mode-${mode} ${reduced ? "reduce-motion" : ""} ${lowPower ? "low-power" : ""}`} style={rootStyle} data-testid="desk">
      <header className="desk-header">
        <h1 className="title">{ui.title}</h1>
        <span className="year" data-testid="year">
          {ui.year(game.turn)}
        </span>
        {mode === "3d" && <span className="keys-hint">{ui.desk.keysHint}</span>}
        <span className="spacer" />
        {confirmRestart ? (
          <span className="confirm">
            {ui.newGameConfirm}
            <button
              className="button danger"
              onClick={() => {
                setConfirmRestart(false);
                void actions.restart();
              }}
            >
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
        <button className="button subtle on-wood" onClick={() => setSettingsOpen(true)} data-testid="open-settings">
          {ui.settings.open}
        </button>
        <a className="button subtle on-wood" href="?debug" data-testid="debug-link">
          {ui.debug.link}
        </a>
        <button className="button subtle on-wood" onClick={() => downloadLog(actions.exportLog(), session.sessionId)}>
          {ui.exportLog}
        </button>
      </header>

      {mode === "3d" ? (
        <DeskStage
          objects={objects}
          render={render}
          desk={desk}
          stage={stage}
          onPick={pickUp}
          onPutDown={putDown}
          parallax={!reduced && !lowPower}
          richLighting={!lowPower}
          instant={instant}
        />
      ) : (
        <FlatDesk objects={objects} render={render} desk={desk} onPick={pickUp} onPutDown={putDown} />
      )}

      {phase === "ended" && game.ending !== null && (
        <EndingScreen ending={game.ending} turns={game.turn - 1} onRestart={() => void actions.restart()} />
      )}
      {settingsOpen && <SettingsPanel settings={settings} onChange={onSettings} lowPower={lowPower} onClose={() => setSettingsOpen(false)} />}
      {showFps && <FpsOverlay lowPower={lowPower} />}
    </div>
  );
}

const downloadLog = (json: string, sessionId: string) => {
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `imperial-decree-log-${sessionId}.json`;
  link.click();
  URL.revokeObjectURL(url);
};
