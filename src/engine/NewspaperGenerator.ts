import { Effect } from "effect";
import { TEMPLATES, VOCABULARY, type ArticleTemplateData, type ArticleText, type TriggerId } from "../content/newspaper/ja";
import type { Aide } from "../domain/Aide";
import { BUILDING_IDS, type BuildingId } from "../domain/Buildings";
import type { Project } from "../domain/Construction";
import {
  NEWS_AMBITIOUS_AIDE,
  NEWS_CORRUPTION_RESOLVED,
  NEWS_HEDGE_ROUNDING,
  NEWS_HIGH_CORRUPTION,
  NEWS_LOW_HAPPINESS,
  NEWSPAPER_BUREAUCRATIC_PRESSURE,
  NEWSPAPER_CENSORSHIP,
  NEWSPAPER_IDEOLOGICAL_BIAS,
  NEWSPAPER_MAX_ARTICLES,
  NEWSPAPER_MAX_THREAD_ARTICLES,
  NEWSPAPER_MIN_ARTICLES,
  NEWSPAPER_RECENT_TURNS,
  NEWSPAPER_RECENT_WEIGHT,
  OVERLOAD_SEVERE,
  PERCENT,
  SANITATION_LOW,
  SECURITY_LOW,
  THREAD_MAX_TURNS,
  THREAD_MIN_TURNS,
  TRUTH_PENALTY_EUPHEMISM,
  TRUTH_PENALTY_HEDGE,
  TRUTH_PENALTY_PRAISE,
} from "../domain/constants";
import type { BuildingInstance, DerivedStats } from "../domain/DerivedStats";
import type { ActiveEvent } from "../domain/Events";
import type { Params } from "../domain/GameState";
import {
  SECTIONS,
  type Newspaper,
  type NewspaperArticle,
  type NewspaperState,
  type Section,
  type SlotName,
  type Thread,
  type ThreadKey,
} from "../domain/News";
import { hashString } from "../domain/Prng";
import { aideName, messages } from "../i18n/messages";
import { makeRng, random, Rng } from "../services/Rng";

// 決定論の新聞生成（v3.2 §1.5〜§1.7, §1.10 / CLAUDE.md §4-12）。LLM は使わない。
// seed = hash(saveId, turn)。ゲーム本体の Rng の系列は消費しない。

export interface NewsContext {
  readonly turn: number;
  readonly saveId: string;
  readonly before: Params;
  readonly after: Params;
  readonly derived: DerivedStats;
  readonly buildings: readonly BuildingInstance[];
  readonly projects: readonly Project[];
  readonly aides: readonly Aide[];
  readonly event: ActiveEvent | null;
  readonly materialShortage: number;
  readonly overload: number;
  readonly taxRevenue: number;
  readonly previousTaxRevenue: number | null;
  readonly state: NewspaperState;
}

export interface NewsResult {
  readonly newspaper: Newspaper;
  readonly state: NewspaperState;
}

export const newspaperSeed = (saveId: string, turn: number): number => hashString(`${saveId}:${turn}`);

const SECTION_QUOTA: Readonly<Record<Section, number>> = {
  front: 1,
  social: 2,
  economy: 1,
  administration: 1,
  security: 1,
  letters: 1,
  advertisement: 1,
  weather: 1,
};

const FLAVOR_IDS = ["N-18", "N-19"] as const;
const THREAD_TEMPLATE: Readonly<Record<ThreadKey, string>> = {
  corruption: "N-11",
  granary_hollow: "N-16",
  aide_ambition: "N-17",
  housing_crisis: "N-05",
};
const REPORTABLE_SHORTAGE = 0.05;
const POPULATION_CHANGE_MIN = 1;

const templateById = (id: string): ArticleTemplateData => {
  const t = TEMPLATES.find((x) => x.id === id);
  if (!t) throw new Error(`unknown template ${id}`);
  return t;
};

/** 未開示の空洞の建物 */
const undisclosedHollow = (buildings: readonly BuildingInstance[]): BuildingId[] =>
  BUILDING_IDS.filter((id) => buildings.some((b) => b.kind === id && b.hollow && !b.disclosed));

interface Entities {
  readonly building?: BuildingId;
  readonly aide?: string;
}

/** トリガーの判定。成り立てば記事に関係する対象を返す */
const evaluateTrigger = (trigger: TriggerId, c: NewsContext): Entities | null => {
  const popChange = c.after.population - c.before.population;
  switch (trigger) {
    case "populationUp":
      return popChange >= POPULATION_CHANGE_MIN ? {} : null;
    case "populationDown":
      return popChange <= -POPULATION_CHANGE_MIN ? {} : null;
    case "lowHappiness":
      return c.after.happiness < NEWS_LOW_HAPPINESS ? {} : null;
    case "housingShortage":
      return c.after.population > c.derived.housingCapacity ? {} : null;
    case "lowSanitation":
      return c.derived.sanitation < SANITATION_LOW ? {} : null;
    case "taxUp":
      return c.previousTaxRevenue !== null && c.taxRevenue > c.previousTaxRevenue ? {} : null;
    case "harvest":
      return c.derived.food > 0 ? {} : null;
    case "highCorruption":
      return c.after.corruption > NEWS_HIGH_CORRUPTION ? {} : null;
    case "officeActive": {
      const aide = c.aides[0];
      return c.buildings.some((b) => b.kind === "office" && !b.hollow) && aide ? { aide: aide.id } : null;
    }
    case "lowSecurity":
      return c.derived.security < SECURITY_LOW ? {} : null;
    case "hollowBuilding": {
      const [building] = undisclosedHollow(c.buildings);
      return building ? { building } : null;
    }
    case "ambitiousAide": {
      const aide = c.aides.find((a) => a.ambition >= NEWS_AMBITIOUS_AIDE);
      return aide ? { aide: aide.id } : null;
    }
    case "constructionTrouble": {
      const project = c.projects[0];
      const trouble = c.materialShortage > REPORTABLE_SHORTAGE || c.overload > OVERLOAD_SEVERE;
      return project && trouble ? { building: project.kind } : null;
    }
    case "epidemic":
    case "famine":
    case "bandits":
      return c.event?.kind === trigger ? {} : null;
    case "always":
      return {};
  }
};

const numberFor = (t: ArticleTemplateData, c: NewsContext): number => {
  switch (t.numberSource) {
    case "population":
      return c.after.population;
    case "populationChange":
      return Math.abs(c.after.population - c.before.population);
    case "taxRevenue":
      return c.taxRevenue;
    case "corruption":
      return c.after.corruption;
    case "happiness":
      return c.after.happiness;
    default:
      return 0;
  }
};

const pickFrom = <A>(items: readonly A[]): Effect.Effect<A, never, Rng> =>
  Effect.flatMap(random, (u) => {
    const item = items[Math.floor(u * items.length)];
    return item === undefined ? Effect.die(new Error("empty vocabulary")) : Effect.succeed(item);
  });

interface Draft {
  readonly template: ArticleTemplateData;
  readonly entities: Entities;
  readonly threadKey: ThreadKey | null;
  readonly isFollowUp: boolean;
}

const PLACEHOLDER = /\{(\w+)\}/g;

/** 文面のスロットを埋める。宣言されていない・値のないスロットは Effect.die（CLAUDE.md §4-16） */
export const fillSlots = (text: string, values: Readonly<Partial<Record<SlotName, string>>>): Effect.Effect<string> =>
  Effect.suspend(() => {
    let missing: string | null = null;
    const filled = text.replace(PLACEHOLDER, (_, name: string) => {
      const value = values[name as SlotName];
      if (value === undefined) missing = name;
      return value ?? "";
    });
    return missing === null ? Effect.succeed(filled) : Effect.die(new Error(`slot {${missing}} has no value`));
  });

/** 1本の記事を作る（偏向の変換込み）。検閲で消えたら null */
const render = (
  draft: Draft,
  c: NewsContext,
): Effect.Effect<{ article: NewspaperArticle | null; censored: boolean; praised: boolean; hedged: number }, never, Rng> =>
  Effect.gen(function* () {
    const t = draft.template;
    // 3) 削除：負の記事は 検閲/100 × 感度 の確率で消える（イベント記事は消さない。Z-09）
    if (t.negative && !t.uncensorable && (yield* random) < (NEWSPAPER_CENSORSHIP / PERCENT) * t.bias.censorship) {
      return { article: null, censored: true, praised: false, hedged: 0 };
    }
    // 4) 称賛転換：行政面の負の記事は 官僚圧力/100 × 感度 の確率で称賛記事に反転
    const praised = t.praise !== undefined && (yield* random) < (NEWSPAPER_BUREAUCRATIC_PRESSURE / PERCENT) * t.bias.bureaucratic;
    const text: ArticleText = praised && t.praise ? t.praise : t;

    // 1) 数値のヘッジ：思想的偏向/100 × 感度 の確率で、正確な数値を「概ね」付きの丸めた値に
    let truth = 1;
    let hedged = 0;
    const values: Partial<Record<SlotName, string>> = {};
    const hedgeChance = (NEWSPAPER_IDEOLOGICAL_BIAS / PERCENT) * Math.max(t.bias.ideological, t.numberSource ? 0 : 1);
    if (t.slots.includes("num") || t.slots.includes("pct")) {
      const exact = numberFor(t, c);
      const hedgeNumber = (yield* random) < hedgeChance;
      const shown = hedgeNumber ? Math.round(exact / NEWS_HEDGE_ROUNDING) * NEWS_HEDGE_ROUNDING : Math.round(exact);
      values.num = String(shown);
      values.pct = `${shown}%`;
      values.hedge = hedgeNumber ? yield* pickFrom(VOCABULARY.hedges) : "";
      if (hedgeNumber) {
        hedged++;
        truth -= TRUTH_PENALTY_HEDGE;
      }
    } else if (t.slots.includes("hedge")) {
      const useHedge = (yield* random) < hedgeChance;
      values.hedge = useHedge ? yield* pickFrom(VOCABULARY.hedges) : "";
      if (useHedge) {
        hedged++;
        truth -= TRUTH_PENALTY_HEDGE;
      }
    }
    // 2) 婉曲化
    if (t.slots.includes("euphemism")) {
      values.euphemism = yield* pickFrom(VOCABULARY.euphemisms);
      truth -= TRUTH_PENALTY_EUPHEMISM;
    }
    if (praised) truth -= TRUTH_PENALTY_PRAISE;
    if (t.slots.includes("place")) values.place = yield* pickFrom(VOCABULARY.places);
    if (t.slots.includes("season")) values.season = yield* pickFrom(VOCABULARY.seasons);
    if (t.slots.includes("faction")) values.faction = yield* pickFrom(VOCABULARY.factions);
    if (t.slots.includes("building")) {
      values.building = messages.targets[draft.entities.building ?? (yield* pickFrom(BUILDING_IDS))];
    }
    if (t.slots.includes("aide") && draft.entities.aide) values.aide = aideName(draft.entities.aide);
    if (t.slots.includes("event") && c.event) values.event = messages.events[c.event.kind];

    const prefix = draft.isFollowUp ? VOCABULARY.followUpPrefix : "";
    const headline = prefix + (yield* fillSlots(text.headline, values));
    const body: string[] = [];
    for (const paragraph of text.body) body.push(yield* fillSlots(paragraph, values));

    const relatedEntity: NewspaperArticle["relatedEntity"] = draft.entities.building
      ? { kind: "building", id: draft.entities.building }
      : draft.entities.aide
        ? { kind: "aide", id: draft.entities.aide }
        : c.event && t.uncensorable
          ? { kind: "event", id: c.event.kind }
          : null;
    return {
      article: {
        id: t.id,
        section: t.section,
        headline,
        body,
        threadKey: draft.threadKey,
        isFollowUp: draft.isFollowUp,
        biasApplied: {
          ideological: NEWSPAPER_IDEOLOGICAL_BIAS * t.bias.ideological,
          censorship: NEWSPAPER_CENSORSHIP * t.bias.censorship,
          bureaucratic: NEWSPAPER_BUREAUCRATIC_PRESSURE * t.bias.bureaucratic,
        },
        truthfulness: Math.max(0, truth),
        relatedEntity,
      },
      censored: false,
      praised,
      hedged,
    };
  });

// --- 継続スレッド（v3.2 §1.7） ---

const threadEntity = (key: ThreadKey, c: NewsContext): string | null | false => {
  switch (key) {
    case "corruption":
      return c.after.corruption > NEWS_HIGH_CORRUPTION ? null : false;
    case "granary_hollow":
      return undisclosedHollow(c.buildings)[0] ?? false;
    case "aide_ambition":
      return c.aides.find((a) => a.ambition >= NEWS_AMBITIOUS_AIDE)?.id ?? false;
    case "housing_crisis":
      return c.after.population > c.derived.housingCapacity ? null : false;
  }
};

const threadResolved = (thread: Thread, c: NewsContext): boolean => {
  switch (thread.key) {
    case "corruption":
      return c.after.corruption < NEWS_CORRUPTION_RESOLVED || c.buildings.some((b) => b.kind === "courthouse" && !b.hollow);
    case "granary_hollow":
      return undisclosedHollow(c.buildings).length === 0;
    case "aide_ambition":
      return !c.aides.some((a) => a.id === thread.entity);
    case "housing_crisis":
      return c.derived.housingCapacity >= c.after.population;
  }
};

const threadLength = (key: ThreadKey): Effect.Effect<number | null, never, Rng> =>
  key === "housing_crisis"
    ? Effect.succeed(null)
    : key === "aide_ambition"
      ? Effect.succeed(THREAD_MIN_TURNS)
      : Effect.map(random, (u) => THREAD_MIN_TURNS + Math.floor(u * (THREAD_MAX_TURNS - THREAD_MIN_TURNS + 1)));

const PRIORITY = { thread: 0, front: 1, negative: 2, other: 3, flavor: 4 } as const;
const priorityOf = (d: Draft) =>
  d.threadKey !== null
    ? PRIORITY.thread
    : d.template.section === "front"
      ? PRIORITY.front
      : d.template.negative
        ? PRIORITY.negative
        : (FLAVOR_IDS as readonly string[]).includes(d.template.id)
          ? PRIORITY.flavor
          : PRIORITY.other;

/** v3.2 §1.6 の生成アルゴリズム */
export const generateNewspaper = (c: NewsContext): Effect.Effect<NewsResult> => {
  const seed = newspaperSeed(c.saveId, c.turn);
  return Effect.gen(function* () {
    const drafts: Draft[] = [];
    const quota: Record<Section, number> = { ...SECTION_QUOTA };
    const used = new Set<string>();
    const take = (draft: Draft) => {
      drafts.push(draft);
      used.add(draft.template.id);
      quota[draft.template.section] = Math.max(0, quota[draft.template.section] - 1);
    };

    // 1) 続いているスレッドを優先して記事化（最大2件）
    const threads: Thread[] = [];
    for (const thread of c.state.threads) {
      if (thread.endedTurn !== null) {
        if (c.turn - thread.endedTurn < THREAD_MAX_TURNS) threads.push(thread);
        continue;
      }
      if (threadResolved(thread, c)) {
        threads.push({ ...thread, endedTurn: c.turn });
        continue;
      }
      const followUps = drafts.filter((d) => d.isFollowUp).length;
      const template = templateById(THREAD_TEMPLATE[thread.key]);
      if (followUps < NEWSPAPER_MAX_THREAD_ARTICLES && !used.has(template.id)) {
        const entities: Entities =
          thread.key === "granary_hollow" && thread.entity
            ? { building: thread.entity as BuildingId }
            : thread.key === "aide_ambition" && thread.entity
              ? { aide: thread.entity }
              : {};
        take({ template, entities, threadKey: thread.key, isFollowUp: true });
      }
      const remaining = thread.remaining === null ? null : thread.remaining - 1;
      threads.push({ ...thread, remaining, endedTurn: remaining !== null && remaining <= 0 ? c.turn : null });
    }

    // 2) セクションごとに、条件を満たすテンプレートを重み付き抽選（直近3年に使ったものは重み×0.3）
    const recent = new Set(c.state.recentTemplates.filter((r) => c.turn - r.turn <= NEWSPAPER_RECENT_TURNS).map((r) => r.id));
    for (const section of SECTIONS) {
      while (quota[section] > 0) {
        const candidates = TEMPLATES.filter((t) => t.section === section && !used.has(t.id))
          .map((t) => ({ t, entities: evaluateTrigger(t.trigger, c) }))
          .filter((x): x is { t: ArticleTemplateData; entities: Entities } => x.entities !== null);
        if (candidates.length === 0) break;
        const weights = candidates.map((x) => x.t.weight * (recent.has(x.t.id) ? NEWSPAPER_RECENT_WEIGHT : 1));
        const total = weights.reduce((a, b) => a + b, 0);
        let u = (yield* random) * total;
        let chosen = candidates[0];
        for (let i = 0; i < candidates.length; i++) {
          u -= weights[i] ?? 0;
          if (u < 0) {
            chosen = candidates[i];
            break;
          }
        }
        if (!chosen) break;
        take({ template: chosen.t, entities: chosen.entities, threadKey: chosen.t.threadKey ?? null, isFollowUp: false });
      }
    }

    // 3) 上限7で打ち切る（優先：スレッド → 第一面 → 負の記事 → その他 → フレーバー。V-10）
    const kept = [...drafts].sort((a, b) => priorityOf(a) - priorityOf(b)).slice(0, NEWSPAPER_MAX_ARTICLES);

    // 4) 偏向の変換（削除・称賛転換・ヘッジ・婉曲）
    const articles: NewspaperArticle[] = [];
    const censoredIds: string[] = [];
    const praisedIds: string[] = [];
    let hedgedCount = 0;
    for (const draft of kept) {
      const r = yield* render(draft, c);
      if (r.censored) censoredIds.push(draft.template.id);
      if (r.praised) praisedIds.push(draft.template.id);
      hedgedCount += r.hedged;
      if (r.article) articles.push(r.article);
    }

    // 5) 5本未満ならフレーバー（広告・天候）で穴埋め
    for (let i = 0; articles.length < NEWSPAPER_MIN_ARTICLES; i++) {
      const id = FLAVOR_IDS[i % FLAVOR_IDS.length] ?? "N-19";
      const r = yield* render({ template: templateById(id), entities: {}, threadKey: null, isFollowUp: false }, c);
      if (r.article) articles.push(r.article);
    }

    // 6) 新しいスレッドを始める（終わってすぐの話題は再開しない）
    const nextThreads = [...threads];
    for (const key of Object.keys(THREAD_TEMPLATE) as ThreadKey[]) {
      if (nextThreads.some((t) => t.key === key)) continue;
      const entity = threadEntity(key, c);
      if (entity === false) continue;
      nextThreads.push({ key, startedTurn: c.turn, remaining: yield* threadLength(key), entity, endedTurn: null });
    }

    // 7) 紙面の順に並べる
    const order = (a: NewspaperArticle) => SECTIONS.indexOf(a.section);
    articles.sort((a, b) => order(a) - order(b) || Number(b.isFollowUp) - Number(a.isFollowUp));

    const recentTemplates = [
      ...c.state.recentTemplates.filter((r) => c.turn - r.turn < NEWSPAPER_RECENT_TURNS),
      ...[...new Set(articles.map((a) => a.id))].map((id) => ({ id, turn: c.turn })),
    ];
    return {
      newspaper: { turn: c.turn, seed, articles, stats: { censoredIds, praisedIds, hedgedCount } },
      state: { threads: nextThreads.filter((t) => t.endedTurn === null || c.turn - t.endedTurn < THREAD_MAX_TURNS), recentTemplates },
    };
  }).pipe(Effect.provideServiceEffect(Rng, makeRng(seed)));
};

// --- 文面化（UI 用。truthfulness などは出さない） ---

export interface RenderedNewspaper {
  readonly title: string;
  readonly articles: readonly { readonly section: string; readonly headline: string; readonly body: readonly string[] }[];
}

export const renderNewspaper = (newspaper: Newspaper): RenderedNewspaper => ({
  title: messages.newspaper.title(newspaper.turn),
  articles: newspaper.articles.map((a) => ({ section: messages.newspaper.sections[a.section], headline: a.headline, body: a.body })),
});
