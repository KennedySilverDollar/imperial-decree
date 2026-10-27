import Phaser from "phaser";
import { useEffect, useMemo, useRef, useState } from "react";
import { BUILDING_IDS, type BuildingId } from "../../domain/Buildings";
import { NOTE_CHAR_LIMIT } from "../../domain/constants";
import type { GameState } from "../../domain/GameState";
import { noteLength, validateNoteText, type PlayerNotes } from "../../domain/PlayerNotes";
import { gazetteerFor } from "../../engine/Gazetteer";
import { aideName, messages } from "../../i18n/messages";
import type { Point } from "../map/geometry2d";
import { MAP_PX, MAP_SNAPSHOT, MAP_VIEW, MAP_ZOOM_LEVELS } from "../map/mapConstants";
import { MapScene } from "../map/MapScene";
import { drawSnapshot } from "../map/MapSnapshot";
import { relatedToParcel } from "../map/parcelRecords";
import { PICTOGRAM_BOX, PICTOGRAM_STROKE, PICTOGRAMS } from "../map/pictograms";
import { buildSurveyModel, type ParcelView } from "../map/surveyModel";
import { paintFresh, parcelAt } from "../map/SurveyRenderer";
import { useSurvey } from "../map/useSurvey";
import { gridCoordOf, zoneOf } from "../../domain/Landscape";
import type { MapRef } from "../reading/mapRefs";
import { FOCUS_TRANSITION_MS } from "../desk/deskConstants";

// 領地の測量図（SPEC_v3.3 §5）。机に置いてあるときは測量図の静止画、手元（と平面モード）では Phaser のライブの地図。
// 区画にかざすと区画名と建物名の小札（派生指標は出さない：不変条件13）、押すとその区画に関係する過去の記事と報告、
// 区画にメモを留められる（§7）。普請中の案件は「何を発注したか」だけを出す（工期・進み具合・建材は秘匿）。

const t = messages.ui.map;

export function Pictogram({ id, size = 22 }: { readonly id: BuildingId; readonly size?: number }) {
  return (
    <svg className="pictogram" width={size} height={size} viewBox={`0 0 ${PICTOGRAM_BOX} ${PICTOGRAM_BOX}`} aria-hidden>
      <path d={PICTOGRAMS[id]} fill="none" stroke="currentColor" strokeWidth={PICTOGRAM_STROKE} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 区画の中身の言い方（小札・区画の札で使う） */
export const parcelContent = (view: ParcelView | undefined): string => {
  if (!view || view.kind === "empty") return t.parcelEmpty;
  if (view.kind === "road") return t.parcelRoad;
  const name = view.building === null ? "" : messages.targets[view.building];
  return view.kind === "construction" ? t.parcelConstruction(name) : name;
};

interface Props {
  readonly game: GameState;
  readonly notes: PlayerNotes | null;
  /** 手元（立体の机）か平面モード：拡大・移動・かざす・押すができるライブの地図を出す */
  readonly live: boolean;
  /** 入力欄（区画のメモ）を出してよいか（手元・平面。不変条件25） */
  readonly interactive: boolean;
  readonly selected: number | null;
  readonly onSelect: (gridIndex: number | null) => void;
  readonly onPin: (text: string, gridIndex: number) => void;
  /** 測量の遅れ（§5.9。既定は無効） */
  readonly surveyDelay: boolean;
  /** ターン遷移の途中（§4.5）：「地図の更新」の段までは前の年のまま */
  readonly hold?: boolean;
  /** 「地図の更新」の段の長さ。この間、直近の1年の変化をインクで描き込んでいく（§5.7） */
  readonly inkMs?: number | null;
  /** 並べ読み（§4.6）：書類の中でかざしている地名・建物。該当区画を朱でほのかに示す */
  readonly highlight?: MapRef | null;
}

export function MapPanel({ game, notes, live, interactive, selected, onSelect, onPin, surveyDelay, hold = false, inkMs = null, highlight = null }: Props) {
  const gazetteer = gazetteerFor(game.saveId);
  const model = useMemo(() => buildSurveyModel({ game, notes, surveyDelay }), [game, notes, surveyDelay]);
  const survey = useSurvey(game.saveId, model, gazetteer, hold);
  const [inking, setInking] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const snapshot = useRef<HTMLCanvasElement>(null);
  const scene = useRef<MapScene | null>(null);
  const phaser = useRef<Phaser.Game | null>(null);
  const [hover, setHover] = useState<{ gridIndex: number; at: Point } | null>(null);
  const [zoom, setZoom] = useState(0);
  const [pinText, setPinText] = useState("");
  const terrain = survey.base?.terrain ?? null;

  // 手元・平面のときだけ Phaser を作る（一度作ったら、置いても壊さず隠すだけ）
  const callbacks = useRef({ onSelect, terrain });
  callbacks.current = { onSelect, terrain };
  useEffect(() => {
    if (!live || survey.status !== "ready" || survey.canvas === null || phaser.current !== null || !host.current) return;
    const mapScene = new MapScene();
    const instance = new Phaser.Game({
      type: Phaser.CANVAS,
      parent: host.current,
      width: MAP_VIEW,
      height: MAP_VIEW,
      backgroundColor: "#E8DCC0",
      scene: mapScene,
      banner: false,
      audio: { noAudio: true },
      // 大きさは CSS で枠に合わせる（FIT は描画のループが回っている間しか枠を測り直さず、止めたループでは古い大きさのままになる）。
      // 指の位置の換算は scale.refresh() で測り直す
      scale: { mode: Phaser.Scale.NONE, width: MAP_VIEW, height: MAP_VIEW },
    });
    instance.events.on(Phaser.Core.Events.POST_RENDER, () => instance.loop.sleep());
    const toFrame = (p: Point): Point => {
      const width = frame.current?.clientWidth ?? MAP_VIEW;
      return { x: (p.x * width) / MAP_VIEW, y: (p.y * width) / MAP_VIEW };
    };
    mapScene.setSurvey(survey.canvas, {
      onHover: (world, screen) => {
        const id = world && callbacks.current.terrain ? parcelAt(callbacks.current.terrain, world) : null;
        setHover(id === null ? null : { gridIndex: id, at: toFrame(screen) });
      },
      onSelect: (world) => {
        const id = callbacks.current.terrain ? parcelAt(callbacks.current.terrain, world) : null;
        callbacks.current.onSelect(id);
      },
      onZoom: setZoom,
      onWake: () => instance.loop.wake(),
    });
    phaser.current = instance;
    scene.current = mapScene;
  }, [live, survey.status, survey.canvas]);

  useEffect(
    () => () => {
      phaser.current?.destroy(true);
      phaser.current = null;
      scene.current = null;
    },
    [],
  );

  // 描き直したら、ライブの地図のテクスチャと俯瞰の静止画を更新する（描き込みの演出の間は演出が描く）
  useEffect(() => {
    if (survey.canvas === null || survey.version === 0 || inking) return;
    scene.current?.refresh();
    if (snapshot.current) drawSnapshot(survey.canvas, snapshot.current, MAP_SNAPSHOT);
  }, [survey.version, survey.canvas, live, inking]);

  // 描き込みの演出（§5.7）：直近の1年を抜いた下地の上に、変わった区画だけを輪郭 → 記号の順に描く。
  // 手元・平面でライブの地図を出していても、この間は静止画の上で描く
  const ink = survey.ink;
  useEffect(() => {
    if (inkMs === null || ink === null || !snapshot.current) return;
    const target = snapshot.current;
    const ctx = target.getContext("2d");
    if (!ctx) return;
    target.width = MAP_SNAPSHOT;
    target.height = MAP_SNAPSHOT;
    setInking(true);
    const started = performance.now();
    let frame = 0;
    const draw = () => {
      const progress = Math.min(1, (performance.now() - started) / Math.max(1, inkMs));
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(ink.base, 0, 0);
      ctx.setTransform(MAP_SNAPSHOT / MAP_PX, 0, 0, MAP_SNAPSHOT / MAP_PX, 0, 0);
      paintFresh(ctx, ink.art, progress);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (progress < 1) frame = requestAnimationFrame(draw);
      else setInking(false);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      setInking(false);
    };
  }, [inkMs, ink]);

  // 隠していた地図を見せたら、大きさを測り直して1フレーム描く。手に取る動き（3D の変形）の途中で測ると
  // 縮んだ大きさになるので、動きが終わったあとにもう一度測る
  const remeasure = () => {
    phaser.current?.scale.refresh();
    phaser.current?.loop.wake();
  };
  useEffect(() => {
    if (!live) {
      setHover(null);
      return;
    }
    remeasure();
    const later = window.setTimeout(remeasure, FOCUS_TRANSITION_MS + 80);
    return () => window.clearTimeout(later);
  }, [live, survey.status]);

  // 並べ読みのしるし：区域なら区域の区画、建物ならその建物（普請中も含む）のある区画
  const highlighted = useMemo(() => {
    if (highlight === null) return [];
    return model.parcels
      .filter((view) => {
        if (highlight.kind === "building") return view.building === highlight.building && (view.kind === "building" || view.kind === "construction");
        const [x, y] = gridCoordOf(view.gridIndex);
        return zoneOf(x, y) === highlight.zone;
      })
      .map((view) => view.gridIndex);
  }, [highlight, model]);
  const highlightKey = highlighted.join(",");
  useEffect(() => {
    if (terrain === null) return;
    scene.current?.setHighlight(highlighted.map((i) => terrain.parcels[i]?.polygon ?? []));
    // highlightKey が同じなら描き直さない
  }, [highlightKey, terrain]);

  const views = model.parcels;
  const selectedView = selected === null ? undefined : views[selected];
  const related = useMemo(
    () => (selected === null ? [] : relatedToParcel(game.history, gazetteer, selected, selectedView?.building ?? null)),
    [game.history, gazetteer, selected, selectedView?.building],
  );
  const pinned = selected === null ? [] : (notes?.notes ?? []).filter((n) => n.attachedTo?.kind === "parcel" && n.attachedTo.gridIndex === selected);
  const pinIssue = pinText === "" ? null : validateNoteText(pinText);
  const works = game.projects;

  return (
    <section className="panel map-panel" aria-label={messages.ui.panels.map}>
      <h2 className="panel-title">{messages.ui.panels.map}</h2>
      <div
        className={`map-canvas survey-frame is-${survey.status}`}
        data-highlighted={highlighted.length > 0 ? highlighted.length : undefined}
        ref={frame}
        data-testid="map-canvas"
        data-survey={survey.status}
        data-survey-ms={survey.base ? Math.round(survey.base.totalMs) : undefined}
        data-survey-generate-ms={survey.base ? Math.round(survey.base.generateMs) : undefined}
        data-survey-render-ms={survey.base ? Math.round(survey.base.renderMs) : undefined}
        data-survey-via={survey.base?.via}
        data-survey-phases={survey.base ? JSON.stringify(survey.base.phases) : undefined}
        data-draw-ms={survey.version > 0 ? Math.round(survey.drawMs) : undefined}
        data-first-ready-ms={survey.firstReadyMs === null ? undefined : Math.round(survey.firstReadyMs)}
        data-version={survey.version}
      >
        {survey.status === "loading" && <p className="survey-placeholder">{t.surveying}</p>}
        {survey.status === "unavailable" && <p className="survey-placeholder">{t.unavailable}</p>}
        {/* 俯瞰：静止画。手元：ライブの地図（Phaser）。どちらも同じ測量図 */}
        <canvas ref={snapshot} className="survey-snapshot" hidden={(live && !inking) || survey.status !== "ready"} aria-hidden data-inking={inking || undefined} />
        <div ref={host} className="survey-live" hidden={!live || inking || survey.status !== "ready"} onPointerEnter={remeasure} />
        {live && survey.status === "ready" && (
          <div className="survey-zoom">
            <button className="button" disabled={zoom >= MAP_ZOOM_LEVELS.length - 1} onClick={() => scene.current?.setLevel(zoom + 1, null)}>
              {t.zoomIn}
            </button>
            <span className="survey-zoom-level">{t.zoomLabel(zoom + 1, MAP_ZOOM_LEVELS.length)}</span>
            <button className="button" disabled={zoom === 0} onClick={() => scene.current?.setLevel(zoom - 1, null)}>
              {t.zoomOut}
            </button>
          </div>
        )}
        {live && hover !== null && (
          <div className="survey-tag" style={{ left: hover.at.x, top: hover.at.y }} data-testid="parcel-tag">
            <span className="survey-tag-name">{gazetteer.parcels[hover.gridIndex]}</span>
            <span className="survey-tag-content">{parcelContent(views[hover.gridIndex])}</span>
          </div>
        )}
      </div>
      <p className="panel-note survey-hint">{t.operationHint}</p>

      {selected !== null && (
        <div className="parcel-sheet paper" data-testid="parcel-sheet">
          <div className="parcel-sheet-head">
            <h3 className="parcel-name">{gazetteer.parcels[selected]}</h3>
            {interactive && (
              <button className="button" onClick={() => onSelect(null)}>
                {t.closeParcel}
              </button>
            )}
          </div>
          <p className="parcel-content">
            {selectedView?.building !== null && selectedView?.building !== undefined && selectedView.kind !== "road" && <Pictogram id={selectedView.building} size={20} />}
            {parcelContent(selectedView)}
            {selectedView?.crack && <span className="parcel-crack">{t.crackNote}</span>}
          </p>
          <h4 className="parcel-subtitle">{t.relatedTitle}</h4>
          {related.length === 0 ? (
            <p className="panel-note">{t.relatedNone}</p>
          ) : (
            <ul className="parcel-related" data-testid="parcel-related">
              {related.map((r, i) => (
                <li key={i}>{r.kind === "article" ? t.relatedArticle(r.turn, r.headline) : t.relatedReport(r.turn, aideName(r.aideId), r.line)}</li>
              ))}
            </ul>
          )}
          {pinned.length > 0 && (
            <>
              <h4 className="parcel-subtitle">{t.pinnedHere}</h4>
              <ul className="parcel-notes">
                {pinned.map((n) => (
                  <li key={n.id} className="pinned-note" data-testid="parcel-note">
                    <span className="pinned-tab">{messages.ui.notes.slip}</span>
                    <span className="pinned-text">{n.text}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {interactive && (
            <form
              className="parcel-pin"
              onSubmit={(e) => {
                e.preventDefault();
                if (validateNoteText(pinText) !== null) return;
                onPin(pinText, selected);
                setPinText("");
              }}
            >
              <label>
                <span>{t.pinLabel}</span>
                <input value={pinText} onChange={(e) => setPinText(e.target.value)} placeholder={messages.ui.notes.placeholder} data-testid="parcel-pin-text" />
              </label>
              <span className={`note-count ${pinIssue?.kind === "tooLong" ? "over" : ""}`}>{messages.ui.notes.remaining(NOTE_CHAR_LIMIT - noteLength(pinText))}</span>
              <button className="button" type="submit" disabled={pinText.trim() === "" || pinIssue !== null} data-testid="parcel-pin">
                {t.pin}
              </button>
            </form>
          )}
        </div>
      )}

      <div className="survey-legend">
        <h3 className="works-title">{t.legendTitle}</h3>
        <ul className="map-legend">
          {BUILDING_IDS.map((id) => (
            <li key={id}>
              <Pictogram id={id} />
              {messages.targets[id]}
            </li>
          ))}
          <li>
            <span className="legend-swatch legend-construction" aria-hidden />
            {t.legend.construction}
          </li>
          <li>
            <svg className="pictogram legend-crack" width={22} height={22} viewBox="0 0 32 32" aria-hidden>
              <path d="M18 4 L12 13 L19 17 L11 27 L16 30" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" />
            </svg>
            {t.crackNote}
          </li>
        </ul>
      </div>
      <p className="panel-note">{t.note}</p>
      <div className="works" data-testid="works">
        <h3 className="works-title">{t.worksTitle}</h3>
        {works.length === 0 ? (
          <p className="panel-note">{t.noWorks}</p>
        ) : (
          <ul className="works-list">
            {works.map((w) => (
              <li key={w.id}>{t.work(messages.targets[w.kind], w.count, w.repair, w.orderedTurn)}</li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
