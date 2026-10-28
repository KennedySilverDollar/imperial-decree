import type { BuildingId } from "../../domain/Buildings";
import { PARCEL_ARCHIVE_MAX } from "../../domain/constants";
import type { TurnRecord } from "../../domain/TurnRecord";
import { renderReportNote } from "../../engine/ResultView";
import type { MapViewModel } from "../map/MapViewModel";

// 区画の記録（SPEC_v3.4 §7.2）：区画を選んだときに出す、その区画に関係する過去の記事と側近報告。
// プレイヤーがすでに読んだ紙面と報告から拾うだけで、新しい情報は足さない。
// 関係の判定：記事は「その区画の建物（普請中を含む）の種類」に関する記事か、本文・見出しにその区画の小字が出る記事。
// 報告は、その区画の建物の種類についての着工・完成の知らせ。
// 空洞の開示（hollowDisclosed）は拾わない：種類ごとの知らせを区画に結びつけると、どの区画が空洞かを地図が示すように
// 見えるため（不変条件21・I-32。DECISIONS §17.11）。記事の真実度（truthfulness）は出さない（不変条件13）。

export interface ArchiveEntry {
  readonly turn: number;
  readonly source: "newspaper" | "report";
  readonly text: string;
}

const kindsAt = (view: MapViewModel, gridIndex: number): Set<BuildingId> => {
  const kinds = new Set<BuildingId>();
  for (const b of view.buildings) if (b.gridIndex === gridIndex) kinds.add(b.kind);
  for (const w of view.construction) if (w.gridIndices.includes(gridIndex)) kinds.add(w.kind);
  return kinds;
};

/** 新しい年が先。同じ年の中は新聞 → 報告の順。多すぎると読めないので PARCEL_ARCHIVE_MAX 件まで */
export const parcelArchive = (
  history: readonly TurnRecord[],
  view: MapViewModel,
  gridIndex: number,
  placeName: string | null,
): ArchiveEntry[] => {
  const kinds = kindsAt(view, gridIndex);
  const out: ArchiveEntry[] = [];
  for (const record of [...history].reverse()) {
    for (const a of record.newspaper.articles) {
      const byKind = a.relatedEntity?.kind === "building" && kinds.has(a.relatedEntity.id as BuildingId);
      const byPlace = placeName !== null && placeName.length > 0 && [a.headline, ...a.body].some((t) => t.includes(placeName));
      if (byKind || byPlace) out.push({ turn: record.turn, source: "newspaper", text: a.headline });
    }
    for (const report of record.aideReports) {
      for (const note of report.notes) {
        if ((note.kind === "completed" || note.kind === "constructionEstimate") && kinds.has(note.building)) {
          out.push({ turn: record.turn, source: "report", text: renderReportNote(note) });
        }
      }
    }
  }
  // 同じ年の同じ知らせ（側近が2人とも同じ着工・完成を報告するなど）は1つにまとめる
  const seen = new Set<string>();
  return out
    .filter((e) => {
      const key = `${e.turn}:${e.source}:${e.text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, PARCEL_ARCHIVE_MAX);
};
