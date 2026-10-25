// 新聞の記事テンプレート（日本語）。v3.2 §1.3, §1.4, §1.11 / CLAUDE.md §4-16：テンプレートはデータとして content/ に置く。
// 日本語の文面は messages.ts とここだけに置く（DECISIONS I-15）。スロットは {name} で書き、slots に宣言する。
// 読み込み時に engine/NewspaperTemplates の Effect Schema で検証する（宣言と文面のスロットの一致を含む）。
// 本数：記事タイプ N-01〜N-20 の20種＋バリエーション4本（N-01/09/16/18 に各+1）＝24本（V-11）、
//       ＋イベント記事 E-01〜E-03 と工事の記事 N-21（Z-16）＝計28本。

import type { Section, SlotName, ThreadKey } from "../../domain/News";

/** 記事を出す条件（判定は engine/NewspaperGenerator） */
export type TriggerId =
  | "populationUp"
  | "populationDown"
  | "nearTransition"
  | "lowHappiness"
  | "housingShortage"
  | "lowSanitation"
  | "educationBuilt"
  | "taxUp"
  | "commerceBuilt"
  | "harvest"
  | "highCorruption"
  | "courtActive"
  | "officeActive"
  | "lowSecurity"
  | "securityBuilt"
  | "hollowBuilding"
  | "ambitiousAide"
  | "constructionTrouble"
  | "epidemic"
  | "famine"
  | "bandits"
  | "always";

export const TRIGGER_IDS = [
  "populationUp",
  "populationDown",
  "nearTransition",
  "lowHappiness",
  "housingShortage",
  "lowSanitation",
  "educationBuilt",
  "taxUp",
  "commerceBuilt",
  "harvest",
  "highCorruption",
  "courtActive",
  "officeActive",
  "lowSecurity",
  "securityBuilt",
  "hollowBuilding",
  "ambitiousAide",
  "constructionTrouble",
  "epidemic",
  "famine",
  "bandits",
  "always",
] as const satisfies readonly TriggerId[];

/** {num}・{pct} に入れる値 */
export type NumberSource = "population" | "populationChange" | "taxRevenue" | "corruption" | "happiness";
export const NUMBER_SOURCES = ["population", "populationChange", "taxRevenue", "corruption", "happiness"] as const satisfies readonly NumberSource[];

export interface ArticleText {
  readonly headline: string;
  readonly body: readonly string[];
}

export interface ArticleTemplateData extends ArticleText {
  /** テンプレートの識別子（バリエーションごとに一意。例 "N-01b"） */
  readonly id: string;
  /** 記事タイプ（v3.2 §1.3 の ID。紙面の記事の id になる。例 "N-01"） */
  readonly type: string;
  readonly section: Section;
  readonly trigger: TriggerId;
  readonly weight: number;
  /** 負の記事（検閲の対象になりうる） */
  readonly negative: boolean;
  readonly slots: readonly SlotName[];
  /** どの偏向に敏感か（0..1） */
  readonly bias: { readonly ideological: number; readonly censorship: number; readonly bureaucratic: number };
  readonly numberSource?: NumberSource;
  readonly threadKey?: ThreadKey;
  /** 官僚圧力で称賛に転じたときの文面 */
  readonly praise?: ArticleText;
  /** 検閲で削除されない（イベント記事。Z-09） */
  readonly uncensorable?: boolean;
}

const NO_BIAS = { ideological: 0, censorship: 0, bureaucratic: 0 } as const;

export const TEMPLATES: readonly ArticleTemplateData[] = [
  // --- 第一面 ---
  {
    id: "N-01",
    type: "N-01",
    section: "front",
    trigger: "populationUp",
    weight: 3,
    negative: false,
    slots: ["place", "hedge", "num"],
    numberSource: "population",
    bias: { ideological: 1, censorship: 0, bureaucratic: 0 },
    headline: "{place}に新たな住まい、人口{num}に",
    body: ["今年、{place}に住まいが増え、領内の人口は{hedge}{num}に達した。住民からは「暮らしやすくなった」との声が聞かれる。"],
  },
  {
    id: "N-01b",
    type: "N-01",
    section: "front",
    trigger: "populationUp",
    weight: 3,
    negative: false,
    slots: ["place", "hedge", "num"],
    numberSource: "population",
    bias: { ideological: 1, censorship: 0, bureaucratic: 0 },
    headline: "人の流れ、{place}へ",
    body: [
      "{place}に移り住む者が増えている。領内の人口は{hedge}{num}。",
      "「ここなら仕事がある」と聞いて山向こうから来た、という家族も少なくない。",
    ],
  },
  {
    id: "N-02",
    type: "N-02",
    section: "front",
    trigger: "populationDown",
    weight: 3,
    negative: true,
    slots: ["hedge", "num", "euphemism"],
    numberSource: "population",
    bias: { ideological: 0.5, censorship: 1, bureaucratic: 0 },
    headline: "人口、{hedge}{num}で横ばい",
    body: ["領内の人口は{hedge}{num}で落ち着いている。村を離れる者がいるとの話もあるが、役所は「{euphemism}にすぎない」としている。"],
  },
  {
    id: "N-03",
    type: "N-03",
    section: "front",
    trigger: "nearTransition",
    weight: 4,
    negative: false,
    slots: ["hedge", "num"],
    numberSource: "population",
    bias: { ideological: 1, censorship: 0, bureaucratic: 0.3 },
    headline: "「村から町へ」、格上げ間近か",
    body: [
      "領内の人口は{hedge}{num}。道や役所の整備も進み、町への格上げが近いとの見方が広がっている。",
      "古くからの住民は「この村がねえ」と目を細める。",
    ],
  },

  // --- 社会面 ---
  {
    id: "N-04",
    type: "N-04",
    section: "social",
    trigger: "lowHappiness",
    weight: 2,
    negative: true,
    slots: ["place", "euphemism"],
    bias: { ideological: 0.5, censorship: 1, bureaucratic: 0 },
    headline: "住民の不満、{place}で高まる",
    body: ["{place}の住民から、暮らし向きに対する不満の声が上がっている。役所は「{euphemism}」と説明するが、ある住民は「そう言われて何年になるか」とこぼした。"],
  },
  {
    id: "N-05",
    type: "N-05",
    section: "social",
    trigger: "housingShortage",
    weight: 3,
    negative: true,
    slots: ["place"],
    threadKey: "housing_crisis",
    bias: { ideological: 0.5, censorship: 1, bureaucratic: 0 },
    headline: "住まい不足、{place}で深刻に",
    body: ["人の増え方に住まいの整備が追いつかず、{place}では複数の世帯がひとつ屋根の下に身を寄せている。"],
  },
  {
    id: "N-06",
    type: "N-06",
    section: "social",
    trigger: "lowSanitation",
    weight: 3,
    negative: true,
    slots: ["place", "hedge"],
    bias: { ideological: 0.3, censorship: 1, bureaucratic: 0 },
    headline: "{place}で体調を崩す者",
    body: ["{place}では{hedge}腹を下す者が続いているという。水場の濁りを気にする声もあり、医者は「井戸の水は煮てから飲むように」と呼びかけている。"],
  },
  {
    id: "N-07",
    type: "N-07",
    section: "social",
    trigger: "educationBuilt",
    weight: 3,
    negative: false,
    slots: ["building", "faction"],
    bias: { ideological: 0.5, censorship: 0, bureaucratic: 0 },
    headline: "{building}、完成",
    body: ["かねて普請が進められていた{building}が完成した。{faction}は「領民の心のよりどころになる」と歓迎している。"],
  },
  {
    id: "N-20",
    type: "N-20",
    section: "social",
    trigger: "always",
    weight: 1,
    negative: false,
    slots: ["place"],
    bias: { ideological: 0, censorship: 0, bureaucratic: 0 },
    headline: "{place}で赤子の産声",
    body: ["{place}の家で赤子が生まれ、近所の者が祝いの品を持ち寄った。同じ日、長く村の渡し守を務めた老人が静かに息を引き取った。"],
  },

  // --- 経済面 ---
  {
    id: "N-08",
    type: "N-08",
    section: "economy",
    trigger: "taxUp",
    weight: 2,
    negative: false,
    slots: ["hedge", "num"],
    numberSource: "taxRevenue",
    bias: { ideological: 1, censorship: 0, bureaucratic: 0 },
    headline: "税収、{hedge}{num}に",
    body: ["今年の税収は{hedge}{num}にのぼった。役所は「領地の発展の表れ」としている。"],
  },
  {
    id: "N-09",
    type: "N-09",
    section: "economy",
    trigger: "commerceBuilt",
    weight: 3,
    negative: false,
    slots: ["building", "faction"],
    bias: { ideological: 0.5, censorship: 0, bureaucratic: 0 },
    headline: "{building}、{faction}が評価",
    body: ["新たに設けられた{building}について、{faction}は「領地の発展に寄与する」と評価した。"],
  },
  {
    id: "N-09b",
    type: "N-09",
    section: "economy",
    trigger: "commerceBuilt",
    weight: 2,
    negative: false,
    slots: ["building", "faction"],
    bias: { ideological: 0.5, censorship: 0, bureaucratic: 0 },
    headline: "{building}の開業に賛否",
    body: ["新たに設けられた{building}には人が集まっている。一方、{faction}からは「昔ながらの暮らしが変わってしまう」と案じる声も出ている。"],
  },
  {
    id: "N-10",
    type: "N-10",
    section: "economy",
    trigger: "harvest",
    weight: 1,
    negative: false,
    slots: ["season", "place"],
    bias: { ideological: 0.5, censorship: 0, bureaucratic: 0 },
    headline: "{season}の畑、{place}で",
    body: ["{place}の畑では、平年並みの収穫が見込まれている。農夫たちは「蓄えに回せるほどではない」と慎重だ。"],
  },
  {
    id: "N-21",
    type: "N-21",
    section: "economy",
    trigger: "constructionTrouble",
    weight: 3,
    negative: true,
    slots: ["building", "euphemism"],
    bias: { ideological: 0.3, censorship: 1, bureaucratic: 0.5 },
    headline: "{building}の普請、足踏み",
    body: ["{building}の普請が思うように進んでいない。現場では人手も材木も足りないとの声があるが、役所は「{euphemism}」と言うにとどめた。"],
    praise: {
      headline: "{building}の普請、順調",
      body: ["役所によると、{building}の普請は予定どおり進んでいるという。現場の士気も高いとのことだ。"],
    },
  },

  // --- 行政面 ---
  {
    id: "N-11",
    type: "N-11",
    section: "administration",
    trigger: "highCorruption",
    weight: 3,
    negative: true,
    slots: ["euphemism"],
    threadKey: "corruption",
    bias: { ideological: 0.3, censorship: 0.5, bureaucratic: 1 },
    headline: "役所の手続きに遅れ",
    body: ["行政手続きの遅れが指摘されている。関係者によると、{euphemism}が背景にあるという。届け出に袖の下を求められた、との話も漏れ聞こえる。"],
    praise: {
      headline: "役所、手続きの見直しを進める",
      body: ["役所は手続きの見直しを進めている。関係者は「改善は着実に進んでいる」と胸を張る。"],
    },
  },
  {
    id: "N-12",
    type: "N-12",
    section: "administration",
    trigger: "courtActive",
    weight: 2,
    negative: false,
    slots: ["faction"],
    bias: { ideological: 0.5, censorship: 0, bureaucratic: 0.3 },
    headline: "裁きの場、動き出す",
    body: ["裁判所で審理が始まった。{faction}は「役人の不正にも目を光らせるべきだ」と注文をつけている。"],
  },
  {
    id: "N-13",
    type: "N-13",
    section: "administration",
    trigger: "officeActive",
    weight: 1,
    negative: false,
    slots: ["aide"],
    bias: { ideological: 0.3, censorship: 0, bureaucratic: 1 },
    headline: "{aide}、行政の立て直しに手腕",
    body: ["{aide}は行政の効率化に取り組み、関係者から評価する声が上がっている。"],
  },

  // --- 治安面 ---
  {
    id: "N-14",
    type: "N-14",
    section: "security",
    trigger: "lowSecurity",
    weight: 3,
    negative: true,
    slots: ["place", "hedge"],
    bias: { ideological: 0.3, censorship: 1, bureaucratic: 0 },
    headline: "{place}で物盗り相次ぐ",
    body: ["{place}で{hedge}物盗りが相次いでいる。夜の見回りを求める声が強まっている。"],
  },
  {
    id: "N-15",
    type: "N-15",
    section: "security",
    trigger: "securityBuilt",
    weight: 3,
    negative: false,
    slots: ["building", "faction"],
    bias: { ideological: 0.5, censorship: 0, bureaucratic: 0 },
    headline: "{building}の整備進む",
    body: ["治安の維持に向け、{building}の整備が進んでいる。{faction}は歓迎するが、住民からは負担を案じる声もある。"],
  },

  // --- 投書欄 ---
  {
    id: "N-16",
    type: "N-16",
    section: "letters",
    trigger: "hollowBuilding",
    weight: 6,
    negative: true,
    slots: ["building", "hedge"],
    threadKey: "granary_hollow",
    bias: { ideological: 0, censorship: 1, bureaucratic: 0 },
    headline: "投書：新しい{building}について",
    body: ["「{building}は立派だが、{hedge}使われている様子がない。中に何が入っているのか、役人に聞いても首をかしげるばかりだ」との投書が寄せられた。"],
  },
  {
    id: "N-16b",
    type: "N-16",
    section: "letters",
    trigger: "hollowBuilding",
    weight: 6,
    negative: true,
    slots: ["building", "place"],
    threadKey: "granary_hollow",
    bias: { ideological: 0, censorship: 1, bureaucratic: 0 },
    headline: "投書：{building}の荷車",
    body: ["「{place}の{building}は構えこそ立派だが、荷車が出入りしているのを見たことがない。中はどうなっているのだろう」との投書が寄せられた。"],
  },
  {
    id: "N-17",
    type: "N-17",
    section: "letters",
    trigger: "ambitiousAide",
    weight: 2,
    negative: true,
    slots: ["aide", "hedge"],
    threadKey: "aide_ambition",
    bias: { ideological: 0, censorship: 1, bureaucratic: 0 },
    headline: "投書：{aide}の評判",
    body: ["「{aide}は有能だと聞くが、{hedge}自分の懐ばかり気にしているとの噂もある。領主様にはご注意いただきたい」との投書があった。"],
  },

  // --- 広告 ---
  {
    id: "N-18",
    type: "N-18",
    section: "advertisement",
    trigger: "always",
    weight: 1,
    negative: false,
    slots: ["faction", "building"],
    bias: NO_BIAS,
    headline: "{building}のご案内",
    body: ["{faction}が{building}の建設を後押ししている。領地の発展には欠かせない、との触れ込みだ。"],
  },
  {
    id: "N-18b",
    type: "N-18",
    section: "advertisement",
    trigger: "always",
    weight: 1,
    negative: false,
    slots: ["building", "place"],
    bias: NO_BIAS,
    headline: "{building}の普請、請け負います",
    body: ["{place}の大工衆より。{building}の普請は当方へ。腕と早さには自信あり。"],
  },

  // --- 天候・季節 ---
  {
    id: "N-19",
    type: "N-19",
    section: "weather",
    trigger: "always",
    weight: 1,
    negative: false,
    slots: ["season", "place"],
    bias: NO_BIAS,
    headline: "{season}の便り",
    body: ["{season}を迎え、{place}では畑仕事が進む。空模様は穏やかで、年寄りたちは「今年は悪くない」と口をそろえる。"],
  },

  // --- イベント（第一面。検閲で消えない。Z-09） ---
  {
    id: "E-01",
    type: "E-01",
    section: "front",
    trigger: "epidemic",
    weight: 10,
    negative: true,
    uncensorable: true,
    slots: ["place", "euphemism"],
    bias: { ideological: 0.3, censorship: 0, bureaucratic: 0 },
    headline: "{place}で病が広がる",
    body: ["{place}を中心に、熱を出して寝込む者が増えている。役所は「{euphemism}」と説明しているが、医者の手は足りていない。"],
  },
  {
    id: "E-02",
    type: "E-02",
    section: "front",
    trigger: "famine",
    weight: 10,
    negative: true,
    uncensorable: true,
    slots: ["season", "place"],
    bias: { ideological: 0.3, censorship: 0, bureaucratic: 0 },
    headline: "{season}の凶作、{place}の畑に打撃",
    body: ["日照りと長雨が続き、{place}の畑では実りが例年の半分ほどにとどまっている。蓄えを心配する声が出ている。"],
  },
  {
    id: "E-03",
    type: "E-03",
    section: "front",
    trigger: "bandits",
    weight: 10,
    negative: true,
    uncensorable: true,
    slots: ["place", "hedge"],
    bias: { ideological: 0.3, censorship: 0, bureaucratic: 0 },
    headline: "{place}に盗賊、荷車が襲われる",
    body: ["{place}の街道で荷車が襲われ、材木が奪われた。{hedge}十人ほどの一団だという。"],
  },
];

/** スロットを埋める語彙 */
export const VOCABULARY = {
  places: ["北の空き地", "南の畑沿い", "川べり", "市場通り", "東の坂", "井戸端", "村の外れ", "渡し場の近く"],
  seasons: ["春", "夏", "秋", "冬"],
  /** 数値の前に置くヘッジ */
  numberHedges: ["概ね", "約", "およそ"],
  /** 文の前に置くヘッジ（伝聞） */
  softHedges: ["どうやら", "噂では", "聞くところでは"],
  euphemisms: ["一時的な調整", "手続きの遅れ", "季節の巡り合わせ", "様子見", "準備の不足"],
  factions: ["開発派", "商業派", "保守派", "軍事派", "環境派"],
  followUpPrefix: "【続報】",
} as const;
