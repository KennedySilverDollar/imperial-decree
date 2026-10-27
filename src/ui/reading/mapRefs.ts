import { createContext, useContext } from "react";
import type { BuildingId } from "../../domain/Buildings";
import type { Zone } from "../../domain/Landscape";

// 並べ読み（SPEC_v3.3 §4.6）：新聞・側近書簡の中の地名（区域の名）と建物の名にかざすと、地図の該当区画を朱でほのかに示す。
// 建物の名は、記事の relatedEntity（v3.2）と、報告の行が扱う建物だけを結ぶ（同じ名の別の話には結ばない）。
// 机（Desk）が文脈を配り、新聞・書簡はその文脈で語を見つけて印を付ける。地図は受け取ったしるしを描くだけ。

export type MapRef = { readonly kind: "zone"; readonly zone: Zone } | { readonly kind: "building"; readonly building: BuildingId };

export interface MapRefTerm {
  readonly term: string;
  readonly ref: MapRef;
}

export interface MapRefContextValue {
  /** 地図が並んで見えているか（並べ読み・平面モード）。見えていなければ語に印を付けない */
  readonly active: boolean;
  /** その領地の区域の名 */
  readonly zones: readonly MapRefTerm[];
  readonly onRef: (ref: MapRef | null) => void;
}

export const MapRefContext = createContext<MapRefContextValue>({ active: false, zones: [], onRef: () => {} });

export const useMapRefs = (): MapRefContextValue => useContext(MapRefContext);

export const sameRef = (a: MapRef | null, b: MapRef | null): boolean =>
  a === null || b === null ? a === b : a.kind === "zone" ? b.kind === "zone" && a.zone === b.zone : b.kind === "building" && a.building === b.building;

export type Segment = { readonly text: string; readonly ref: MapRef | null };

/** 文を、語に当たる所で切る（長い語を先に当てる。重ならない） */
export const splitByTerms = (text: string, terms: readonly MapRefTerm[]): readonly Segment[] => {
  const sorted = [...terms].filter((t) => t.term !== "").sort((a, b) => b.term.length - a.term.length);
  const out: Segment[] = [];
  let rest = text;
  while (rest.length > 0) {
    let best: { at: number; term: MapRefTerm } | null = null;
    for (const term of sorted) {
      const at = rest.indexOf(term.term);
      if (at >= 0 && (best === null || at < best.at)) best = { at, term };
    }
    if (best === null) {
      out.push({ text: rest, ref: null });
      break;
    }
    if (best.at > 0) out.push({ text: rest.slice(0, best.at), ref: null });
    out.push({ text: best.term.term, ref: best.term.ref });
    rest = rest.slice(best.at + best.term.term.length);
  }
  return out;
};
