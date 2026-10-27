import { useLayoutEffect, useRef } from "react";
import { messages } from "../../../i18n/messages";

// 判子と朱肉（SPEC_v3.3 §3.2・§4.3）。勅令用紙が手元にあり、文字数が範囲内のときだけ光って押せる（超えていれば持ち上がらない）。
// 押すと「持ち上げ → 朱肉に付ける → 用紙の上へ → 押す」を約1.2秒で行う。動きの行き先（朱肉と用紙の判の位置）は、
// 押す直前に実際の位置を測って CSS 変数に入れる（立体の手元でも平面でも同じ動きになる）。確認の画面は出さない。

interface Props {
  /** 押せる（用紙が手元にあり、書きかけが正しい） */
  readonly ready: boolean;
  readonly stamping: boolean;
  readonly onStamp: () => void;
}

const center = (el: Element) => {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};

export function StampObject({ ready, stamping, onStamp }: Props) {
  const t = messages.ui.decree;
  const root = useRef<HTMLDivElement>(null);
  const seal = useRef<HTMLButtonElement>(null);
  const pad = useRef<HTMLDivElement>(null);

  // 押し始めた瞬間（描画の前）に、朱肉と用紙の判の位置までのずれを測る
  useLayoutEffect(() => {
    if (!stamping || root.current === null || seal.current === null || pad.current === null) return;
    const from = center(seal.current);
    const ink = center(pad.current);
    const imprint = document.querySelector(".decree-sheet .seal-imprint");
    const to = imprint === null ? from : center(imprint);
    root.current.style.setProperty("--pad-dy", `${Math.round(ink.y - from.y)}px`);
    root.current.style.setProperty("--press-dx", `${Math.round(to.x - from.x)}px`);
    root.current.style.setProperty("--press-dy", `${Math.round(to.y - from.y)}px`);
  }, [stamping]);

  return (
    <div ref={root} className={`stamp-object ${ready ? "is-ready" : ""} ${stamping ? "is-pressing" : ""}`} data-testid="stamp-object">
      <div ref={pad} className="inkpad" aria-hidden />
      <button ref={seal} className="seal-button" disabled={!ready} onClick={onStamp} aria-label={t.stampLabel} data-testid="stamp">
        {t.stamp}
      </button>
      <span className="stamp-caption">{t.stampLabel}</span>
    </div>
  );
}
