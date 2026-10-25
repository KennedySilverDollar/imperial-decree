import { Either, ParseResult, Schema } from "effect";
import { TEMPLATES, TRIGGER_IDS, NUMBER_SOURCES, type ArticleTemplateData } from "../content/newspaper/ja";
import { SECTIONS, SLOT_NAMES, THREAD_KEYS } from "../domain/News";

// 記事テンプレートの Effect Schema（v3.2 §1.11「Effect Schema で型検証」/ CLAUDE.md §4-16）。
// 形の検証に加えて、文面の {slot} がすべて slots に宣言されていること・宣言した slot が文面で使われていることを確かめる。

const PLACEHOLDER = /\{(\w+)\}/g;
const placeholders = (texts: readonly string[]): string[] => texts.flatMap((t) => [...t.matchAll(PLACEHOLDER)].map((m) => m[1] ?? ""));

const ArticleTextSchema = Schema.Struct({
  headline: Schema.NonEmptyTrimmedString,
  body: Schema.NonEmptyArray(Schema.NonEmptyTrimmedString),
});

const Weight = Schema.Number.pipe(Schema.positive());
const Sensitivity = Schema.Number.pipe(Schema.between(0, 1));

const TemplateShape = Schema.Struct({
  id: Schema.String.pipe(Schema.pattern(/^[NE]-\d{2}[a-z]?$/)),
  type: Schema.String.pipe(Schema.pattern(/^[NE]-\d{2}$/)),
  section: Schema.Literal(...SECTIONS),
  trigger: Schema.Literal(...TRIGGER_IDS),
  weight: Weight,
  negative: Schema.Boolean,
  slots: Schema.Array(Schema.Literal(...SLOT_NAMES)),
  bias: Schema.Struct({ ideological: Sensitivity, censorship: Sensitivity, bureaucratic: Sensitivity }),
  numberSource: Schema.optionalWith(Schema.Literal(...NUMBER_SOURCES), { exact: true }),
  threadKey: Schema.optionalWith(Schema.Literal(...THREAD_KEYS), { exact: true }),
  praise: Schema.optionalWith(ArticleTextSchema, { exact: true }),
  uncensorable: Schema.optionalWith(Schema.Boolean, { exact: true }),
  headline: ArticleTextSchema.fields.headline,
  body: ArticleTextSchema.fields.body,
});

/** 1本のテンプレートの検証で見つかった問題（なければ空） */
export const slotProblems = (t: Schema.Schema.Type<typeof TemplateShape>): string[] => {
  const problems: string[] = [];
  const declared = new Set<string>(t.slots);
  const texts = [t.headline, ...t.body];
  const praiseTexts = t.praise ? [t.praise.headline, ...t.praise.body] : [];
  for (const name of placeholders([...texts, ...praiseTexts])) {
    if (!declared.has(name)) problems.push(`{${name}} is not declared`);
  }
  const used = new Set(placeholders(texts));
  for (const name of t.slots) if (!used.has(name)) problems.push(`slot ${name} is declared but unused`);
  if (t.slots.includes("num") !== (t.numberSource !== undefined)) problems.push("num slot and numberSource must go together");
  if (!t.id.startsWith(t.type)) problems.push("id must start with type");
  return problems;
};

export const TemplateSchema = TemplateShape.pipe(
  Schema.filter((t) => {
    const problems = slotProblems(t);
    return problems.length === 0 ? true : `${t.id}: ${problems.join(", ")}`;
  }),
);

export const TemplatesSchema = Schema.Array(TemplateSchema).pipe(
  Schema.filter((list) => {
    const ids = list.map((t) => t.id);
    return new Set(ids).size === ids.length ? true : "template ids must be unique";
  }),
);

export const decodeTemplates = (input: unknown): Either.Either<readonly ArticleTemplateData[], string> =>
  Either.mapLeft(Schema.decodeUnknownEither(TemplatesSchema)(input), (e) => ParseResult.TreeFormatter.formatErrorSync(e));

/** 検証済みのテンプレート。データが壊れていたら起動時に落とす（テンプレートは同梱のデータで、実行中には変わらない） */
export const VALIDATED_TEMPLATES: readonly ArticleTemplateData[] = Either.getOrThrowWith(
  decodeTemplates(TEMPLATES),
  (message) => new Error(`newspaper templates are invalid:\n${message}`),
);
