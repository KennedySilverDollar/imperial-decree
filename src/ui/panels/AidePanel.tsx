import { useState } from "react";
import { ALL_AIDE_PROFILES, type Aide } from "../../domain/Aide";
import { APPOINT_POLITICAL_COST, MAX_AIDES } from "../../domain/constants";
import type { BuildingId } from "../../domain/Buildings";
import type { PlayerNote } from "../../domain/PlayerNotes";
import type { AideReport } from "../../domain/TurnRecord";
import { renderReportNote } from "../../engine/ResultView";
import { aideName, messages } from "../../i18n/messages";
import { PinnedNotes } from "./PinnedNotes";
import { RefText } from "../reading/RefText";

const t = messages.ui.aides;

type AideLike = Pick<Aide, "id" | "loyalty" | "ability" | "ambition" | "trust" | "faction" | "specialty">;

function AideProfile({ aide }: { readonly aide: AideLike }) {
  return (
    <div className="aide-profile">
      <div className="aide-name">{aideName(aide.id)}</div>
      <div className="aide-intro">{messages.aides[aide.id]?.intro}</div>
      <div className="aide-meta">{t.factionSpecialty(messages.factions[aide.faction], messages.specialties[aide.specialty])}</div>
      <dl className="aide-stats">
        {(["loyalty", "ability", "ambition", "trust"] as const).map((key) => (
          <div key={key}>
            <dt>{t.params[key]}</dt>
            <dd>{aide[key]}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** 開いた書簡の本文（既決箱でも使う） */
export function ReportLetter({ report, notes = [] }: { readonly report: AideReport; readonly notes?: readonly PlayerNote[] }) {
  // 報告の行と、その行が扱う建物（並べ読みで地図の区画を示す）
  const lines: { text: string; building: BuildingId | null }[] = [
    ...report.items.map((item) => ({ text: messages.reports.item(messages.params[item.param], item.delta), building: null })),
    ...report.notes.map((note) => ({ text: renderReportNote(note), building: "building" in note ? note.building : null })),
  ];
  return (
    <div className="report-letter fade-in" data-testid={`report-${report.aideId}`}>
      <div className="report-header">{messages.reports.header(aideName(report.aideId))}</div>
      <div className="report-body">
        {lines.length === 0 ? <p>{messages.reports.nothingToReport}</p> : lines.map((line, i) => (
              <p key={i}>
                <RefText text={line.text} buildings={line.building === null ? [] : [{ term: messages.targets[line.building], ref: { kind: "building", building: line.building } }]} />
              </p>
            ))}
      </div>
      <PinnedNotes notes={notes} />
    </div>
  );
}

/**
 * 封書（SPEC_v3.3 §3.2）：届いた報告は封蝋で閉じてあり、折り目が付いている（未読の印）。
 * 封蝋を割ると開いて読める。開いたかどうかは机の UI ストアが年ごとに持つ。
 */
function SealedLetter(props: {
  readonly report: AideReport | undefined;
  readonly opened: boolean;
  readonly canOpen: boolean;
  readonly onOpen: () => void;
  readonly notes: readonly PlayerNote[];
}) {
  const { report } = props;
  if (!report) return <p className="report-empty">{t.noReport}</p>;
  if (props.opened) return <ReportLetter report={report} notes={props.notes} />;
  return (
    <div className="envelope is-sealed" data-testid={`envelope-${report.aideId}`}>
      <div className="envelope-front">{messages.reports.header(aideName(report.aideId))}</div>
      <p className="envelope-note">{t.unread}</p>
      <button
        className="wax-seal"
        disabled={!props.canOpen}
        onClick={props.onOpen}
        aria-label={t.breakSeal(aideName(report.aideId))}
        data-testid={`open-letter-${report.aideId}`}
      >
        <span aria-hidden>{t.sealGlyph}</span>
      </button>
    </div>
  );
}

interface Props {
  readonly aides: readonly Aide[];
  readonly reports: readonly AideReport[];
  readonly candidates: readonly string[];
  readonly politicalCapital: number;
  readonly disabled: boolean;
  /** 封蝋を割れる（手元にある）か */
  readonly canOpen: boolean;
  readonly opened: (aideId: string) => boolean;
  readonly onOpen: (aideId: string) => void;
  /** 書簡に留めたメモ */
  readonly notesFor: (aideId: string) => readonly PlayerNote[];
  readonly onAppoint: (candidateId: string) => void;
  readonly onDismiss: (aideId: string) => void;
}

export function AidePanel({ aides, reports, candidates, politicalCapital, disabled, canOpen, opened, onOpen, notesFor, onAppoint, onDismiss }: Props) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const seatsOpen = aides.length < MAX_AIDES;
  const candidateProfiles = candidates
    .map((id) => ALL_AIDE_PROFILES.find((profile) => profile.id === id))
    .filter((profile): profile is (typeof ALL_AIDE_PROFILES)[number] => profile !== undefined);

  return (
    <section className="panel aide-panel" aria-label={messages.ui.panels.aides}>
      <h2 className="panel-title">{messages.ui.panels.aides}</h2>
      {aides.length === 0 && <p className="warning-text">{t.empty}</p>}
      <div className="aide-list">
        {aides.map((aide) => (
          <article className="paper letter" key={aide.id} data-testid={`aide-${aide.id}`}>
            <AideProfile aide={aide} />
            <SealedLetter
              report={reports.find((r) => r.aideId === aide.id)}
              opened={opened(aide.id)}
              canOpen={canOpen}
              onOpen={() => onOpen(aide.id)}
              notes={notesFor(aide.id)}
            />
            <div className="aide-actions">
              {confirming === aide.id ? (
                <>
                  <button className="button danger" disabled={disabled} onClick={() => { setConfirming(null); onDismiss(aide.id); }}>
                    {t.dismissConfirm}
                  </button>
                  <button className="button" onClick={() => setConfirming(null)}>
                    {messages.ui.cancel}
                  </button>
                </>
              ) : (
                <button className="button subtle" disabled={disabled} onClick={() => setConfirming(aide.id)}>
                  {t.dismiss}
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
      {seatsOpen && (
        <div className="appoint">
          <h3 className="appoint-heading">{t.appointHeading}</h3>
          {aides.length > 0 && <p className="panel-note">{t.seatOpen}</p>}
          <div className="aide-list">
            {candidateProfiles.map((profile) => (
              <article className="paper letter candidate" key={profile.id} data-testid={`candidate-${profile.id}`}>
                <AideProfile aide={profile} />
                <button
                  className="button"
                  disabled={disabled || politicalCapital < APPOINT_POLITICAL_COST}
                  onClick={() => onAppoint(profile.id)}
                >
                  {t.appoint(APPOINT_POLITICAL_COST)}
                </button>
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
