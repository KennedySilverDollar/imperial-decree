import { describe, expect, it } from "vitest";
import { hatchSegments } from "../map/geometry2d";
import { sameRef, splitByTerms } from "./mapRefs";

// 並べ読み（SPEC_v3.3 §4.6）：語の切り出しと、区画のしるしの斜線

describe("語の切り出し", () => {
  const terms = [
    { term: "東の鷺川沿い", ref: { kind: "zone", zone: "east" } as const },
    { term: "倉庫", ref: { kind: "building", building: "granary" } as const },
  ];
  it("地名・建物の名に当たる所で切り、それ以外はそのまま", () => {
    const parts = splitByTerms("東の鷺川沿いの倉庫が空との噂。倉庫番は否定", terms);
    expect(parts.map((p) => p.text).join("")).toBe("東の鷺川沿いの倉庫が空との噂。倉庫番は否定");
    expect(parts.filter((p) => p.ref !== null).map((p) => p.text)).toEqual(["東の鷺川沿い", "倉庫", "倉庫"]);
  });
  it("長い語を先に当てる（区域の名の中の短い語に食われない）", () => {
    const parts = splitByTerms("北東の鷺川沿い", [{ term: "鷺川", ref: { kind: "zone", zone: "east" } }, { term: "北東の鷺川沿い", ref: { kind: "zone", zone: "northeast" } }]);
    expect(parts).toEqual([{ text: "北東の鷺川沿い", ref: { kind: "zone", zone: "northeast" } }]);
  });
  it("しるしの比較", () => {
    expect(sameRef({ kind: "zone", zone: "east" }, { kind: "zone", zone: "east" })).toBe(true);
    expect(sameRef({ kind: "zone", zone: "east" }, { kind: "building", building: "well" })).toBe(false);
    expect(sameRef(null, null)).toBe(true);
  });
});

describe("区画のしるしの斜線", () => {
  it("多角形の内側だけに、間隔ごとの平行線を引く", () => {
    const square = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const lines = hatchSegments(square, 10, 0);
    expect(lines.length).toBeGreaterThanOrEqual(9);
    for (const [a, b] of lines) {
      expect(a.y).toBeCloseTo(b.y);
      expect(Math.min(a.x, b.x)).toBeCloseTo(0);
      expect(Math.max(a.x, b.x)).toBeCloseTo(100);
    }
  });
});
