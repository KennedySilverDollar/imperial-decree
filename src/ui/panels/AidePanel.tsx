import { useState } from "react";
import { ALL_AIDE_PROFILES, type Aide } from "../../domain/Aide";
import { APPOINT_POLITICAL_COST, MAX_AIDES } from "../../domain/constants";
import type { AideReport } from "../../domain/TurnRecord";
import { renderReportNote } from "../../engine/ResultView";
import { aideName, messages } from "../../i18n/messages";

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

function ReportLetter({ report }: { readonly report: AideReport | undefined }) {
  if (!report) return <p className="report-empty">{t.noReport}</p>;
  const lines = [
    ...report.items.map((item) => messages.reports.item(messages.params[item.param], item.delta)),
    ...report.notes.map(renderReportNote),
  ];
  return (
    <div className="report-letter fade-in">
      <div className="report-header">{messages.reports.header(aideName(report.aideId))}</div>
      {lines.length === 0 ? <p>{messages.reports.nothingToReport}</p> : lines.map((line, i) => <p key={i}>{line}</p>)}
    </div>
  );
}

interface Props {
  readonly aides: readonly Aide[];
  readonly reports: readonly AideReport[];
  readonly candidates: readonly string[];
  readonly politicalCapital: number;
  readonly disabled: boolean;
  readonly onAppoint: (candidateId: string) => void;
  readonly onDismiss: (aideId: string) => void;
}

export function AidePanel({ aides, reports, candidates, politicalCapital, disabled, onAppoint, onDismiss }: Props) {
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
            <ReportLetter report={reports.find((r) => r.aideId === aide.id)} />
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
