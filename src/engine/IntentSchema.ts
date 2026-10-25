import { JSONSchema, Schema } from "effect";
import { ACTIONS, TARGETS } from "../domain/Vocabulary";

// action / target の Effect Schema と、そこから生成する JSON Schema（CLAUDE.md §4-11）。
// 語彙の出所は domain/Buildings.ts（20種）と domain/Vocabulary.ts（action）だけ。
// プロキシの Structured Outputs のスキーマもここから作る（手で enum を並べない）。

export const ActionSchema = Schema.Literal(...ACTIONS);
export const TargetSchema = Schema.Literal(...TARGETS);

/** JSONSchema.make の出力から $schema を除いた、プロパティとして埋め込める形 */
const embeddable = (schema: Schema.Schema.Any): Record<string, unknown> => {
  const generated: Record<string, unknown> = { ...(JSONSchema.make(schema) as unknown as Record<string, unknown>) };
  delete generated["$schema"];
  return generated;
};

export const actionJsonSchema = embeddable(ActionSchema);
export const targetJsonSchema = embeddable(TargetSchema);
