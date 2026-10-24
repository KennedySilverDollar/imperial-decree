import { useState, type ReactNode } from "react";
import type { DecreeIntent } from "../../domain/DecreeIntent";
import type { TurnRecord } from "../../domain/TurnRecord";
import { PARAM_KEYS } from "../../domain/Vocabulary";
import { buildThreeTierView, renderExecutionNote, renderThreeTier } from "../../engine/ResultView";
import { aideName, messages } from "../../i18n/messages";

// 3段表示＋意図比較（SPEC §6.5, §12.6）：書類が重なり、めくると下層が見える。差分は朱色の訂正線。

const r = messages.ui.result;

/** 朱色の訂正線：元の値に線を引き、横に直した値を書く */
function Correction({ label, from, to }: { readonly label: string; readonly from: string; readonly to: string }) {
  return (
    <p className="correction">
      <span className="correction-label">{label}</span>
      <del className="struck">{from}</del>
      <ins className="amended">{to}</ins>
    </p>
  );
}

const round = (n: number) => String(Math.round(n));
const percent = (n: number) => `${Math.round(n * 100)}%`;
const targetName = (intent: DecreeIntent) =>
  intent.target === null ? messages.interpretation.unknownTarget : messages.targets[intent.target];

interface Sheet {
  readonly key: string;
  readonly title: string;
  readonly body: ReactNode;
  readonly memo?: boolean;
}

const buildSheets = (record: TurnRecord): readonly Sheet[] => {
  const view = buildThreeTierView(record);
  const text = renderThreeTier(view);
  const sheets: Sheet[] = [];

  sheets.push({
    key: "interpretation",
    title: messages.threeTier.interpretation,
    body: (
      <>
        <p className="decree-quote">{r.decreeQuote(record.decree.text)}</p>
        {view.interpretation === null ? <p>{r.noInterpretation}</p> : text.interpretation.map((line, i) => <p key={i}>{line}</p>)}
      </>
    ),
  });

  const adjustment = view.correction.adjustment;
  const original = view.interpretation?.intent;
  sheets.push({
    key: "correction",
    title: messages.threeTier.correction,
    body: (
      <>
        {adjustment !== null && (
          <>
            <p>{messages.threeTier.chosenAide(aideName(adjustment.aideId), messages.selectionReasons[adjustment.reason])}</p>
            <p className="panel-note">{messages.threeTier.accuracy(adjustment.accuracy)}</p>
            {adjustment.distortions.length === 0 && <p>{messages.distortions.none}</p>}
            {adjustment.distortions.map((d, i) =>
              d.kind === "misread" ? (
                <Correction key={i} label={r.fieldMagnitude} from={round(d.from)} to={round(d.to)} />
              ) : d.kind === "targetSwap" ? (
                <Correction key={i} label={r.fieldTarget} from={messages.targets[d.from]} to={messages.targets[d.to]} />
              ) : (
                <Correction key={i} label={r.fieldEffect} from={percent(1)} to={percent(d.factor)} />
              ),
            )}
          </>
        )}
        {view.correction.execution.notes.map((note, i) =>
          note.kind === "budgetScaled" ? (
            <div key={i}>
              <Correction
                label={r.fieldMagnitude}
                from={original ? round(adjustment?.adjustedIntent.magnitude ?? original.magnitude) : percent(1)}
                to={original ? round((adjustment?.adjustedIntent.magnitude ?? original.magnitude) * note.ratio) : percent(note.ratio)}
              />
              <p className="panel-note">{renderExecutionNote(note)}</p>
            </div>
          ) : (
            <p key={i} className={note.kind === "applied" ? "" : "note-strong"}>
              {renderExecutionNote(note)}
            </p>
          ),
        )}
        {adjustment !== null && original && (
          <p className="panel-note">
            {messages.interpretation.summary(
              messages.actions[adjustment.adjustedIntent.action],
              targetName(adjustment.adjustedIntent),
              adjustment.adjustedIntent.magnitude,
              adjustment.adjustedIntent.budget,
            )}
          </p>
        )}
      </>
    ),
  });

  const before = view.result.facilitiesBefore;
  const after = view.result.facilitiesAfter;
  const facilityLines = [
    ...(after.officeBuilt && !before.officeBuilt ? [r.facilities.office] : []),
    ...(after.marketCount > before.marketCount ? [r.facilities.market(after.marketCount - before.marketCount)] : []),
    ...(Math.floor(after.housingUnits) > Math.floor(before.housingUnits)
      ? [r.facilities.housing(Math.floor(after.housingUnits) - Math.floor(before.housingUnits))]
      : []),
  ];
  sheets.push({
    key: "result",
    title: messages.threeTier.result,
    body: (
      <>
        <table className="delta-table">
          <tbody>
            {PARAM_KEYS.map((param) => {
              const delta = Math.round(view.result.delta[param]);
              return (
                <tr key={param} className={delta === 0 ? "flat" : ""}>
                  <th>{messages.params[param]}</th>
                  <td>{delta > 0 ? `+${delta}` : String(delta)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {facilityLines.map((line) => (
          <p key={line}>{line}</p>
        ))}
        {text.result.length === 0 && facilityLines.length === 0 && <p>{r.noChange}</p>}
      </>
    ),
  });

  if (text.intentComparison !== null) {
    sheets.push({
      key: "intent",
      title: messages.threeTier.intentComparison,
      memo: true,
      body: text.intentComparison.map((line, i) => (
        <p key={i} className="pencil">
          {line}
        </p>
      )),
    });
  }
  return sheets;
};

interface Props {
  readonly record: TurnRecord;
  readonly onClose: (stats: { readonly flips: number; readonly deepestSheet: number }) => void;
}

export function ResultStack({ record, onClose }: Props) {
  const sheets = buildSheets(record);
  const [top, setTop] = useState(0);
  const [flips, setFlips] = useState(0);
  const [deepest, setDeepest] = useState(0);

  const go = (next: number) => {
    setTop(next);
    setFlips((n) => n + 1);
    setDeepest((d) => Math.max(d, next));
  };

  return (
    <div className="overlay fade-in" role="dialog" aria-modal="true" aria-label={r.heading(record.turn)}>
      <div className="result-stack">
        <h2 className="result-heading">{r.heading(record.turn)}</h2>
        <div className="sheets" data-testid="result-sheets">
          {sheets.map((sheet, index) => {
            const offset = index - top;
            const state = offset < 0 ? "flipped" : offset === 0 ? "current" : "under";
            return (
              <article
                key={sheet.key}
                className={`paper sheet sheet-${state} ${sheet.memo ? "memo" : ""}`}
                style={{ zIndex: sheets.length - index, ["--depth" as string]: Math.max(0, offset) }}
                aria-hidden={state !== "current"}
                onClick={() => state === "under" && go(index)}
              >
                <h3 className="sheet-title">{sheet.title}</h3>
                <div className="sheet-body">{sheet.body}</div>
              </article>
            );
          })}
        </div>
        <div className="sheet-controls">
          <button className="button" disabled={top === 0} onClick={() => go(top - 1)}>
            {r.back}
          </button>
          <span className="sheet-count">{r.sheetOf(top + 1, sheets.length)}</span>
          <button className="button" disabled={top >= sheets.length - 1} onClick={() => go(top + 1)} data-testid="flip">
            {r.flip}
          </button>
          <button className="button primary" onClick={() => onClose({ flips, deepestSheet: deepest + 1 })} data-testid="close-result">
            {r.close}
          </button>
        </div>
      </div>
    </div>
  );
}
