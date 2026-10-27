import type { ReactNode } from "react";
import { messages } from "../../i18n/messages";
import type { DeskUiState } from "./deskState";
import type { DeskObjectId, PickableId } from "./objects";
import type { Weather } from "../transitions/weather";
import { WindowLight } from "./WindowLight";

// 平面モード（SPEC_v3.3 §9）：机を真上から見た配置で、書類を平らなパネルとして並べる。変形は一切ない。
// 並びは立体の机の置き場に合わせる：上に台帳、左に新聞、中央に地図と勅令用紙＋判子、右に側近の書簡・結果の書類束・メモ帳、
// 下の端に既決箱。
// 結果の書類束は、届いた年（手元にあるとき）だけ机の上に重ねて出す。ランプは飾りなので出さない。

interface Props {
  readonly objects: readonly DeskObjectId[];
  readonly render: (id: DeskObjectId, interactive: boolean) => ReactNode;
  readonly desk: DeskUiState;
  readonly onPick: (id: PickableId) => void;
  readonly onPutDown: () => void;
  readonly weather: Weather;
}

function FlatObject({ id, onOpen, children }: { readonly id: DeskObjectId; readonly onOpen?: () => void; readonly children: ReactNode }) {
  return (
    <div
      className={`flat-object flat-object-${id} ${onOpen ? "is-openable" : ""}`}
      data-object={id}
      data-state="flat"
      tabIndex={-1}
      aria-label={messages.ui.desk.objects[id]}
      onClick={onOpen}
    >
      {children}
    </div>
  );
}

export function FlatDesk({ objects, render, desk, onPick, onPutDown, weather }: Props) {
  const has = (id: DeskObjectId) => objects.includes(id);
  const resultInHand = desk.focused === "result" && has("result");
  const slot = (id: DeskObjectId, onOpen?: () => void) =>
    has(id) ? (
      <FlatObject id={id} {...(onOpen ? { onOpen } : {})}>
        {render(id, true)}
      </FlatObject>
    ) : null;

  return (
    <div className="flat-desk" data-testid="flat-desk">
      <WindowLight weather={weather} />
      {slot("ledger")}
      <div className="desk-grid">
        <div className="desk-column">{slot("newspaper")}</div>
        <div className="desk-column">
          {slot("map")}
          <div className="decree-row">
            {slot("decree")}
            {slot("stamp")}
          </div>
        </div>
        <div className="desk-column">
          {slot("letters")}
          {/* 机の上の束は、クリックでもう一度手に取って読み返せる */}
          {!resultInHand && slot("result", () => onPick("result"))}
          {slot("notepad")}
        </div>
      </div>
      {/* 既決箱は机の端：取り出した書類（新聞など）を広げられるよう、幅いっぱいに置く */}
      {slot("archive")}
      {resultInHand && (
        <div
          className="overlay fade-in"
          role="dialog"
          aria-modal="true"
          aria-label={messages.ui.desk.objects.result}
          onClick={(e) => e.target === e.currentTarget && onPutDown()}
          onContextMenu={(e) => {
            e.preventDefault();
            onPutDown();
          }}
        >
          {slot("result")}
        </div>
      )}
    </div>
  );
}
