import { messages } from "../../i18n/messages";

// 手元レイヤ（SPEC_v3.3 §2.2・§4.1）。手に取った書類の後ろで机を暗くぼかし（backdrop-filter はこの1枚だけ）、
// 空いた所のクリックで書類を置く（右クリックは DeskStage がまとめて受ける）。書類そのものは DeskObject が
// transform: none で手前に出す（同じ要素のまま動かすので、ここへは付け替えない）。

interface Props {
  readonly active: boolean;
  /** 性能の自動調整中はぼかさない（暗くするだけ） */
  readonly blur: boolean;
  readonly onPutDown: () => void;
}

export function FocusLayer({ active, blur, onPutDown }: Props) {
  return (
    <div
      className={`focus-backdrop ${active ? "is-active" : ""} ${blur ? "with-blur" : ""}`}
      data-testid="focus-backdrop"
      aria-hidden
      onClick={active ? onPutDown : undefined}
    >
      {active && <p className="focus-hint">{messages.ui.desk.putDownHint}</p>}
    </div>
  );
}
