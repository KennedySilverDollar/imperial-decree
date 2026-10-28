import { describe, expect, it } from "vitest";
import { PARCEL_ARCHIVE_MAX } from "../../domain/constants";
import { createInitialState } from "../../domain/GameState";
import type { NewspaperArticle } from "../../domain/News";
import type { ReportNote, TurnRecord } from "../../domain/TurnRecord";
import { parcelArchive } from "./parcelArchive";
import { projectMapView } from "./projectMapView";

// 区画の記録（§7.2）：すでに読んだ紙面と報告から、その区画に関係するものを拾う。空洞の開示は拾わない（不変条件21）。

const article = (headline: string, body: string, building: string | null): NewspaperArticle =>
  ({
    id: headline,
    section: "local",
    headline,
    body: [body],
    threadKey: null,
    isFollowUp: false,
    biasApplied: { ideological: 0, censorship: 0, bureaucratic: 0 },
    truthfulness: 0.5,
    relatedEntity: building ? { kind: "building", id: building } : null,
  }) as unknown as NewspaperArticle;

const record = (turn: number, articles: NewspaperArticle[], notes: ReportNote[]): TurnRecord =>
  ({
    turn,
    newspaper: { turn, seed: 0, articles },
    // 2人の側近が同じ知らせを書く
    aideReports: [
      { aideId: "a", items: [], notes, hiddenItems: [], concealed: false },
      { aideId: "b", items: [], notes, hiddenItems: [], concealed: false },
    ],
  }) as unknown as TurnRecord;

describe("parcelArchive", () => {
  const state = createInitialState(1);
  const view = projectMapView(state);
  const built = view.buildings[0]!;
  const empty = view.parcels.find((p) => p.use === "empty")!.gridIndex;

  it("その区画の建物の種類の記事・報告と、小字の出る記事を、新しい順に、重複なく拾う", () => {
    const history = [
      record(1, [article("住まいの話", "…", built.kind), article("遠い話", "…", null)], [{ kind: "completed", building: built.kind, count: 1, repair: false }]),
      record(2, [article("上町で祭り", "上町がにぎわう", null)], [{ kind: "hollowDisclosed", building: built.kind, count: 1 }]),
    ];
    const got = parcelArchive(history, view, built.gridIndex, "上町");
    expect(got.map((e) => [e.turn, e.source])).toEqual([
      [2, "newspaper"],
      [1, "newspaper"],
      [1, "report"],
    ]);
    expect(got.some((e) => e.text === "遠い話")).toBe(false);
    // 小字が違えば、その記事は拾わない。建物のない区画では種類の記事も拾わない
    expect(parcelArchive(history, view, empty, "下田")).toEqual([]);
  });

  it("空洞の開示は拾わない（どの区画が空洞かを地図が示さないように）", () => {
    const history = [record(3, [], [{ kind: "hollowDisclosed", building: built.kind, count: 1 }])];
    expect(parcelArchive(history, view, built.gridIndex, null)).toEqual([]);
  });

  it("多すぎるときは上限まで", () => {
    const history = Array.from({ length: 30 }, (_, k) => record(k + 1, [article(`記事${k}`, "…", built.kind)], []));
    expect(parcelArchive(history, view, built.gridIndex, null).length).toBe(PARCEL_ARCHIVE_MAX);
  });
});
