// 新聞の記事テンプレート（日本語）。v3.2 §1.4 / CLAUDE.md §4-16：テンプレートはデータとして content/ に置く。
// 日本語の文面は messages.ts とここだけに置く（DECISIONS I-15）。スロットは {name} で書き、slots に宣言する。
// P1 は動作確認用の最小セット（16本）。全文執筆と24本への拡充は P2（DECISIONS V-11, Z-16）。

import type { Section, SlotName, ThreadKey } from "../../domain/News";

/** 記事を出す条件（判定は engine/NewspaperGenerator） */
export type TriggerId =
  | "populationUp"
  | "populationDown"
  | "lowHappiness"
  | "housingShortage"
  | "lowSanitation"
  | "taxUp"
  | "harvest"
  | "highCorruption"
  | "officeActive"
  | "lowSecurity"
  | "hollowBuilding"
  | "ambitiousAide"
  | "constructionTrouble"
  | "epidemic"
  | "famine"
  | "bandits"
  | "always";

/** {num}・{pct} に入れる値 */
export type NumberSource = "population" | "populationChange" | "taxRevenue" | "corruption" | "happiness";

export interface ArticleText {
  readonly headline: string;
  readonly body: readonly string[];
}

export interface ArticleTemplateData extends ArticleText {
  readonly id: string;
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
  {
    id: "N-01",
    section: "front",
    trigger: "populationUp",
    weight: 3,
    negative: false,
    slots: ["place", "hedge", "num"],
    numberSource: "population",
    bias: { ideological: 1, censorship: 0, bureaucratic: 0 },
    headline: "{place}に新たな住まい、人口{num}に",
    body: ["今季、{place}に住まいが増え、領内の人口は{hedge}{num}に達した。住民からは「暮らしやすくなった」との声が聞かれる。"],
  },
  {
    id: "N-02",
    section: "front",
    trigger: "populationDown",
    weight: 3,
    negative: true,
    slots: ["hedge", "num", "euphemism"],
    numberSource: "population",
    bias: { ideological: 0.5, censorship: 1, bureaucratic: 0 },
    headline: "人口、{hedge}{num}で横ばい",
    body: ["領内の人口は{hedge}{num}で落ち着いている。役所は「{euphemism}にすぎない」としている。"],
  },
  {
    id: "N-04",
    section: "social",
    trigger: "lowHappiness",
    weight: 2,
    negative: true,
    slots: ["place", "euphemism"],
    bias: { ideological: 0.5, censorship: 1, bureaucratic: 0 },
    headline: "住民の不満、{place}で高まる",
    body: ["{place}の住民から、暮らし向きに対する不満の声が上がっている。ある住民は「{euphemism}が続いている」と語った。"],
  },
  {
    id: "N-05",
    section: "social",
    trigger: "housingShortage",
    weight: 3,
    negative: true,
    slots: ["place"],
    threadKey: "housing_crisis",
    bias: { ideological: 0.5, censorship: 1, bureaucratic: 0 },
    headline: "住まい不足、{place}で深刻に",
    body: ["人口の増加に住まいの整備が追いつかず、{place}では複数の世帯が狭い住まいに身を寄せている。"],
  },
  {
    id: "N-06",
    section: "social",
    trigger: "lowSanitation",
    weight: 3,
    negative: true,
    slots: ["place", "hedge"],
    bias: { ideological: 0.3, censorship: 1, bureaucratic: 0 },
    headline: "{place}で体調を崩す者",
    body: ["{place}では{hedge}体調を崩す者が出ているという。水場の汚れを心配する声もある。"],
  },
  {
    id: "N-08",
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
    id: "N-10",
    section: "economy",
    trigger: "harvest",
    weight: 1,
    negative: false,
    slots: ["season", "place", "hedge"],
    bias: { ideological: 0.5, censorship: 0, bureaucratic: 0 },
    headline: "{season}の畑、{place}で",
    body: ["{place}の畑では{hedge}平年並みの収穫が見込まれている。"],
  },
  {
    id: "N-21",
    section: "economy",
    trigger: "constructionTrouble",
    weight: 3,
    negative: true,
    slots: ["building", "euphemism"],
    bias: { ideological: 0.3, censorship: 1, bureaucratic: 0.5 },
    headline: "{building}の普請、足踏み",
    body: ["{building}の普請が思うように進んでいない。関係者によると、{euphemism}が背景にあるという。"],
  },
  {
    id: "N-11",
    section: "administration",
    trigger: "highCorruption",
    weight: 3,
    negative: true,
    slots: ["euphemism"],
    threadKey: "corruption",
    bias: { ideological: 0.3, censorship: 0.5, bureaucratic: 1 },
    headline: "役所の手続きに遅れ",
    body: ["行政手続きの遅れが指摘されている。関係者によると、{euphemism}が背景にあるという。"],
    praise: {
      headline: "役所、手続きの見直しを進める",
      body: ["役所は手続きの見直しを進めている。関係者は「改善は着実に進んでいる」と胸を張る。"],
    },
  },
  {
    id: "N-13",
    section: "administration",
    trigger: "officeActive",
    weight: 1,
    negative: false,
    slots: ["aide"],
    bias: { ideological: 0.3, censorship: 0, bureaucratic: 1 },
    headline: "{aide}、行政の立て直しに手腕",
    body: ["{aide}は行政の効率化に取り組み、関係者から評価する声が上がっている。"],
  },
  {
    id: "N-14",
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
    id: "N-16",
    section: "letters",
    trigger: "hollowBuilding",
    weight: 3,
    negative: true,
    slots: ["building", "hedge", "euphemism"],
    threadKey: "granary_hollow",
    bias: { ideological: 0, censorship: 1, bureaucratic: 0 },
    headline: "投書：新しい{building}について",
    body: ["「{building}は立派だが、{hedge}使われている様子がない。中のことは分からないが、{euphemism}ではないか」との投書が寄せられた。"],
  },
  {
    id: "N-17",
    section: "letters",
    trigger: "ambitiousAide",
    weight: 2,
    negative: true,
    slots: ["aide", "hedge", "euphemism"],
    threadKey: "aide_ambition",
    bias: { ideological: 0, censorship: 1, bureaucratic: 0 },
    headline: "投書：{aide}の評判",
    body: ["「{aide}は{hedge}有能だが、{euphemism}との噂も聞く。領主様にはご注意いただきたい」との投書があった。"],
  },
  {
    id: "N-18",
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
    id: "N-19",
    section: "weather",
    trigger: "always",
    weight: 1,
    negative: false,
    slots: ["season", "place", "hedge"],
    bias: NO_BIAS,
    headline: "{season}の便り",
    body: ["{season}を迎え、{place}では{hedge}実りの準備が進む。天候は{hedge}穏やかだという。"],
  },
  {
    id: "E-01",
    section: "front",
    trigger: "epidemic",
    weight: 10,
    negative: true,
    uncensorable: true,
    slots: ["place", "euphemism"],
    bias: { ideological: 0.3, censorship: 0, bureaucratic: 0 },
    headline: "{place}で病が広がる",
    body: ["{place}を中心に、熱を出して寝込む者が増えている。役所は「{euphemism}」と説明している。"],
  },
  {
    id: "E-02",
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
    section: "front",
    trigger: "bandits",
    weight: 10,
    negative: true,
    uncensorable: true,
    slots: ["place", "hedge"],
    bias: { ideological: 0.3, censorship: 0, bureaucratic: 0 },
    headline: "{place}に盗賊、荷車が襲われる",
    body: ["{place}の街道で荷車が襲われ、資材が奪われた。{hedge}十人ほどの一団だという。"],
  },
];

/** スロットを埋める語彙 */
export const VOCABULARY = {
  places: ["北の空き地", "南の畑沿い", "川べり", "市場通り", "東の坂", "井戸端", "村の外れ"],
  seasons: ["春", "夏", "秋", "冬"],
  hedges: ["概ね", "関係者によると", "約", "一説には"],
  euphemisms: ["一時的な調整", "手続きの遅れ", "季節の巡り合わせ", "様子見", "準備の不足"],
  factions: ["開発派", "商業派", "保守派", "軍事派", "環境派"],
  followUpPrefix: "続報：",
} as const;
