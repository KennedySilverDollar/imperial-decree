import { useEffect, useMemo, useReducer, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ZONES } from "../../domain/Landscape";
import { MapRefContext, type MapRef } from "../reading/mapRefs";
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
import { endingStyleOf, type EndingStyle } from "../transitions/TurnSequence";
import { useTurnSequence } from "../transitions/useTurnSequence";
import { AudioService } from "../audio/AudioService";
import { STAMP_HIT_AT } from "./deskConstants";
import { weatherOf, type Weather } from "../transitions/weather";

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
  /** 開発用：遷移の演出をゆっくりにする倍率（?seqscale） */
  readonly sequenceScale?: number;
  /** 音の係（テストで差し替える。無ければ机が作る） */
  readonly audio?: AudioService;
}

/** 新聞の面の数（第一面と二面） */
const newspaperPageCount = (record: TurnRecord): number => newspaperPages(record.newspaper.articles.map((a) => ({ sectionId: a.section }))).length;

const attachmentKind = (a: NoteAttachment | null): "none" | "article" | "aideReport" | "parcel" => (a === null ? "none" : a.kind);

export function Desk({ session, settings, onSettings, systemReducedMotion, fpsFromQuery, adaptive, notesStorage, surveyDelay, sequenceScale = 1, audio }: Props) {
  const { game, phase, lastRecord, map, candidates, error, actions } = session;
  const [desk, dispatch] = useReducer(deskReducer, "", initialDeskState);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [lowPower, setLowPower] = useState(false);
  const [instant, setInstant] = useState(false);
  const stage = useStageSize();
  const [notes, updateNotes] = usePlayerNotes(notesStorage, game?.saveId ?? null);
  const transitionUntil = useRef(0);
  /** 押印した年（結果が届いたかを、この年の記録で確かめる） */
  const submittedTurn = useRef<number | null>(null);
  // 音（§8.1）：最初のクリック・キーで鳴らせるようにし、設定の音量と、窓の天候の環境音を合わせる
  const [sound] = useState(() => audio ?? new AudioService());
  useEffect(() => {
    const unlock = () => sound.unlock();
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      if (audio === undefined) sound.dispose();
    };
  }, [sound, audio]);
  useEffect(() => sound.setVolumes(settings.volume), [sound, settings.volume]);
  /** 並べ読み（§4.6）：かざしている地名・建物の名（地図の該当区画を朱でほのかに示す） */
  const [mapRef, setMapRef] = useState<MapRef | null>(null);
  const saveIdForRefs = game?.saveId ?? null;
  const zoneTerms = useMemo(
    () => (saveIdForRefs === null ? [] : ZONES.map((zone) => ({ term: gazetteerFor(saveIdForRefs).zones[zone], ref: { kind: "zone" as const, zone } }))),
    [saveIdForRefs],
  );
  /** 窓の光の天候：遷移の「窓の光」の段で新しい年のものに替える */
  const [weather, setWeather] = useState<Weather>(() => weatherOf(lastRecord?.newspaper ?? null));

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

  // ターン遷移シーケンス（§4.5）：押印 → 既決箱 → 窓の光 → 地図 → 配達 → 台帳（またはエンディング）。
  // 結果の書類束は、シーケンスが終わってから手元に来る
  const resultReady = submittedTurn.current !== null && lastRecord?.turn === submittedTurn.current && (phase === "result" || phase === "ended");
  const endingStyle: EndingStyle | null = resultReady ? endingStyleOf(game?.ending ?? null) : null;
  const sequence = useTurnSequence({
    reduced: resolveReducedMotion(settings.motion, systemReducedMotion),
    scale: sequenceScale,
    result: { ready: resultReady, ending: endingStyle },
    onStep: (step) => {
      if (step === "weather" || step === "map") setWeather(weatherOf(lastRecordRef.current?.newspaper ?? null));
      // 音（§8.1）：押印の瞬間の打撃・地図のペン先・配達の足音と書類・台帳の書き込み・町の印章
      const seconds = sequenceStepMsRef.current / 1000;
      if (step === "stamp") sound.play("stamp", reducedRef.current ? 0 : seconds * STAMP_HIT_AT);
      else if (step === "map") sound.playFor("pen", seconds);
      else if (step === "delivery") {
        sound.play("footsteps");
        sound.play("delivered", Math.min(0.5, seconds * 0.4));
      } else if (step === "ledger") sound.playFor("pen", seconds * 0.8, 0.18);
      else if (step === "ending" && endingStyleRef.current === "seal") sound.play("stamp", 0.2);
    },
    onDone: () => {
      setWeather(weatherOf(lastRecordRef.current?.newspaper ?? null));
      const record = lastRecordRef.current;
      submittedTurn.current = null;
      if (record !== null && phaseRef.current === "result") dispatch({ type: "resultArrived", turn: record.turn });
    },
  });
  const sequenceStepMsRef = useRef(0);
  sequenceStepMsRef.current = sequence.stepMs;
  const reducedRef = useRef(false);
  reducedRef.current = resolveReducedMotion(settings.motion, systemReducedMotion);
  const endingStyleRef = useRef<EndingStyle | null>(null);
  endingStyleRef.current = endingStyle;
  const lastRecordRef = useRef(lastRecord);
  lastRecordRef.current = lastRecord;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  // 差し戻し（検証エラー）で受付に戻ったら、押した判を消して書き直せるようにする（遷移も止める）
  const cancelSequence = sequence.cancel;
  useEffect(() => {
    if (phase !== "playing") return;
    dispatch({ type: "stampEnd" });
    if (submittedTurn.current !== null && lastRecordRef.current?.turn !== submittedTurn.current) {
      submittedTurn.current = null;
      cancelSequence();
    }
  }, [phase, cancelSequence]);

  // 「既決箱へ」の段：勅令用紙が机に戻り終えたところで、既決箱までの画面上のずれを測り、CSS の動き（.seq-file）に渡す
  useEffect(() => {
    if (sequence.step !== "file") return;
    const measure = () => {
      const sheet = document.querySelector<HTMLElement>('[data-object="decree"]');
      const box = document.querySelector<HTMLElement>('[data-object="archive"]');
      if (!sheet || !box) return;
      const a = sheet.getBoundingClientRect();
      const b = box.getBoundingClientRect();
      sheet.style.setProperty("--file-dx", `${Math.round(b.left + b.width / 2 - (a.left + a.width / 2))}px`);
      sheet.style.setProperty("--file-dy", `${Math.round(b.top + b.height / 2 - (a.top + a.height / 2))}px`);
    };
    const wait = window.setTimeout(measure, mode === "3d" ? timings.focusMs : 0);
    return () => window.clearTimeout(wait);
  }, [sequence.step, mode, timings.focusMs]);

  useEffect(() => sound.setAmbience(weather.season, weather.sky), [sound, weather]);

  // 手に取る・置く音（新聞は大きな紙の音）
  const previousFocus = useRef(desk.focused);
  useEffect(() => {
    const before = previousFocus.current;
    previousFocus.current = desk.focused;
    if (desk.focused === before) return;
    if (desk.focused !== null) sound.play(desk.focused === "newspaper" ? "newspaper" : "pickUp");
    else sound.play("putDown");
  }, [desk.focused, sound]);

  // 始め直したら窓の光も着任時に戻す
  useEffect(() => {
    if (lastRecord === null) setWeather(weatherOf(null));
  }, [lastRecord]);

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

  const stamp = () => {
    if (!check.ready || !decreeInHand || check.declaration === "invalid" || sequence.step !== null) return;
    const { decree } = check;
    const intent = check.declaration;
    dispatch({ type: "stampStart" });
    submittedTurn.current = game?.turn ?? null;
    // 押印の段が終わったら、用紙を机に戻して執行する（勅令用紙は次の段で既決箱へ）
    sequence.start(() => {
      if (mode === "3d") dispatch({ type: "putDown" });
      void actions.submit(decree, intent);
    });
  };

  /** ← →：手元の書類をめくる */
  const page = (delta: -1 | 1) => {
    if (game === null) return;
    if (desk.focused !== null) sound.play("pageTurn");
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
    sequence.skip();
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
  const sequenceActive = useRef(false);
  sequenceActive.current = sequence.step !== null;
  const runRef = useRef(run);
  runRef.current = run;
  const ctx = useRef<{ mode: "flat" | "3d"; focused: PickableId | null; blocked: boolean }>({ mode, focused: desk.focused, blocked: false });
  ctx.current = { mode, focused: mode === "flat" && desk.focused !== "result" ? null : desk.focused, blocked: phase === "ended" || settingsOpen };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || ctx.current.blocked) return;
      const animating = sequenceActive.current || performance.now() < transitionUntil.current;
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
        return <Lamp out={lampOut} />;
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
          <>
            <MapPanel
            game={game}
            notes={notes}
            live={interactive}
            interactive={interactive}
            selected={desk.mapSelection}
            onSelect={(gridIndex) => dispatch({ type: "selectParcel", gridIndex })}
            onPin={(text, gridIndex) => tearNote(text, { kind: "parcel", gridIndex })}
            surveyDelay={surveyDelay}
            hold={holdMap}
            highlight={refsActive ? mapRef : null}
            inkMs={sequence.step === "map" ? sequence.stepMs : null}
          />
            {sealShown && (
              <div className="town-seal" aria-hidden data-testid="town-seal">
                {ui.ending.seal}
              </div>
            )}
          </>
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
              sound.play("waxCrack");
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
            onFlip={(to, count) => {
              sound.play("pageTurn");
              dispatch({ type: "flip", turn: lastRecord.turn, to, sheetCount: count });
            }}
            inHand={interactive && desk.focused === "result"}
            onClose={putDown}
          />
        );
      case "decree":
        return (
          <DecreePanel
            draft={desk.draft}
            check={check}
            onDraft={(draft) => {
              // 筆記音（入力1文字ごと、間引いて）と、付箋を貼る音
              if ([...draft.text].length > [...desk.draft.text].length) sound.play("brush");
              if ((Object.keys(draft.tags) as (keyof typeof draft.tags)[]).some((k) => draft.tags[k] !== "" && draft.tags[k] !== desk.draft.tags[k])) sound.play("sticky");
              dispatch({ type: "draft", draft });
            }}
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

  // 遷移の段ごとの見た目は CSS（desk.css の .seq-*）。地図は「地図の更新」の段まで前の年のまま
  const step = sequence.step;
  const holdMap = step === "stamp" || step === "file" || step === "waiting" || step === "weather";
  const endingShown = phase === "ended" && game.ending !== null && step === null;
  // 終わった年は、演出の後も（最後の結果束を読むあいだも、エンディングの画面でも）ランプは消えたまま・印章は押されたまま
  const finished = game.ending !== null && step === null;
  const finalStyle = endingStyleOf(game.ending);
  const lampOut = (step === "ending" && endingStyle === "lampOut") || (finished && finalStyle === "lampOut");
  const sealShown = (step === "ending" && endingStyle === "seal") || (finished && finalStyle === "seal");

  // 並べ読みは、地図が書類と並んで見えているとき（立体の机の並べ読み・平面モード）だけ
  const refsActive = mode === "flat" || (desk.sideBySide && desk.focused !== null);
  const refs = { active: refsActive, zones: zoneTerms, onRef: setMapRef };

  const rootStyle: CSSProperties & Record<string, string | number> = {
    "--seq-ms": `${sequence.stepMs}ms`,
    "--focus-ms": `${timings.focusMs}ms`,
    "--reduced-fade-ms": `${timings.fadeMs}ms`,
    "--stamp-ms": `${timings.stampMs}ms`,
    "--text-zoom": TEXT_SCALES[settings.textSize],
  };

  return (
    <div
      className={`desk mode-${mode} ${reduced ? "reduce-motion" : ""} ${lowPower ? "low-power" : ""} ${step === null ? "" : `in-sequence seq-${step}`} ${lampOut ? "lamp-out" : ""}`}
      style={rootStyle}
      data-testid="desk"
      data-sequence-step={step ?? "idle"}
      data-sequence-total-ms={sequence.lastTotalMs === null ? undefined : Math.round(sequence.lastTotalMs)}
      data-weather={`${weather.season} ${weather.sky}`}
    >
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

      <MapRefContext.Provider value={refs}>
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
          weather={weather}
        />
      ) : (
        <FlatDesk objects={objects} render={render} desk={desk} onPick={pickUp} onPutDown={putDown} weather={weather} />
      )}
      </MapRefContext.Provider>

      {step !== null && (
        <button className="sequence-skip" onClick={skip} aria-label={ui.sequence.skipLabel} data-testid="sequence-skip">
          <span className="sequence-skip-hint">{step === "waiting" ? ui.sequence.waiting : ui.sequence.skipHint}</span>
        </button>
      )}
      {endingShown && (
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
