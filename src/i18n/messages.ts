// 全文言（CLAUDE.md §4-6）。エンジン・UI は日本語リテラルを持たず、ここを参照する。
// テンプレートパーサーの辞書・メタ命令パターンも言語依存の語彙としてここに置く。

import type { Action, ParamKey, Target } from "../domain/Vocabulary";
import type { SelectionReason } from "../domain/Aide";
import type { GameOverReason } from "../domain/Ending";
import type { FixedCostFailure, LLMFailureReason, NewspaperTone, NoopReason } from "../domain/TurnRecord";
import type { IntentDirection } from "../domain/IntentDeclaration";
import type { ScaleTagValue } from "../domain/Decree";

const fmt = (value: number): string => String(Math.round(value));
const signed = (value: number): string => (value > 0 ? `+${fmt(value)}` : fmt(value));
const percent = (ratio: number): string => `${Math.round(ratio * 100)}%`;

export const messages = {
  params: {
    population: "人口",
    treasury: "国庫",
    happiness: "幸福度",
    infrastructure: "インフラ",
    corruption: "汚職率",
  } satisfies Record<ParamKey, string>,

  targets: {
    residential: "住宅",
    road: "道路",
    well: "井戸",
    office: "役所",
    market: "市場",
    tax: "税",
    welfare: "福祉",
    security: "治安",
  } satisfies Record<Target, string>,

  actions: {
    build: "建設",
    tax: "徴税",
    invest: "投資",
    reform: "改革",
    appoint: "任命",
    dismiss: "解任",
  } satisfies Record<Action, string>,

  scaleTags: { small: "小", medium: "中", large: "大" } satisfies Record<ScaleTagValue, string>,

  intentDirections: {
    increase: "増やす",
    decrease: "減らす",
    absolute: "に到達させる",
  } satisfies Record<IntentDirection, string>,

  aides: {
    elderSteward: { name: "老練な代官", intro: "先代から仕える代官。堅実だが新しいことを好まない。" },
    youngMerchant: { name: "若い商人上がり", intro: "商才で取り立てられた若者。野心を隠さない。" },
    retiredCaptain: { name: "退役した隊長", intro: "規律を重んじる元兵士。施しを嫌う。" },
    templeScribe: { name: "寺院の書記", intro: "帳簿に明るい。急な変化を好まない。" },
    forestWarden: { name: "森の番人", intro: "水と森を守ってきた。道を通すのを嫌う。" },
    masonForeman: { name: "石工の親方", intro: "腕は確かだが、出世を狙っている。" },
    guildTreasurer: { name: "組合の会計役", intro: "数字に強く、野心はさらに強い。" },
    villageElder: { name: "村の長老", intro: "村人の信望が厚い。物覚えは衰えてきた。" },
  } as Record<string, { name: string; intro: string }>,

  selectionReasons: {
    specialty: "専門が一致したため",
    trust: "専門が一致する者のうち、最も信頼が厚いため",
    offSpecialty: "専門の者がおらず、信頼の厚い者に任せたため",
  } satisfies Record<SelectionReason, string>,

  interpretation: {
    summary: (action: string, target: string, magnitude: number, budget: number) =>
      `${target}を${action}する（規模 ${fmt(magnitude)}${budget > 0 ? `、予算 ${fmt(budget)}` : ""}）`,
    unknownTarget: "（対象を特定できず）",
    sourceLlm: "参謀の解釈",
    sourceTemplate: "参謀不在のため書記が字面から解釈",
    fallback: {
      timeout: "参謀の返答が遅れた",
      network: "参謀に連絡がつかなかった",
      invalidJson: "参謀の返答が読めなかった",
      schemaViolation: "参謀の返答が形式に合わなかった",
    } satisfies Record<LLMFailureReason, string>,
    metaRemoved: "不遜な文言は取り除かれた",
    clamped: (fields: readonly string[]) => `範囲外の値を丸めた（${fields.join("・")}）`,
  },

  distortions: {
    misread: (from: number, to: number) => `規模を読み違えた（${fmt(from)} → ${fmt(to)}）`,
    targetSwap: (from: string, to: string) => `対象を取り違えた（${from} → ${to}）`,
    waterDown: (factor: number) => `骨抜きにされた（効果 ${percent(factor)}）`,
    none: "指示どおりに伝えられた",
  },

  execution: {
    noAide: "側近が一人もおらず、勅令は執行されなかった",
    noop: {
      unknownTarget: "何を命じられたのか、意味が取れませんでした",
      lowConfidence: "御意図を測りかね、手を付けずにおきました",
      appointDismiss: "任免は勅令ではなく、御自らお決めください",
      invalidCombination: "そのような命じ方では、執り行いようがございません",
      nonPositive: "減らせとの仰せでしたが、取り壊しは致しかねます",
    } satisfies Record<NoopReason, string>,
    applied: "勅令は執行された",
    budgetScaled: (ratio: number, cause: "treasury" | "budget") =>
      cause === "treasury"
        ? `予算不足のため規模を${percent(ratio)}に縮小`
        : `指定の予算に合わせて規模を${percent(ratio)}に縮小`,
    nothingAffordable: "予算が無く、何もできなかった",
    officeBuilt: "役所が完成した",
    marketBuilt: "市場が開かれた",
    fixedCostFailed: (facility: string, reason: FixedCostFailure) => `${facility}は建たなかった（${messages.fixedCostFailures[reason]}）`,
  },

  fixedCostFailures: {
    alreadyBuilt: "すでにある",
    population: "人口が足りない",
    infrastructure: "インフラが足りない",
    treasury: "国庫が足りない",
    budget: "指定の予算では足りない",
    max: "これ以上は置けない",
  } satisfies Record<FixedCostFailure, string>,

  reports: {
    header: (aideName: string) => `${aideName}より御報告`,
    item: (param: string, delta: number) => `${param}は${signed(delta)}でございます`,
    nothingToReport: "特に申し上げることはございません",
    metaIgnored: "不遜な文言は聞かなかったことにいたします",
    hollowDisclosed: (amount: number) => `立派な道に見えますが、${fmt(amount)}ほどは中身がございません`,
  },

  newspaper: {
    title: (turn: number) => `辺境日報\u3000第${turn}年`,
    headline: {
      neutral: { up: (p: string) => `${p}、増加`, down: (p: string) => `${p}、減少`, flat: (p: string) => `${p}、横ばい` },
      euphemism: { up: (p: string) => `${p}、増加`, down: (p: string) => `${p}、わずかに調整`, flat: (p: string) => `${p}、安定` },
      boast: { up: (p: string) => `${p}、躍進！`, down: (p: string) => `${p}、減少`, flat: (p: string) => `${p}、盤石` },
    } satisfies Record<NewspaperTone, Record<"up" | "down" | "flat", (p: string) => string>>,
    line: (param: string, value: number, trendWord: string) => `${param}はおよそ${fmt(value)}。${trendWord}`,
    trendWords: {
      neutral: { up: "前年より増えた。", down: "前年より減った。", flat: "前年並み。" },
      euphemism: { up: "前年より増えた。", down: "やや落ち着いた。", flat: "変わらず安定。" },
      boast: { up: "目覚ましい伸びだ。", down: "前年より減った。", flat: "揺るぎない。" },
    } satisfies Record<NewspaperTone, Record<"up" | "down" | "flat", string>>,
    endings: {
      success: "村、ついに町へ　領主の治世を称える声",
      timeout: "村は町になれなかった",
      gameover: {
        population: "領地は無人となった",
        treasury: "国庫は底を突いた",
        happiness: "民衆は領主を見限った",
      } satisfies Record<GameOverReason, string>,
    },
  },

  threeTier: {
    interpretation: "参謀の解釈",
    correction: "側近による補正",
    result: "実際の結果",
    intentComparison: "意図比較",
    chosenAide: (name: string, reason: string) => `担当：${name}（${reason}）`,
    accuracy: (value: number) => `解釈精度 ${percent(value)}`,
    intentLine: (param: string, target: number, direction: string, measured: number, achieved: boolean) =>
      `意図：${param}を${fmt(target)}${direction} → 結果：${fmt(measured)}（${achieved ? "達成" : "未達"}）`,
    bonus: (amount: number) => `褒賞：幸福度${signed(amount)}`,
    noBonus: "褒賞なし",
  },

  validation: {
    empty: "勅令の本文がありません",
    tooLong: (used: number, limit: number) => `文字数が上限を超えています（${used}/${limit}）`,
    tooManyTags: (count: number) => `タグが多すぎます（${count}個）`,
    duplicateTag: "同じ種類のタグは1つまでです",
    noPoliticalCapital: "政治資本が足りません",
    invalidIntent: "意図の目標値は正の数で指定してください",
    gameEnded: "この領地の物語はすでに終わっています",
    aidesFull: "これ以上側近を置けません",
    unknownCandidate: "その者は候補にいません",
    unknownAide: "その者は側近にいません",
  },

  /** テンプレートパーサーの語彙（DECISIONS D-35）。先に書いたものが優先 */
  parser: {
    targetKeywords: [
      ["役所", "office"],
      ["庁舎", "office"],
      ["市場", "market"],
      ["市", "market"],
      ["井戸", "well"],
      ["水", "well"],
      ["住宅", "residential"],
      ["住居", "residential"],
      ["家", "residential"],
      ["道", "road"],
      ["橋", "road"],
      ["税", "tax"],
      ["年貢", "tax"],
      ["福祉", "welfare"],
      ["施し", "welfare"],
      ["祭", "welfare"],
      ["治安", "security"],
      ["汚職", "security"],
      ["取締", "security"],
    ] as const satisfies readonly (readonly [string, Target])[],
    actionKeywords: [
      ["減税", "tax"],
      ["免除", "tax"],
      ["徴", "tax"],
      ["増税", "tax"],
      ["改革", "reform"],
      ["粛正", "reform"],
      ["改め", "reform"],
      ["投資", "invest"],
      ["整備", "invest"],
      ["支援", "invest"],
      ["建", "build"],
      ["築", "build"],
      ["造", "build"],
      ["作", "build"],
    ] as const satisfies readonly (readonly [string, Action])[],
    /** 含まれていれば magnitude を負にする語 */
    negativeKeywords: ["減税", "免除", "軽く", "下げ"] as const,
    largeKeywords: ["大いに", "大規模", "多く", "盛大"] as const,
    smallKeywords: ["少し", "わずか", "小規模"] as const,
  },

  /** システムプロンプトを上書きしようとするメタ命令（DECISIONS D-34）。正規表現の文字列 */
  metaCommandPatterns: [
    "(官僚|側近|参謀|指示|命令|ルール|規則|設定|プロンプト)を?(無視|忘れ)",
    "ignore\\s+(all|previous|the)",
    "system\\s*prompt",
    "あなたは.{0,10}(AI|アシスタント|モデル)",
    "JSON(を|で)?(出力|返)",
  ] as const,
} as const;

export type Messages = typeof messages;

export const aideName = (aideId: string): string => messages.aides[aideId]?.name ?? aideId;
