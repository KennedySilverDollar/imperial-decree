// 全文言（CLAUDE.md §4-6）。エンジン・UI は日本語リテラルを持たず、ここを参照する。
// テンプレートパーサーの辞書・メタ命令パターンも言語依存の語彙としてここに置く。

import type { Action, ParamKey, Target } from "../domain/Vocabulary";
import type { BuildingId, Category, PolicyId } from "../domain/Buildings";
import type { Faction, SelectionReason, Specialty } from "../domain/Aide";
import type { GameOverReason } from "../domain/Ending";
import type { EventKind } from "../domain/Events";
import type { Section } from "../domain/News";
import type { LLMFailureReason, NoopReason, OrderFailure, OrderLimit } from "../domain/TurnRecord";
import type { IntentDirection } from "../domain/IntentDeclaration";
import type { DeadlineTagValue, PriorityTagValue, ScaleTagValue } from "../domain/Decree";

const fmt = (value: number): string => String(Math.round(value));
const signed = (value: number): string => (value > 0 ? `+${fmt(value)}` : fmt(value));
const percent = (ratio: number): string => `${Math.round(ratio * 100)}%`;
const signedLevel = (level: number): string => (level > 0 ? `+${level}` : String(level));

export const messages = {
  params: {
    population: "人口",
    treasury: "国庫",
    happiness: "幸福度",
    infrastructure: "インフラ",
    corruption: "汚職率",
  } satisfies Record<ParamKey, string>,

  /** 20 の target の名称（id は domain/Buildings.ts が単一情報源。網羅は型で保証） */
  targets: {
    residential: "住宅",
    tenement: "長屋",
    manor: "屋敷",
    road: "道路",
    well: "井戸",
    granary: "倉庫",
    market: "市場",
    farm: "農地",
    workshop: "工房",
    office: "役所",
    taxoffice: "徴税所",
    courthouse: "裁判所",
    clinic: "診療所",
    school: "学校",
    temple: "寺院",
    watchtower: "見張り塔",
    jail: "牢屋",
    tax_rate: "税率",
    welfare_policy: "福祉政策",
    security_policy: "治安政策",
  } satisfies Record<Target, string>,

  /** 地図のタイルの1文字アイコン（v3.2 §2.3 のタイル列） */
  tileGlyphs: {
    residential: "家",
    tenement: "長",
    manor: "邸",
    road: "道",
    well: "井",
    granary: "倉",
    market: "市",
    farm: "畑",
    workshop: "工",
    office: "旗",
    taxoffice: "徴",
    courthouse: "裁",
    clinic: "医",
    school: "学",
    temple: "寺",
    watchtower: "塔",
    jail: "牢",
  } satisfies Record<BuildingId, string>,

  categories: {
    housing: "住宅",
    infrastructure: "インフラ",
    economy: "経済",
    administration: "行政",
    social: "社会",
    security: "治安",
  } satisfies Record<Category, string>,

  policyLevel: (policy: PolicyId, from: number, to: number) =>
    `${messages.targets[policy]}を${to > from ? "引き上げた" : "引き下げた"}（${signedLevel(from)} → ${signedLevel(to)}）`,

  events: {
    epidemic: "疫病",
    famine: "凶作",
    bandits: "盗賊",
  } satisfies Record<EventKind, string>,

  actions: {
    build: "建設",
    tax: "徴税",
    invest: "投資",
    reform: "改革",
    appoint: "任命",
    dismiss: "解任",
  } satisfies Record<Action, string>,

  scaleTags: { small: "小", medium: "中", large: "大" } satisfies Record<ScaleTagValue, string>,
  deadlineTags: { thisYear: "今年中", fewYears: "数年で", noRush: "急がず" } satisfies Record<DeadlineTagValue, string>,
  priorityTags: { high: "高", normal: "中", low: "低" } satisfies Record<PriorityTagValue, string>,

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
      rateLimited: "参謀は多忙で、取り次がれなかった",
      rejected: "参謀への取り次ぎを断られた",
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
    ordered: (building: string, count: number, repair: boolean) =>
      repair ? `${building}${count}棟の修繕を発注した` : `${building}${count}棟の普請を発注した`,
    limited: (requested: number, count: number, limit: OrderLimit) =>
      `${messages.orderLimits[limit]}のため ${requested}棟 → ${count}棟`,
    orderFailed: (building: string, reason: OrderFailure, detail: string | null) =>
      `${building}は発注できなかった（${messages.orderFailures[reason](detail)}）`,
  },

  orderLimits: {
    treasury: "予算不足",
    budget: "指定の予算",
    tiles: "用地不足",
  } satisfies Record<OrderLimit, string>,

  orderFailures: {
    prerequisite: (detail: string | null) => `${detail ?? ""}がなければ建てられない`,
    population: () => "人口が足りない",
    maxCount: () => "これ以上は置けない",
    treasury: () => "国庫が足りない",
    budget: () => "指定の予算では足りない",
    tiles: () => "用地がない",
    nothingToRepair: () => "直すべきものが見当たらない",
  } satisfies Record<OrderFailure, (detail: string | null) => string>,

  reports: {
    header: (aideName: string) => `${aideName}より御報告`,
    item: (param: string, delta: number) => `${param}は${signed(delta)}でございます`,
    nothingToReport: "特に申し上げることはございません",
    metaIgnored: "不遜な文言は聞かなかったことにいたします",
    hollowDisclosed: (building: string, count: number) => `${building}のうち${count}棟は、見かけ倒しで中身がございません`,
    constructionEstimate: (building: string, count: number, turns: number | null) =>
      turns === null
        ? `${building}${count}棟の普請は、いつ終わるとも知れません`
        : `${building}${count}棟の普請は、あと${turns}年ほどかと存じます`,
    completed: (building: string, count: number, repair: boolean) =>
      repair ? `${building}${count}棟の修繕が終わりました` : `${building}${count}棟が完成いたしました`,
    materialShortage: (severe: boolean) =>
      severe ? "資材がひどく足りず、手持ちで間に合わせております" : "資材が足りず、普請が滞っております",
    overload: "人手に対して普請が多すぎ、現場が回っておりません",
    event: {
      started: (event: string) => `${event}が起きております。手当てを御命じください`,
      ongoing: (event: string, turns: number) => `${event}は${turns}年目に入りました`,
      resolved: (event: string) => `${event}は収まりました`,
      expired: (event: string) => `${event}はようやく去りましたが、爪痕が残りました`,
    },
  },

  newspaper: {
    title: (turn: number) => `辺境日報\u3000第${turn}年の暮れ`,
    sections: {
      front: "第一面",
      social: "社会",
      economy: "経済",
      administration: "行政",
      security: "治安",
      letters: "投書",
      advertisement: "広告",
      weather: "天候",
    } satisfies Record<Section, string>,
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

  factions: {
    development: "開発派",
    commerce: "商業派",
    conservative: "保守派",
    military: "軍事派",
    environment: "環境派",
  } satisfies Record<Faction, string>,

  specialties: {
    infrastructure: "インフラ",
    economy: "経済",
    security: "治安",
    environment: "環境",
  } satisfies Record<Specialty, string>,

  ui: {
    title: "勅令都市",
    year: (turn: number) => `第${turn}年`,
    politicalCapital: "政治資本",
    newGame: "新しく始める",
    newGameConfirm: "今の領地を捨てて始め直しますか？",
    confirm: "始め直す",
    cancel: "やめる",
    exportLog: "記録を書き出す",
    loading: "書類を広げています…",
    panels: {
      newspaper: "新聞",
      map: "領地図",
      aides: "側近",
      decree: "勅令",
    },
    newspaper: {
      firstIssueTitle: "辺境日報\u3000創刊号",
      firstIssueHeadline: "新領主、着任",
      firstIssueBody: "辺境の村に新たな領主が着任した。村人は百二十人ほど。暮らしぶりは可もなく不可もない。",
      biasNote: "※本紙の記事は記者の取材によるもので、数値には誤差を含みます",
    },
    map: {
      legend: {
        road: "道路",
        construction: "普請中",
        empty: "空き地",
        cracked: "見かけ倒し（報告で判明）",
      },
      note: "区画は役人が自動で割り振る。位置は指定できない",
    },
    aides: {
      params: { loyalty: "忠誠", ability: "能力", ambition: "野心", trust: "信頼" },
      factionSpecialty: (faction: string, specialty: string) => `${faction}・専門 ${specialty}`,
      noReport: "まだ報告はない",
      dismiss: "解任する",
      dismissConfirm: "本当に解任する",
      appointHeading: "任命できる者",
      appoint: (cost: number) => `任命する（政治資本${cost}）`,
      empty: "側近が一人もいない。勅令を執り行う者がいない。",
      seatOpen: "空席がある。候補から任命できる。",
    },
    decree: {
      placeholder: "例：道を造れ",
      remaining: (n: number) => `残り ${n} 字`,
      tagTarget: "対象",
      tagScale: "規模",
      tagDeadline: "期限",
      tagPriority: "優先度",
      tagHintNote: "期限・優先度は参謀への添え書き（執行には影響しない）",
      tagNone: "なし",
      tagCost: (n: number) => `タグは1つ${n}字`,
      marginLabel: "余白の書き添え（任意）",
      intentPrefix: "意図：",
      intentParticle: "を",
      intentNone: "書き添えない",
      intentValuePlaceholder: "数",
      stamp: "勅",
      stampLabel: "判を押す",
      thinking: "参謀が思案している…",
      cost: (pc: number, treasury: number) => `判を押すと 政治資本-${pc}・国庫-${treasury}`,
      noAideWarning: "側近がいないため、勅令は執行されない",
      noCapital: "政治資本が足りない。来年まで待つか、側近の任免を控えよ",
    },
    result: {
      heading: (turn: number) => `第${turn}年の顛末`,
      flip: "めくる",
      back: "戻す",
      close: "机に戻る",
      sheetOf: (i: number, n: number) => `${i} / ${n}`,
      decreeQuote: (text: string) => `「${text}」`,
      fieldMagnitude: "規模",
      fieldTarget: "対象",
      fieldEffect: "効果",
      fieldCount: "棟数",
      fieldBudget: "予算",
      noInterpretation: "勅令は誰にも届かなかった",
      noChange: "目に見える変化はない",
      memo: "余白の覚え書き",
    },
    ending: {
      gameoverTitle: "終幕",
      successTitle: "町へ",
      timeoutTitle: "時は尽きた",
      turns: (n: number) => `治世 ${n} 年`,
      restart: "もう一度治める",
      lastWords: {
        population: "最後の一家が去り、門は閉ざされた。",
        treasury: "金庫は空になり、役人たちは去った。",
        happiness: "民はもう領主の言葉を聞かない。",
        success: "人は集い、道は通じ、役所に灯がともった。村はもう村ではない。",
        timeout: "五十年が過ぎた。村は村のままだった。",
      },
    },
    errors: {
      unexpected: "書類が乱れた。もう一度判を押してほしい",
    },
  },

  /** テンプレートパーサーの語彙（DECISIONS D-35）。先に書いたものが優先 */
  parser: {
    targetKeywords: [
      ["徴税所", "taxoffice"],
      ["税率", "tax_rate"],
      ["裁判", "courthouse"],
      ["診療", "clinic"],
      ["医", "clinic"],
      ["学校", "school"],
      ["寺", "temple"],
      ["見張", "watchtower"],
      ["塔", "watchtower"],
      ["牢", "jail"],
      ["役所", "office"],
      ["庁舎", "office"],
      ["市場", "market"],
      ["工房", "workshop"],
      ["倉", "granary"],
      ["蔵", "granary"],
      ["畑", "farm"],
      ["農", "farm"],
      ["井戸", "well"],
      ["水", "well"],
      ["長屋", "tenement"],
      ["屋敷", "manor"],
      ["住宅", "residential"],
      ["住居", "residential"],
      ["家", "residential"],
      ["道", "road"],
      ["橋", "road"],
      ["税", "tax_rate"],
      ["年貢", "tax_rate"],
      ["福祉", "welfare_policy"],
      ["施し", "welfare_policy"],
      ["祭", "welfare_policy"],
      ["治安", "security_policy"],
      ["汚職", "security_policy"],
      ["取締", "security_policy"],
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
    negativeKeywords: ["減税", "免除", "軽く", "下げ", "緩め"] as const,
    /** 「三つ」などの数（n 棟 → magnitude = MAGNITUDE_PER_BUILDING × n。W-12） */
    countKeywords: [
      ["一", 1],
      ["二", 2],
      ["三", 3],
    ] as const satisfies readonly (readonly [string, number])[],
    /** 数を数える助数詞（「三つ」「二棟」） */
    counters: ["つ", "棟", "軒", "か所"] as const,
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
