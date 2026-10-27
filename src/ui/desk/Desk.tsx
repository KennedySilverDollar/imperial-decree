import { useEffect, useReducer, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { DECREE_POLITICAL_COST } from "../../domain/constants";
import { addNote, attachNote, notesAttachedTo, noteLength, type NoteAttachment, type PlayerNote } from "../../domain/PlayerNotes";
import type { TurnRecord } from "../../domain/TurnRecord";
import { aideName } from "../../i18n/messages";
import { messages } from "../../i18n/messages";
import { FpsOverlay } from "../dev/FpsOverlay";
import { useFpsMonitor } from "../dev/fps";
import type { GameSession } from "../game/useGameSession";
import { AidePanel } from "../panels/AidePanel";
import { DecreePanel } from "../panels/DecreePanel";
import { EndingScreen } from "../panels/EndingScreen";
import { LedgerPanel } from "../panels/LedgerPanel";
import { gazetteerFor } from "../../engine/Gazetteer";
import { MapPanel } from "../panels/MapPanel";
import { ArchivePanel } from "../panels/ArchivePanel";
import { NewspaperPanel, newspaperPages } from "../panels/NewspaperPanel";
import { NotepadPanel, targetKeyOf, type NoteTarget } from "../panels/NotepadPanel";
import { usePlayerNotes, type NotesStorage } from "../notes/notesStorage";
import { ResultStack, sheetCountOf } from "../panels/ResultStack";
import { resolveReducedMotion, type Settings } from "../settings/settings";
import { SettingsPanel } from "../settings/SettingsPanel";
import { checkDraft } from "./decreeDraft";
import { HEADER_HEIGHT_PX, TEXT_SCALES } from "./deskConstants";
import { deskReducer, freshResultView, initialDeskState, letterKey, pageKey, sheetKey } from "./deskState";
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
  /** メモの保存先（ゲームのセーブとは別のキー。DECISIONS AA-11） */
  readonly notesStorage: NotesStorage | null;
  /** 測量の遅れ（SPEC_v3.3 §5.9。既定は無効の実験フラグ） */
  readonly surveyDelay: boolean;
}

/** 新聞の面の数（第一面と二面） */
const newspaperPageCount = (record: TurnRecord): number => newspaperPages(record.newspaper.articles.map((a) => ({ sectionId: a.section }))).length;

const attachmentKind = (a: NoteAttachment | null): "none" | "article" | "aideReport" | "parcel" => (a === null ? "none" : a.kind);

export function Desk({ session, settings, onSettings, systemReducedMotion, fpsFromQuery, adaptive, notesStorage, surveyDelay }: Props) {
  const { game, phase, lastRecord, map, candidates, error, actions } = session;
  const [desk, dispatch] = useReducer(deskReducer, "", initialDeskState);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [lowPower, setLowPower] = useState(false);
  const [instant, setInstant] = useState(false);
  const stage = useStageSize();
  const [notes, updateNotes] = usePlayerNotes(notesStorage, game?.saveId ?? null);
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

  // 手に取った回数と手元にあった時間（§13.2）：置いた・持ち替えたときに、前に持っていた物を記録する
  const held = useRef<{ id: PickableId; since: number } | null>(null);
  const logHandled = useRef(actions.logHandled);
  logHandled.current = actions.logHandled;
  useEffect(() => {
    const now = performance.now();
    const previous = held.current;
    if (previous !== null && previous.id !== desk.focused) logHandled.current(previous.id, mode, now - previous.since);
    if (desk.focused !== previous?.id) held.current = desk.focused === null ? null : { id: desk.focused, since: now };
  }, [desk.focused, mode]);

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

  /** ← →：手元の書類をめくる */
  const page = (delta: -1 | 1) => {
    if (game === null) return;
    switch (desk.focused) {
      case "result":
        if (lastRecord !== null && resultView !== null) {
          dispatch({ type: "flip", turn: lastRecord.turn, to: resultView.top + delta, sheetCount: sheetCountOf(lastRecord) });
        }
        return;
      case "newspaper":
        if (lastRecord !== null) {
          const key = pageKey.newspaper(lastRecord.newspaper.turn);
          dispatch({ type: "page", key, to: (desk.pages[key] ?? 0) + delta, count: newspaperPageCount(lastRecord) });
        }
        return;
      case "ledger": {
        const count = game.history.length + 1;
        dispatch({ type: "page", key: pageKey.ledger, to: (desk.pages[pageKey.ledger] ?? count - 1) + delta, count });
        return;
      }
      case "archive": {
        const { turn, doc } = desk.archive;
        const record = game.history.find((r) => r.turn === turn);
        if (record === undefined || doc === "letters") return;
        const key = pageKey.archive(record.turn, doc);
        const count = doc === "result" ? sheetCountOf(record) : newspaperPageCount(record);
        dispatch({ type: "page", key, to: (desk.pages[key] ?? 0) + delta, count });
        return;
      }
      default:
        return;
    }
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
        return page(command.delta);
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

  // メモ：留め先・留めたメモ・ちぎる（LLM にも新聞にも渡さない。セーブとは別に保存するだけ）
  const articleNotes = (turn: number, articleId: string): readonly PlayerNote[] =>
    notes === null ? [] : notesAttachedTo(notes, { kind: "article", turn, articleId });
  const letterNotes = (turn: number, aideId: string): readonly PlayerNote[] =>
    notes === null ? [] : notesAttachedTo(notes, { kind: "aideReport", turn, aideId });
  const selectedParcel: NoteAttachment | null = desk.mapSelection === null ? null : { kind: "parcel", gridIndex: desk.mapSelection };
  const parcelTargets: readonly NoteTarget[] =
    selectedParcel === null
      ? []
      : [{ key: targetKeyOf(selectedParcel), label: ui.notes.parcelPlace(gazetteerFor(game.saveId).parcels[desk.mapSelection ?? 0] ?? ""), attachment: selectedParcel }];
  const noteTargets: readonly NoteTarget[] =
    lastRecord === null
      ? parcelTargets
      : [
          ...parcelTargets,
          ...lastRecord.newspaper.articles.map((a) => {
            const attachment: NoteAttachment = { kind: "article", turn: lastRecord.newspaper.turn, articleId: a.id };
            return { key: targetKeyOf(attachment), label: ui.notes.articlePlace(attachment.turn, a.headline), attachment };
          }),
          ...lastRecord.aideReports.map((r) => {
            const attachment: NoteAttachment = { kind: "aideReport", turn: lastRecord.turn, aideId: r.aideId };
            return { key: targetKeyOf(attachment), label: ui.notes.letterPlace(attachment.turn, aideName(r.aideId)), attachment };
          }),
        ];
  const placeOf = (a: NoteAttachment | null): string => {
    if (a === null) return ui.notes.loose;
    if (a.kind === "parcel") return ui.notes.parcelPlace(gazetteerFor(game.saveId).parcels[a.gridIndex] ?? "");
    const record = game.history.find((r) => r.turn === a.turn);
    if (a.kind === "aideReport") return ui.notes.letterPlace(a.turn, aideName(a.aideId));
    const article = record?.newspaper.articles.find((x) => x.id === a.articleId);
    return ui.notes.articlePlace(a.turn, article?.headline ?? a.articleId);
  };
  const tearNote = (text: string, attachment: NoteAttachment | null) =>
    updateNotes((current) => {
      const next = addNote(current, { id: crypto.randomUUID(), text, turnCreated: game.turn, attachedTo: attachment });
      if (next.issue === null) actions.logNote("note.created", noteLength(text.trim()), attachmentKind(attachment));
      return next.notes;
    });
  const moveNote = (id: string, attachment: NoteAttachment | null) => {
    const note = notes?.notes.find((n) => n.id === id);
    updateNotes((current) => attachNote(current, id, attachment));
    actions.logNote("note.attached", noteLength(note?.text ?? ""), attachmentKind(attachment));
  };

  const render = (id: DeskObjectId, interactive: boolean): ReactNode => {
    switch (id) {
      case "lamp":
        return <Lamp />;
      case "ledger":
        return (
          <LedgerPanel
            params={game.params}
            politicalCapital={game.politicalCapital}
            history={game.history}
            page={desk.pages[pageKey.ledger] ?? null}
            onPage={(to, count) => dispatch({ type: "page", key: pageKey.ledger, to, count })}
            interactive={interactive}
          />
        );
      case "map":
        return (
          <MapPanel
            game={game}
            notes={notes}
            live={interactive}
            interactive={interactive}
            selected={desk.mapSelection}
            onSelect={(gridIndex) => dispatch({ type: "selectParcel", gridIndex })}
            onPin={(text, gridIndex) => tearNote(text, { kind: "parcel", gridIndex })}
            surveyDelay={surveyDelay}
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
            canOpen={interactive}
            opened={(aideId) => lastRecord !== null && desk.opened.includes(letterKey(lastRecord.turn, aideId))}
            onOpen={(aideId) => {
              if (lastRecord === null) return;
              dispatch({ type: "openLetter", key: letterKey(lastRecord.turn, aideId) });
              actions.logLetterOpened(aideId);
            }}
            notesFor={(aideId) => (lastRecord === null ? [] : letterNotes(lastRecord.turn, aideId))}
            onAppoint={(candidateId) => void actions.appoint(candidateId)}
            onDismiss={(aideId) => void actions.dismiss(aideId)}
          />
        );
      case "newspaper":
        return (
          <NewspaperPanel
            newspaper={lastRecord?.newspaper ?? null}
            page={lastRecord === null ? 0 : (desk.pages[pageKey.newspaper(lastRecord.newspaper.turn)] ?? 0)}
            onPage={(to, count) => lastRecord !== null && dispatch({ type: "page", key: pageKey.newspaper(lastRecord.newspaper.turn), to, count })}
            interactive={interactive}
            notesFor={(articleId) => (lastRecord === null ? [] : articleNotes(lastRecord.newspaper.turn, articleId))}
            onRead={(reading) => actions.logNewspaperRead({ ...reading, context: "desk" })}
            onLettersRead={actions.logLettersRead}
          />
        );
      case "notepad":
        return notes === null ? null : (
          <NotepadPanel
            notes={notes}
            draft={desk.noteDraft}
            onDraft={(draft) => dispatch({ type: "noteDraft", draft })}
            targets={noteTargets}
            placeOf={placeOf}
            onTear={tearNote}
            onAttach={moveNote}
            interactive={interactive}
          />
        );
      case "archive": {
        const { turn, doc } = desk.archive;
        return (
          <ArchivePanel
            history={game.history}
            turn={turn}
            doc={doc}
            onSelect={(t, d) => dispatch({ type: "archive", turn: t, doc: d })}
            page={turn === null ? 0 : (desk.pages[pageKey.archive(turn, doc)] ?? 0)}
            onPage={(to, count) => turn !== null && dispatch({ type: "page", key: pageKey.archive(turn, doc), to, count })}
            interactive={interactive}
            articleNotes={articleNotes}
            letterNotes={letterNotes}
            onRead={(reading) => actions.logNewspaperRead({ ...reading, context: "archive" })}
            onLettersRead={actions.logLettersRead}
          />
        );
      }
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
