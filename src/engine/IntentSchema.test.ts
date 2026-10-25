import { Either, JSONSchema, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { TargetSchema } from "./IntentSchema";
import { messages } from "../i18n/messages";
import { buildDecreeIntentSchema } from "../proxy/schema";
import { BUILDING_IDS, BUILDINGS, CATEGORY_PLACEMENT_ORDER, CATEGORIES, POLICY_IDS, TARGETS } from "../domain/Buildings";

// enum の単一ソース（CLAUDE.md §4-11 / v3.2 §2.2）

describe("20 種の enum（建物17＋政策3）", () => {
  it("TARGETS は建物17と政策3で、重複がない", () => {
    expect(BUILDING_IDS).toHaveLength(17);
    expect(POLICY_IDS).toHaveLength(3);
    expect(TARGETS).toHaveLength(20);
    expect(new Set(TARGETS).size).toBe(20);
  });

  it("20種すべてが Effect Schema を通り、未知の値は落ちる", () => {
    const decode = Schema.decodeUnknownEither(TargetSchema);
    for (const target of TARGETS) expect(Either.isRight(decode(target))).toBe(true);
    for (const bad of ["tax", "welfare", "security", "castle", "", 3]) expect(Either.isLeft(decode(bad))).toBe(true);
  });

  it("Effect Schema から生成した JSON Schema とプロキシの JSON Schema が同じ enum を持つ", () => {
    const generated = JSONSchema.make(TargetSchema) as { enum?: readonly string[] };
    expect(generated.enum).toEqual([...TARGETS]);
    for (const ranges of [false, true]) {
      const proxy = buildDecreeIntentSchema(ranges) as unknown as { properties: { target: { type: string; enum: readonly string[] } } };
      expect(proxy.properties.target).toEqual({ type: "string", enum: [...TARGETS] });
    }
  });

  it("全 target に表示名、全建物に地図記号と表の定義がある", () => {
    for (const target of TARGETS) expect(messages.targets[target]).toBeTruthy();
    for (const id of BUILDING_IDS) {
      expect(messages.tileGlyphs[id]).toHaveLength(1);
      expect(BUILDINGS[id].id).toBe(id);
      expect(BUILDINGS[id].recipe.minTurns).toBeGreaterThanOrEqual(1);
    }
  });

  it("配置の優先順位は全カテゴリを1回ずつ含む", () => {
    expect([...CATEGORY_PLACEMENT_ORDER].sort()).toEqual([...CATEGORIES].sort());
  });
});
