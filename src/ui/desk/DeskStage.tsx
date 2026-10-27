import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { messages } from "../../i18n/messages";
import { FOCUS_HINT_SPACE_PX, FOCUS_MARGIN_PX, HOVER_LIFT, PARALLAX_MAX_DEG } from "./deskConstants";
import { DeskObject, type DeskObjectState } from "./DeskObject";
import type { DeskUiState } from "./deskState";
import { FocusLayer } from "./FocusLayer";
import { fitDesk, focusSlots, screenPoint, tabletopStyle, type Size } from "./geometry";
import { keyTargetOf } from "./keyboard";
import { LAMP_LIGHT, lightingOverlay, tabletopLighting } from "./lighting";
import { DESK_OBJECTS, isPickable, type DeskObjectId, type PickableId } from "./objects";
import type { Weather } from "../transitions/weather";
import { WindowLight } from "./WindowLight";

// 執務机（SPEC_v3.3 §2.2・§3）：DOM ＋ CSS 3D。天板と机上の物を、同じ原点・同じ傾きで寝かせて置く。
// ステージ自身は変形しない（手元の書類が祖先の変形を受けずに正対できるように）。

interface Props {
  readonly objects: readonly DeskObjectId[];
  readonly render: (id: DeskObjectId, interactive: boolean) => ReactNode;
  readonly desk: DeskUiState;
  readonly stage: Size;
  readonly onPick: (id: PickableId) => void;
  readonly onPutDown: () => void;
  /** 視差（動きを減らす・性能の自動調整では止める） */
  readonly parallax: boolean;
  /** 照明の重ねと背景のぼかし（性能の自動調整では止める） */
  readonly richLighting: boolean;
  /** 遷移を飛ばした直後（Space）：transition を一瞬だけ切る */
  readonly instant: boolean;
  /** 窓の光の天候（§4.5-3） */
  readonly weather: Weather;
}

const stateOf = (id: DeskObjectId, desk: DeskUiState): DeskObjectState => {
  if (desk.focused === id) return "focused";
  if (desk.focused === "decree" && id === "stamp") return "companion";
  if (desk.sideBySide && desk.focused !== null && id === "map") return "companion";
  return "overview";
};

export function DeskStage({ objects, render, desk, stage, onPick, onPutDown, parallax, richLighting, instant, weather }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const frame = useRef(0);
  const [indicated, setIndicated] = useState<DeskObjectId | null>(null);
  const fit = fitDesk(stage);
  const slots = focusSlots(stage.width, desk.focused, desk.sideBySide);
  const lamp = screenPoint({ x: LAMP_LIGHT.x, y: LAMP_LIGHT.y }, fit);
  const maxHeight = stage.height - FOCUS_MARGIN_PX * 2 - FOCUS_HINT_SPACE_PX;

  // 視差は継承しない変数（desk.css の @property）なので、変形を持つ要素（天板と机上の物）に直接置く
  const setParallax = (x: number, y: number) => {
    const el = root.current;
    if (el === null) return;
    const px = `${(-y * PARALLAX_MAX_DEG).toFixed(3)}deg`;
    const py = `${(x * PARALLAX_MAX_DEG).toFixed(3)}deg`;
    for (const target of el.querySelectorAll<HTMLElement>(".tabletop, .desk-object")) {
      target.style.setProperty("--parallax-x", px);
      target.style.setProperty("--parallax-y", py);
    }
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    if (!parallax || desk.focused !== null) return;
    const { clientX, clientY } = e;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const rect = root.current?.getBoundingClientRect();
      if (!rect) return;
      setParallax(((clientX - rect.left) / rect.width) * 2 - 1, ((clientY - rect.top) / rect.height) * 2 - 1);
    });
  };

  useEffect(() => {
    if (!parallax) setParallax(0, 0);
  }, [parallax]);

  const inHand = desk.focused !== null;
  return (
    <div
      ref={root}
      className={`desk-stage ${inHand ? "has-focus" : ""} ${instant ? "is-instant" : ""}`}
      data-testid="desk-stage"
      role="group"
      aria-label={messages.ui.desk.stageLabel}
      style={{ width: stage.width, height: stage.height }}
      onPointerMove={onPointerMove}
      onPointerLeave={() => setParallax(0, 0)}
      onContextMenu={(e) => {
        if (!inHand || keyTargetOf(e.target) === "text") return;
        e.preventDefault();
        onPutDown();
      }}
    >
      <div className="tabletop" aria-hidden style={{ ...tabletopStyle(fit), ["--tabletop-light" as string]: tabletopLighting() }} />
      {objects.map((id) => {
        const state = stateOf(id, desk);
        const pick = id === "stamp" ? () => onPick("decree") : isPickable(id) ? () => onPick(id) : null;
        return (
          <DeskObject
            key={id}
            id={id}
            state={state}
            slot={slots[id]}
            fit={fit}
            zIndex={state === "overview" ? 10 + desk.order.indexOf(id) : 60}
            maxHeight={maxHeight}
            onPick={pick}
            onIndicate={(on) => setIndicated((current) => (on ? id : current === id ? null : current))}
          >
            {(interactive) => render(id, interactive)}
          </DeskObject>
        );
      })}
      {richLighting && <div className="lighting-overlay" aria-hidden style={{ background: lightingOverlay(lamp, stage) }} />}
      <WindowLight weather={weather} />
      {indicated !== null && !inHand && <PencilTag id={indicated} fit={fit} />}
      <FocusLayer active={inHand} blur={richLighting} onPutDown={onPutDown} />
    </div>
  );
}

/** 俯瞰でかざした物の名前を、鉛筆書きの小札として物の上辺の少し上に出す（§4.1）。変形を掛けずに読みやすく */
function PencilTag({ id, fit }: { readonly id: DeskObjectId; readonly fit: ReturnType<typeof fitDesk> }) {
  const { home } = DESK_OBJECTS[id];
  const at = screenPoint({ x: home.x, y: home.y, z: home.z + HOVER_LIFT }, fit);
  return (
    <span className="desk-tag" aria-hidden style={{ left: at.x, top: at.y }} data-testid="desk-tag">
      {messages.ui.desk.objects[id]}
    </span>
  );
}
