import { messages } from "../../../i18n/messages";

// 判子と朱肉（SPEC_v3.3 §3.2・§4.3）。勅令用紙が手元にあり、文字数が範囲内のときだけ光って押せる。

interface Props {
  /** 押せる（用紙が手元にあり、書きかけが正しい） */
  readonly ready: boolean;
  readonly stamping: boolean;
  readonly onStamp: () => void;
}

export function StampObject({ ready, stamping, onStamp }: Props) {
  const t = messages.ui.decree;
  return (
    <div className={`stamp-object ${ready ? "is-ready" : ""} ${stamping ? "is-pressing" : ""}`} data-testid="stamp-object">
      <div className="inkpad" aria-hidden />
      <button className="seal-button" disabled={!ready} onClick={onStamp} aria-label={t.stampLabel} data-testid="stamp">
        {t.stamp}
      </button>
      <span className="stamp-caption">{t.stampLabel}</span>
    </div>
  );
}
