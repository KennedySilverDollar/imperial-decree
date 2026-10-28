import { useEffect, useMemo, useRef, useState } from "react";
import { messages } from "../../i18n/messages";
import { composeMap } from "../map/composeMap";
import { RELIEF_CANVAS_PX, RELIEF_MIN_FPS, RELIEF_SUSTAIN_MS, RELIEF_WHEEL_PER_PX } from "../map/mapConstants";
import type { MapViewModel } from "../map/MapViewModel";
import { buildRelief } from "../map/model3d/ReliefMesh";
import { DEFAULT_CAMERA, dragCamera, drawRelief, zoomCamera, type ReliefCamera, type ReliefLight } from "../map/model3d/ReliefModel";
import { loadTerrain, terrainSupported, type TerrainReady } from "../map/terrainClient";

// 地形模型（SPEC_v3.4 §10、M4。DECISIONS BC-41〜）：机の上の石膏模型。地図と同じ MapViewModel を受け取り、同じ地形から作る。
// 机の上では決まった向きの静止画。手に取ると、ドラッグで回す（横）・傾ける（縦）、ホイールで寄る。
// 立体の机にだけ置く（平面モードでは出さない）。机の軽量モード、または操作中に 45fps を下回り続けたら、模型を止めて布を掛ける。

/** lowPower：机の軽量モード（性能不足）、slow：模型を回していて 45fps を下回り続けた */
type ReliefState = "surveying" | "ready" | "unavailable" | "lowPower" | "slow";

interface Props {
  readonly view: MapViewModel;
  readonly interactive: boolean;
  /** 机が軽量モード（性能不足） */
  readonly lowPower: boolean;
  readonly light: ReliefLight;
  /** 性能の自動調整（?noadapt で切れる。机と同じ） */
  readonly adaptive: boolean;
}

export function ReliefPanel({ view, interactive, lowPower, light, adaptive }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [terrain, setTerrain] = useState<{ saveId: string; ready: TerrainReady | null } | null>(null);
  const [camera, setCamera] = useState<ReliefCamera>(DEFAULT_CAMERA);
  const [slow, setSlow] = useState(false);
  const supported = terrainSupported();
  const frames = useRef<number[]>([]);
  const interacting = useRef(0);

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

  const ready = terrain !== null && terrain.saveId === view.saveId ? terrain.ready : null;
  const state: ReliefState = lowPower ? "lowPower" : slow ? "slow" : !supported || (terrain !== null && terrain.saveId === view.saveId && ready === null) ? "unavailable" : ready ? "ready" : "surveying";
  // 形は MapViewModel と地形だけから（地図と同じ構図）
  const scene = useMemo(() => (ready && state === "ready" ? buildRelief(ready.data, composeMap(view, ready.data)) : null), [ready, view, state]);
  const shown = interactive ? camera : DEFAULT_CAMERA;

  // 描く（同じフレームの中の変更は1回にまとめる）
  useEffect(() => {
    const el = canvas.current;
    if (!el || !scene) return;
    const id = requestAnimationFrame((now) => {
      // CPU 側の Canvas（willReadFrequently）：数千の多角形を毎フレーム塗るので、GPU の 2D（ソフトウェアで模擬される環境では
      // 極端に遅い）を避ける。地図の Canvas と同じ扱い（DECISIONS BC-37）
      const ctx = el.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      const size = el.width;
      ctx.clearRect(0, 0, size, size);
      drawRelief(ctx, size, scene, shown, light);
      // 性能の見張り：操作中のフレームの間隔だけを数える
      if (now - interacting.current < 250) {
        // 操作の途切れ（前のフレームから 250ms 超）は数えない：止まっていた間を遅いフレームと取り違えないように
        const f = frames.current;
        if (f.length > 0 && now - f[f.length - 1]! > 250) f.length = 0;
        f.push(now);
        while (f.length > 0 && now - f[0]! > RELIEF_SUSTAIN_MS * 1.5) f.shift();
        const span = now - f[0]!;
        if (adaptive && span >= RELIEF_SUSTAIN_MS && ((f.length - 1) * 1000) / span < RELIEF_MIN_FPS) setSlow(true);
      } else {
        frames.current = [];
      }
    });
    return () => cancelAnimationFrame(id);
  }, [scene, shown, light, adaptive]);

  // 手元の操作（Phaser と同じく DOM で受ける。ホイールは passive: false）
  useEffect(() => {
    const el = canvas.current;
    if (!el || !interactive || state !== "ready") return;
    let drag: { x: number; y: number; id: number } | null = null;
    const touch = () => {
      interacting.current = performance.now();
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      touch();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      setCamera((c) => zoomCamera(c, Math.pow(RELIEF_WHEEL_PER_PX, -dy)));
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
      el.setPointerCapture?.(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!drag || drag.id !== e.pointerId) return;
      touch();
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      drag.x = e.clientX;
      drag.y = e.clientY;
      const size = el.getBoundingClientRect().width || RELIEF_CANVAS_PX;
      setCamera((c) => dragCamera(c, dx, dy, size));
    };
    const onUp = (e: PointerEvent) => {
      if (drag?.id !== e.pointerId) return;
      drag = null;
      el.releasePointerCapture?.(e.pointerId);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
    };
  }, [interactive, state]);

  const ui = messages.ui.relief;
  return (
    <section className="panel relief-panel" aria-label={ui.title} data-relief-state={state}>
      <h2 className="panel-title">{ui.title}</h2>
      {state === "ready" ? (
        <canvas
          ref={canvas}
          className={`relief-canvas ${interactive ? "relief-interactive" : ""}`}
          width={RELIEF_CANVAS_PX}
          height={RELIEF_CANVAS_PX}
          role="img"
          aria-label={ui.label}
          data-testid="relief-canvas"
        />
      ) : (
        <div className="relief-cloth" data-testid="relief-cloth">
          <p className="panel-note">{state === "surveying" ? ui.surveying : state === "unavailable" ? ui.unavailable : ui.lowPower}</p>
        </div>
      )}
      {interactive && state === "ready" && (
        <div className="relief-controls">
          <span className="panel-note">{ui.hint}</span>
          <button type="button" onClick={() => setCamera(DEFAULT_CAMERA)}>
            {ui.reset}
          </button>
        </div>
      )}
      <p className="panel-note">{ui.note}</p>
    </section>
  );
}
