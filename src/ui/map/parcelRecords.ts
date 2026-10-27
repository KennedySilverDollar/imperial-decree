import type { BuildingId } from "../../domain/Buildings";
import { gridCoordOf, zoneOf } from "../../domain/Landscape";
import type { TurnRecord } from "../../domain/TurnRecord";
import type { Gazetteer } from "../../engine/Gazetteer";
import { renderReportNote } from "../../engine/ResultView";

// 区画をクリックしたときの「その区画に関係する過去の記事・側近報告」（SPEC_v3.3 §5.6：既決箱から検索）。
// 記事は、区画の区域の名（新聞の {place} はこの名で埋まる）か、区画の建物を扱った記事。
// 側近報告は、区画の建物について書いた行（完成・空洞の開示・工期の見込み）。新しい年から、最大 RELATED_LIMIT 件。

export const RELATED_LIMIT = 12;

export type RelatedRecord =
  | { readonly kind: "article"; readonly turn: number; readonly articleId: string; readonly headline: string }
  | { readonly kind: "report"; readonly turn: number; readonly aideId: string; readonly line: string };

export const relatedToParcel = (
  history: readonly TurnRecord[],
  gazetteer: Gazetteer,
  gridIndex: number,
  building: BuildingId | null,
): readonly RelatedRecord[] => {
  const [x, y] = gridCoordOf(gridIndex);
  const zone = gazetteer.zones[zoneOf(x, y)];
  const out: RelatedRecord[] = [];
  for (const record of [...history].reverse()) {
    for (const a of record.newspaper.articles) {
      const text = [a.headline, ...a.body].join("");
      const aboutBuilding = building !== null && a.relatedEntity?.kind === "building" && a.relatedEntity.id === building;
      if (text.includes(zone) || aboutBuilding) out.push({ kind: "article", turn: record.newspaper.turn, articleId: a.id, headline: a.headline });
    }
    if (building === null) continue;
    for (const report of record.aideReports)
      for (const note of report.notes) {
        if (!("building" in note) || note.building !== building) continue;
        out.push({ kind: "report", turn: record.turn, aideId: report.aideId, line: renderReportNote(note) });
      }
  }
  return out.slice(0, RELATED_LIMIT);
};
