import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { messages } from "../../i18n/messages";
import { HOVER_LIFT } from "./deskConstants";
import type { DeskFit, Slot } from "./geometry";
import { overviewTransform } from "./geometry";
import { objectShadow } from "./lighting";
import { DESK_OBJECTS, type DeskObjectId } from "./objects";

// 机上オブジェクトの共通部品（SPEC_v3.3 §3.2・§3.3・§4.1）：位置・回転・高さ・影。
// 1つの物は常に同じ DOM 要素で、俯瞰では机に寝かせる変形を、手元では transform: none を当てるだけ。
// 変形は transition でつなぐので「引き寄せる／置く」が 0.35 秒の1本の動きになり、中の状態（地図の Phaser 等）も壊れない。
// 俯瞰の中身は inert（触れない・読み上げない）。入力欄は手元でしか描かない（不変条件25）。

export type DeskObjectState = "overview" | "focused" | "companion";

interface Props {
  readonly id: DeskObjectId;
  readonly state: DeskObjectState;
  readonly slot: Slot;
  readonly fit: DeskFit;
  readonly zIndex: number;
  /** 手元での最大の高さ（px）。超える分は紙の中でスクロール */
  readonly maxHeight: number;
  /** 俯瞰でクリックしたとき（判子は勅令用紙を、それ以外は自分を手に取る）。null なら手に取れない飾り */
  readonly onPick: (() => void) | null;
  /** 俯瞰でかざした・キーボードの焦点が来た（鉛筆の小札を出す） */
  readonly onIndicate: (on: boolean) => void;
  readonly children: (interactive: boolean) => ReactNode;
}

export function DeskObject({ id, state, slot, fit, zIndex, maxHeight, onPick, onIndicate, children }: Props) {
  const spec = DESK_OBJECTS[id];
  const ref = useRef<HTMLDivElement>(null);
  const name = messages.ui.desk.objects[id];
  const inHand = state !== "overview";

  // 手に取ったら紙に（勅令用紙なら本文の欄に）キーボードの焦点を移し、置いたら机の上のその物に戻す
  const wasInHand = useRef(inHand);
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    if (state === "focused" && !wasInHand.current) {
      const field = el.querySelector<HTMLElement>("textarea:not([disabled])");
      (field ?? el).focus({ preventScroll: true });
    } else if (!inHand && wasInHand.current && el.contains(document.activeElement)) {
      el.focus({ preventScroll: true });
    }
    wasInHand.current = inHand;
  }, [state, inHand]);

  const { home } = spec;
  const shadow = objectShadow(home.x, home.y, home.z, home.rotate);
  const lifted = objectShadow(home.x, home.y, home.z + HOVER_LIFT, home.rotate);
  const placed = overviewTransform(slot, spec.width, home, fit);
  const style: CSSProperties & Record<string, string | number> = {
    left: slot.left,
    top: slot.top,
    width: spec.width,
    zIndex,
    // 俯瞰では物ごとの高さ（新聞は二つ折り）に収め、手に取ると手元の高さまで広がる
    maxHeight: !inHand && spec.overviewMaxHeight !== undefined ? Math.min(maxHeight, spec.overviewMaxHeight) : maxHeight,
    transform: inHand ? "none" : placed.transform,
    transformOrigin: placed.transformOrigin,
    "--shadow": shadow.box,
    "--shadow-lifted": lifted.box,
    "--drop": shadow.drop,
    "--drop-lifted": lifted.drop,
  };

  const pickable = onPick !== null && !inHand;
  return (
    <div
      ref={ref}
      className={`desk-object desk-object-${id} shadow-${spec.shadow} is-${state}`}
      data-object={id}
      data-state={state}
      style={style}
      role={pickable ? "button" : inHand ? "region" : undefined}
      aria-label={pickable ? messages.ui.desk.pickUp(name) : inHand ? messages.ui.desk.inHand(name) : undefined}
      aria-hidden={onPick === null && !inHand ? true : undefined}
      tabIndex={pickable ? 0 : inHand ? -1 : undefined}
      onClick={pickable ? onPick : undefined}
      onPointerEnter={pickable ? () => onIndicate(true) : undefined}
      onPointerLeave={pickable ? () => onIndicate(false) : undefined}
      onFocus={pickable ? (e) => e.target === e.currentTarget && onIndicate(true) : undefined}
      onBlur={pickable ? () => onIndicate(false) : undefined}
      onKeyDown={
        pickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onPick();
              }
            }
          : undefined
      }
    >
      <div className="desk-object-content" inert={!inHand}>
        {children(inHand)}
      </div>
    </div>
  );
}
