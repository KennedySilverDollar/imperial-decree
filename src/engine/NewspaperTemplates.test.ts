import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { TEMPLATES } from "../content/newspaper/ja";
import { decodeTemplates, VALIDATED_TEMPLATES } from "./NewspaperTemplates";

// 記事テンプレート（v3.2 §1.3, §1.11 / DECISIONS V-11, Z-16）

describe("テンプレートの Effect Schema 検証", () => {
  it("同梱の28本はすべて検証を通る", () => {
    expect(Either.isRight(decodeTemplates(TEMPLATES))).toBe(true);
    expect(VALIDATED_TEMPLATES).toHaveLength(28);
  });

  it("記事タイプ N-01〜N-20 が揃い、バリエーションは N-01/09/16/18 に各1本（計24本）＋E-01〜03・N-21", () => {
    const types = new Set(TEMPLATES.map((t) => t.type));
    for (let i = 1; i <= 20; i++) expect(types).toContain(`N-${String(i).padStart(2, "0")}`);
    const core = TEMPLATES.filter((t) => /^N-(0\d|1\d|20)$/.test(t.type));
    expect(core).toHaveLength(24);
    const variants = core.filter((t) => t.id !== t.type).map((t) => t.type).sort();
    expect(variants).toEqual(["N-01", "N-09", "N-16", "N-18"]);
    expect(TEMPLATES.filter((t) => !core.includes(t)).map((t) => t.type).sort()).toEqual(["E-01", "E-02", "E-03", "N-21"]);
  });

  const base = TEMPLATES[0];
  if (!base) throw new Error("テンプレートがない");

  it.each([
    ["宣言していないスロット", { ...base, headline: "{aide}の話" }],
    ["使っていないスロット", { ...base, slots: [...base.slots, "faction"] }],
    ["未知のスロット名", { ...base, slots: [...base.slots, "weather"] }],
    ["空の本文", { ...base, body: [] }],
    ["空白だけの見出し", { ...base, headline: "  " }],
    ["未知のセクション", { ...base, section: "sports" }],
    ["感度が範囲外", { ...base, bias: { ...base.bias, censorship: 2 } }],
    ["num があるのに数値の出所がない", Object.fromEntries(Object.entries(base).filter(([key]) => key !== "numberSource"))],
  ])("%s は落ちる", (_label, broken) => {
    expect(Either.isLeft(decodeTemplates([broken]))).toBe(true);
  });

  it("ID の重複は落ちる", () => {
    expect(Either.isLeft(decodeTemplates([base, base]))).toBe(true);
  });
});
