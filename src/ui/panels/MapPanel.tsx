import Phaser from "phaser";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { CATEGORIES, type BuildingId } from "../../domain/Buildings";
import { GRID_SIZE, PLAYER_NOTE_MAX_CHARS } from "../../domain/constants";
import { messages } from "../../i18n/messages";
import type { ArchiveEntry } from "../game/parcelArchive";
import { BUTTON_ZOOM, CLICK_SLOP_PX, WHEEL_ZOOM_PER_PX } from "../map/mapConstants";
import { MAP_PIXELS, MAP_RESOLUTION, MapScene, type MapSceneState } from "../map/MapScene";
import type { MapViewModel } from "../map/MapViewModel";
import { loadTerrain, terrainSupported, type TerrainReady } from "../map/terrainClient";
import { palette } from "../theme";

const PLAIN_LEGEND = ["road", "construction", "empty"] as const;

export interface WorkItem {
  readonly id: number;
  readonly building: BuildingId;
  readonly count: number;
  readonly repair: boolean;
  readonly orderedTurn: number;
}

/** 地形の状態（data-terrain-ready）：生成中 false、測量図 true、抽象グリッドに戻した fallback */
type TerrainState = { readonly saveId: string; readonly ready: TerrainReady | null };

interface Props {
  readonly view: MapViewModel;
  readonly works: readonly WorkItem[];
  /** 手元（平面モード、または手に取った地図）。ズーム・パン・区画の選択ができる。机の上に置いたままなら俯瞰の静止画 */
  readonly interactive?: boolean;
  /** 机が軽量モード（§9） */
  readonly lowPower?: boolean;
  readonly reducedMotion?: boolean;
  /** 区画の記録（過去の記事と側近報告） */
  readonly archiveOf?: (gridIndex: number, place: string | null) => readonly ArchiveEntry[];
  readonly onAddNote?: (gridIndex: number, text: string) => void;
  readonly onRemoveNote?: (id: string) => void;
}

/** 区画に建っているもの（名前だけ。空洞・進捗は出さない） */
const parcelText = (view: MapViewModel, gridIndex: number): string => {
  const building = view.buildings.find((b) => b.gridIndex === gridIndex);
  if (building) return messages.targets[building.kind];
  const work = view.construction.find((w) => w.gridIndices.includes(gridIndex));
  if (work) return messages.ui.map.tooltip.construction(messages.targets[work.kind]);
  const parcel = view.parcels[gridIndex];
  return parcel?.use === "road" ? messages.ui.map.tooltip.road : messages.ui.map.tooltip.empty;
};

// 普請中の案件は「何を発注したか」だけを出す。工期・進み具合・建材は秘匿（CLAUDE.md §4-13）。
// 地図に渡すのは MapViewModel だけ（不変条件26）。地形は saveId ごとに Worker で一度だけ作る。
// 区画にかざすと小字と建物の名前だけを出し、選ぶとその区画に関係する過去の記事・報告と書き付けを出す（§7.2）。
export function MapPanel({ view, works, interactive = true, lowPower = false, reducedMotion = false, archiveOf, onAddNote, onRemoveNote }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<MapScene | null>(null);
  const game = useRef<Phaser.Game | null>(null);
  const [terrain, setTerrain] = useState<TerrainState | null>(null);
  const [sceneState, setSceneState] = useState<MapSceneState | null>(null);
  /** 札の区画（React の状態は区画が変わったときだけ更新し、位置は ref で直接動かす：マウスの動きごとに描き直さない） */
  const [tip, setTip] = useState<number | null>(null);
  const tipEl = useRef<HTMLDivElement>(null);
  const tipAt = useRef<[number, number]>([0, 0]);
  const [selected, setSelected] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const supported = terrainSupported();

  useEffect(() => {
    if (!host.current) return;
    const size = MAP_PIXELS(GRID_SIZE);
    const mapScene = new MapScene(size);
    mapScene.onState = (s) => setSceneState((prev) => (prev && prev.lite === s.lite && prev.widthM === s.widthM ? prev : s));
    // ゲームの Canvas は CPU 側（willReadFrequently）にする。ベイク画像も CPU 側の Canvas に写してあるので（terrainClient）、
    // 毎フレームの drawImage で GPU との読み戻し・転送が起きない（M3 の計測。DECISIONS §17.11）
    const canvas = document.createElement("canvas");
    const context = supported ? canvas.getContext("2d", { willReadFrequently: true }) : null;
    const instance = new Phaser.Game({
      type: Phaser.CANVAS,
      parent: host.current,
      ...(context ? { canvas, context } : {}),
      width: size * MAP_RESOLUTION,
      height: size * MAP_RESOLUTION,
      zoom: 1 / MAP_RESOLUTION,
      backgroundColor: palette.paper,
      // MapScene がゲームの Canvas に直接描くので、Phaser に毎フレーム消させない
      clearBeforeRender: false,
      scene: mapScene,
      banner: false,
      audio: { noAudio: true },
      input: false,
    });
    game.current = instance;
    scene.current = mapScene;
    return () => {
      mapScene.onState = null;
      scene.current = null;
      game.current = null;
      instance.destroy(true);
    };
  }, []);

  useEffect(() => {
    if (!supported) return;
    let alive = true;
    void loadTerrain(view.saveId).then((ready) => {
      if (alive) setTerrain({ saveId: view.saveId, ready });
    });
    return () => {
      alive = false;
    };
  }, [supported, view.saveId]);

  const current = terrain !== null && terrain.saveId === view.saveId ? terrain : null;
  const ready = current?.ready ?? null;
  const state = !supported ? "fallback" : current === null ? "false" : ready ? "true" : "fallback";
  const canInteract = interactive && ready !== null;

  // シーンの create 前に渡された地図は保留され、create 時に描かれる
  useEffect(() => {
    scene.current?.setView(view, ready);
  }, [view, ready]);
  useEffect(() => {
    scene.current?.setReduced(reducedMotion);
  }, [reducedMotion]);
  useEffect(() => {
    scene.current?.setLowPower(lowPower);
  }, [lowPower]);
  useEffect(() => {
    scene.current?.setInteractive(canInteract);
    if (!canInteract) {
      setTip(null);
      setSelected(null);
    }
  }, [canInteract]);
  useEffect(() => {
    scene.current?.setSelected(selected);
  }, [selected]);

  // ホイール（passive: false で既定のスクロールを止める）とドラッグ
  useEffect(() => {
    const el = host.current;
    if (!el || !canInteract) return;
    const frac = (e: { clientX: number; clientY: number }): [number, number] => {
      const r = (el.querySelector("canvas") ?? el).getBoundingClientRect();
      return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      scene.current?.zoom(Math.pow(WHEEL_ZOOM_PER_PX, dy), frac(e));
    };
    let drag: { x: number; y: number; moved: boolean; id: number } | null = null;
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      drag = { x: e.clientX, y: e.clientY, moved: false, id: e.pointerId };
      el.setPointerCapture?.(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      const s = scene.current;
      if (!s) return;
      if (drag && drag.id === e.pointerId) {
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        if (!drag.moved && Math.hypot(dx, dy) < CLICK_SLOP_PX) return;
        drag.moved = true;
        const r = (el.querySelector("canvas") ?? el).getBoundingClientRect();
        s.pan(dx / r.width, dy / r.height);
        drag.x = e.clientX;
        drag.y = e.clientY;
        setTip(null);
        s.setHover(null);
        return;
      }
      const at = frac(e);
      const g = at[0] < 0 || at[1] < 0 || at[0] > 1 || at[1] > 1 ? null : s.parcelAtScreen(at);
      s.setHover(g);
      const r = el.getBoundingClientRect();
      tipAt.current = [e.clientX - r.left + 14, e.clientY - r.top + 12];
      if (tipEl.current) tipEl.current.style.transform = `translate(${tipAt.current[0]}px, ${tipAt.current[1]}px)`;
      setTip(g);
    };
    const onUp = (e: PointerEvent) => {
      if (!drag || drag.id !== e.pointerId) return;
      const click = !drag.moved;
      drag = null;
      el.releasePointerCapture?.(e.pointerId);
      if (click) {
        const g = scene.current?.parcelAtScreen(frac(e)) ?? null;
        setSelected((prev) => (prev === g ? null : g));
        setDraft("");
      }
    };
    const onLeave = () => {
      setTip(null);
      scene.current?.setHover(null);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("pointerleave", onLeave);
    };
  }, [canInteract]);

  const placeOf = (g: number): string | null => ready?.data.parcels[g]?.name ?? null;
  const legend = messages.ui.map.legend;
  const ui = messages.ui.map;
  const notesHere = selected === null ? [] : view.notes.filter((n) => n.gridIndex === selected);
  const archive = selected === null || !archiveOf ? [] : archiveOf(selected, placeOf(selected));

  const submitNote = (e: FormEvent) => {
    e.preventDefault();
    if (selected === null || !onAddNote) return;
    onAddNote(selected, draft);
    setDraft("");
  };

  return (
    <section
      className="panel map-panel"
      aria-label={messages.ui.panels.map}
      data-terrain-ready={state}
      data-map-lite={sceneState?.lite ? "true" : "false"}
      data-map-width={sceneState ? Math.round(sceneState.widthM) : undefined}
    >
      <h2 className="panel-title">{messages.ui.panels.map}</h2>
      <div className="map-stage">
        <div className={`map-canvas ${canInteract ? "map-interactive" : ""}`} ref={host} data-testid="map-canvas" />
        {canInteract && tip !== null && (
          <div
            className="map-tooltip"
            role="tooltip"
            ref={tipEl}
            style={{ transform: `translate(${tipAt.current[0]}px, ${tipAt.current[1]}px)` }}
            data-testid="map-tooltip"
          >
            {placeOf(tip) && <span className="map-tooltip-place">{placeOf(tip)}</span>}
            <span>{parcelText(view, tip)}</span>
          </div>
        )}
        {canInteract && (
          <div className="map-controls" role="group" aria-label={ui.controls}>
            <button type="button" onClick={() => scene.current?.zoom(1 / BUTTON_ZOOM)} aria-label={ui.zoomIn}>
              ＋
            </button>
            <button type="button" onClick={() => scene.current?.zoom(BUTTON_ZOOM)} aria-label={ui.zoomOut}>
              －
            </button>
            <button type="button" onClick={() => scene.current?.resetView()}>
              {ui.resetView}
            </button>
          </div>
        )}
      </div>
      {state === "false" && <p className="panel-note map-surveying">{ui.surveying}</p>}
      {canInteract && <p className="panel-note map-hint">{ui.hint}</p>}
      {canInteract && selected !== null && (
        <div className="map-parcel" data-testid="map-parcel">
          <div className="map-parcel-head">
            <h3>{ui.parcel.title(placeOf(selected) ?? "", parcelText(view, selected))}</h3>
            <button type="button" onClick={() => setSelected(null)}>
              {ui.parcel.close}
            </button>
          </div>
          <h4>{ui.parcel.archive}</h4>
          {archive.length === 0 ? (
            <p className="panel-note">{ui.parcel.noArchive}</p>
          ) : (
            <ul className="map-archive">
              {archive.map((a, k) => (
                <li key={k}>
                  <span className="map-archive-source">{a.source === "newspaper" ? ui.parcel.newspaper(a.turn) : ui.parcel.report(a.turn)}</span>
                  {a.text}
                </li>
              ))}
            </ul>
          )}
          <h4>{ui.parcel.notes}</h4>
          {notesHere.length === 0 ? (
            <p className="panel-note">{ui.parcel.noNotes}</p>
          ) : (
            <ul className="map-notes">
              {notesHere.map((n) => (
                <li key={n.id}>
                  {n.text}
                  {onRemoveNote && (
                    <button type="button" onClick={() => onRemoveNote(n.id)}>
                      {ui.parcel.removeNote}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {onAddNote && (
            <form className="map-note-form" onSubmit={submitNote}>
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={ui.parcel.notePlaceholder(PLAYER_NOTE_MAX_CHARS)}
                aria-label={ui.parcel.noteLabel}
                maxLength={PLAYER_NOTE_MAX_CHARS * 2}
              />
              <button type="submit" disabled={draft.trim().length === 0}>
                {ui.parcel.addNote}
              </button>
            </form>
          )}
        </div>
      )}
      <ul className="map-legend">
        {CATEGORIES.map((category) => (
          <li key={category}>
            <span className={`legend-swatch legend-${category}`} aria-hidden />
            {messages.categories[category]}
          </li>
        ))}
        {PLAIN_LEGEND.map((kind) => (
          <li key={kind}>
            <span className={`legend-swatch legend-${kind}`} aria-hidden />
            {legend[kind]}
          </li>
        ))}
      </ul>
      <p className="panel-note">{ui.note}</p>
      <div className="works" data-testid="works">
        <h3 className="works-title">{ui.worksTitle}</h3>
        {works.length === 0 ? (
          <p className="panel-note">{ui.noWorks}</p>
        ) : (
          <ul className="works-list">
            {works.map((w) => (
              <li key={w.id}>{ui.work(messages.targets[w.building], w.count, w.repair, w.orderedTurn)}</li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
