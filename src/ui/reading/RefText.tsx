import { splitByTerms, useMapRefs, type MapRefTerm } from "./mapRefs";

// 文の中の地名・建物の名に、かざすと地図を示す印を付ける（並べ読み：SPEC_v3.3 §4.6）。
// 地図が並んでいないときは、ただの文として描く（平面と立体で読める文字は同じ）。

export function RefText({ text, buildings = [] }: { readonly text: string; readonly buildings?: readonly MapRefTerm[] }) {
  const { active, zones, onRef } = useMapRefs();
  if (!active) return <>{text}</>;
  return (
    <>
      {splitByTerms(text, [...zones, ...buildings]).map((segment, i) =>
        segment.ref === null ? (
          segment.text
        ) : (
          <span
            key={i}
            className="map-ref"
            data-testid="map-ref"
            onPointerEnter={() => onRef(segment.ref)}
            onPointerLeave={() => onRef(null)}
          >
            {segment.text}
          </span>
        ),
      )}
    </>
  );
}
