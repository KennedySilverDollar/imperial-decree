// バランス値と仕様上の定数（docs/BALANCE.md 第2部 §20・第3部 §21〜§26 と対応。変更時は BALANCE.md も更新する）

// --- 初期値・資源 ---
export const INITIAL_POPULATION = 120;
export const INITIAL_TREASURY = 500;
export const INITIAL_HAPPINESS = 50;
export const INITIAL_INFRASTRUCTURE = 10;
export const INITIAL_CORRUPTION = 5;
export const INITIAL_POLITICAL_CAPITAL = 3;
export const POLITICAL_CAPITAL_INCOME = 1;
export const POLITICAL_CAPITAL_MAX = 5;
export const DECREE_POLITICAL_COST = 1;
export const APPOINT_POLITICAL_COST = 1;
export const DISMISS_POLITICAL_COST = 0;
export const DECREE_BASE_COST = 10;
export const MAX_TURNS = 50;
export const MAX_AIDES = 2;
export const APPOINT_CANDIDATE_COUNT = 2;

// --- 勅令入力 ---
export const DECREE_CHAR_LIMIT = 40;
export const TAG_CHAR_COST = 5;
export const MAX_TAGS = 4;
export const SCALE_TAG_MAGNITUDE = { small: 25, medium: 50, large: 80 } as const;
export const DEFAULT_TEMPLATE_MAGNITUDE = 50;
export const TEMPLATE_MATCH_CONFIDENCE = 0.6;
export const INTENT_BONUS_HAPPINESS = 5;

// --- パラメータ範囲 ---
export const PARAM_MIN = 0;
export const PARAM_MAX = 100;
export const MAGNITUDE_MIN = -100;
export const MAGNITUDE_MAX = 100;
export const CONFIDENCE_MIN = 0;
export const CONFIDENCE_MAX = 1;
export const BUDGET_MIN = 0;
export const LOW_CONFIDENCE_THRESHOLD = 0.3;

// --- 人口（BALANCE §15, §26） ---
export const HAPPINESS_GROWTH_THRESHOLD = 50;
export const HAPPINESS_NEUTRAL = 50;
export const POPULATION_GROWTH_BASE = 0.04;
export const POPULATION_GROWTH_PER_HAPPINESS = 0.002;
export const POPULATION_OUTFLOW_PER_HAPPINESS = 0.004;
export const OVERCROWD_OUTFLOW_RATE = 0.15;
/** 過密の度合い = (人口 − 住宅容量) / この値（v3.2 §2.5） */
export const OVERCROWD_DIVISOR = 50;
export const PEOPLE_PER_FOOD = 12;
export const FAMINE_HAPPINESS_PENALTY = 15;
export const FAMINE_OUTFLOW_RATE = 0.15;
export const SANITATION_LOW = 3;
export const SANITATION_PENALTY = 3;
export const DISEASE_OUTFLOW_RATE = 0.02;
export const SECURITY_LOW = 3;
export const SECURITY_PENALTY = 3;
/** 予備のベースライン（既定0。BALANCE §13） */
export const SANITATION_BASE = 0;
export const SECURITY_BASE = 0;

// --- 税収と支出（BALANCE §12, §14, §26） ---
export const TAX_PER_CAPITA = 1.45;
export const AIDE_SALARY = 15;
export const UPKEEP_MULTIPLIER = 1.5;
export const BUILD_COST_MULTIPLIER = 1.0;
export const ROAD_TILE_TAX = 2;
export const ROAD_TILE_UPKEEP = 1;
export const PERCENT = 100;

// --- 幸福度（BALANCE §15） ---
export const HAPPINESS_EQUILIBRIUM_BASE = 45;
export const HAPPINESS_PER_INFRA = 0.2;
export const HAPPINESS_REF_POP = 120;
export const HAPPINESS_PENALTY_PER_CORRUPTION = 0.2;
export const HAPPINESS_REVERT_RATE = 0.1;
export const CROWDING_HAPPINESS_PENALTY = 3;
export const NEGLECTED_CORRUPTION_THRESHOLD = 50;
export const NEGLECTED_CORRUPTION_PENALTY = 3;

// --- インフラ・汚職 ---
export const INFRA_DECAY_CHANCE = 0.3;
export const INFRA_DECAY_AMOUNT = 1;
export const CORRUPTION_DRIFT_PER_TURN = 0.3;

// --- 建設（BALANCE §14, §21） ---
export const MAGNITUDE_PER_BUILDING = 34;
export const MAX_BUILD_PER_DECREE = 3;
/** 道路を手抜きされたときに残るインフラの割合 */
export const HOLLOW_ROAD_INFRA_FACTOR = 0.5;
export const SCHOOL_ADMIN_DELAY_TURNS = 5;
export const ADMIN_ACCURACY_PER_POINT = 0.05;
export const ADMIN_ACCURACY_MAX = 0.15;
export const HOLLOW_REPAIR_COST_RATIO = 0.5;

// --- 労働人口と資材（BALANCE §22〜§24、v3.3） ---
export const LABOR_RATIO = 0.5;
export const OVERLOAD_SEVERE = 1.5;
export const OVERLOAD_HOLLOW_GAIN = 0.3;
export const OVERLOAD_CORRUPTION_PER_TURN = 1.0;
export const INITIAL_WOOD = 60;
export const INITIAL_STONE = 40;
export const WOOD_INCOME = 20;
export const STONE_INCOME = 16;
export const WORKSHOP_WOOD = 3;
export const WORKSHOP_STONE = 2;
export const MATERIAL_CAP = 200;
export const SHORTAGE_SEVERE = 0.5;
export const SHORTAGE_HOLLOW_GAIN = 0.6;
export const SHORTAGE_CORRUPTION_PER_TURN = 2.0;
/** 完成時の空洞化確率の上限 */
export const HOLLOW_CHANCE_CAP = 0.9;
/** 汚職率そのものによる空洞化確率の上限（v3.2 §2.8） */
export const HOLLOW_MAX_CHANCE = 0.3;

// --- 政策（BALANCE §16） ---
export const POLICY_LEVEL_MAX = 2;
export const POLICY_DURATION_TURNS = 4;
export const POLICY_LARGE_MAGNITUDE = 60;
export const TAX_RATE_INCOME_PER_LEVEL = 0.15;
export const TAX_RATE_HAPPINESS_PER_LEVEL = 3;
export const TAX_RATE_SHOCK_PER_LEVEL = 2;
export const WELFARE_HAPPINESS_PER_LEVEL = 3;
export const WELFARE_COST_PER_CAPITA_PER_LEVEL = 0.12;
export const SECURITY_POLICY_SECURITY_PER_LEVEL = 2;
export const SECURITY_POLICY_HAPPINESS_PER_LEVEL = 1.5;
export const SECURITY_POLICY_COST_PER_LEVEL = 10;

// --- ランダムイベント（BALANCE §25、DECISIONS §12.4） ---
export const EVENT_COOLDOWN_TURNS = 3;
export const EVENT_MAX_TURNS = 5;
export const EVENT_RESOLVE_HAPPINESS = 3;
export const EPIDEMIC_CHANCE = 0.04;
export const EPIDEMIC_CHANCE_LOW_SANITATION = 0.05;
export const EPIDEMIC_POPULATION_LOSS = 0.04;
export const EPIDEMIC_HAPPINESS_PENALTY = 6;
export const EPIDEMIC_AFTERMATH_HAPPINESS = 8;
export const FAMINE_EVENT_CHANCE = 0.05;
export const FAMINE_EVENT_CHANCE_NO_GRANARY = 0.03;
export const FAMINE_EVENT_FOOD_FACTOR = 0.5;
export const FAMINE_EVENT_AFTERMATH_POPULATION = 0.05;
export const BANDIT_CHANCE = 0.04;
export const BANDIT_CHANCE_LOW_SECURITY = 0.05;
export const BANDIT_TREASURY_LOSS = 25;
export const BANDIT_WOOD_LOSS = 0.2;
export const BANDIT_HAPPINESS_PENALTY = 4;
export const BANDIT_AFTERMATH_CORRUPTION = 5;

// --- 側近の解釈精度（SPEC §7.6 / A-04） ---
export const ACCURACY_BASE = 0.3;
export const ACCURACY_ABILITY_DIVISOR = 200;
export const ACCURACY_SPECIALTY_BONUS = 0.2;
export const ACCURACY_TRUST_THRESHOLD = 70;
export const ACCURACY_TRUST_BONUS = 0.1;
export const ACCURACY_AMBITION_THRESHOLD = 70;
export const ACCURACY_AMBITION_PENALTY = 0.2;

// --- 歪み（SPEC §6.4） ---
export const MISREAD_CHANCE_SCALE = 1.0;
export const MISREAD_MIN = 0.3;
export const MISREAD_MAX = 0.5;
/** 誤読が過大側に振れる確率（符号は等確率） */
export const MISREAD_UPWARD_CHANCE = 0.5;
export const TARGET_SWAP_CHANCE_SCALE = 0.5;
export const WATER_DOWN_BASE_CHANCE = 0.4;
export const WATER_DOWN_LOYALTY_DIVISOR = 200;
export const WATER_DOWN_EFFECT_FACTOR = 0.5;
export const CONCEAL_AMBITION_MIN = 60;
export const CONCEAL_LOYALTY_MAX = 60;
export const CONCEAL_BASE_CHANCE = 0.3;
export const CONCEAL_DIVISOR = 100;
/** 保守派が「急な大事業」とみなす規模 */
export const CONSERVATIVE_LARGE_MAGNITUDE = 60;

// --- 側近報告 ---
export const REPORT_OMIT_CHANCE_DIVISOR = 400;
export const REPORT_LOW_TRUST_THRESHOLD = 40;
export const REPORT_LOW_TRUST_MAX_ITEMS = 2;
/** これ未満の変化は報告しない */
export const REPORT_MIN_DELTA = 0.5;

// --- 成功条件 ---
export const SUCCESS_POPULATION = 300;
export const SUCCESS_INFRASTRUCTURE = 25;

// --- 地図（v3.2 §2.6 / BALANCE §14） ---
export const GRID_SIZE = 10;
export const INFRA_PER_ROAD_TILE = 5;
/** 道路に予約する区画（十字）の数。建物は残りの区画に置く */
export const ROAD_TILE_MAX = 19;
export const HOLLOW_DISCLOSE_ABILITY_MIN = 70;

// --- 新聞 v2（v3.2 §1.5〜§1.7 / BALANCE §18） ---
export const NEWSPAPER_IDEOLOGICAL_BIAS = 30;
export const NEWSPAPER_CENSORSHIP = 20;
export const NEWSPAPER_BUREAUCRATIC_PRESSURE = 10;
export const NEWSPAPER_MAX_ARTICLES = 7;
export const NEWSPAPER_MIN_ARTICLES = 5;
export const NEWSPAPER_MAX_THREAD_ARTICLES = 2;
export const NEWSPAPER_RECENT_TURNS = 3;
export const NEWSPAPER_RECENT_WEIGHT = 0.3;
export const THREAD_MIN_TURNS = 2;
export const THREAD_MAX_TURNS = 3;
export const NEWS_LOW_HAPPINESS = 40;
export const NEWS_HIGH_CORRUPTION = 30;
export const NEWS_CORRUPTION_RESOLVED = 20;
export const NEWS_AMBITIOUS_AIDE = 70;
/** 遷移間近：成功条件のうち2つを満たし、残り1つがこの割合以上（W-08。記事 N-03） */
export const NEWS_NEAR_TRANSITION_RATIO = 0.9;
/** 数値をぼかすときの丸め単位 */
export const NEWS_HEDGE_ROUNDING = 10;
export const TRUTH_PENALTY_HEDGE = 0.1;
export const TRUTH_PENALTY_EUPHEMISM = 0.2;
export const TRUTH_PENALTY_PRAISE = 0.5;
/** 側近報告での工期見積りの誤差（能力が低いほど大きい） */
export const ESTIMATE_ERROR_DIVISOR = 200;

// --- LLM ---
export const LLM_TIMEOUT_MS = 5000;
export const LLM_MAX_RETRIES = 2;
export const LLM_BACKOFF_BASE_MS = 500;
export const LLM_TEMPERATURE = 0.2;

// --- LLM プロキシ（src/proxy、SPEC §11.6） ---
export const LLM_MODEL = "mistral-small-latest";
/** プロキシから Mistral への待ち時間。クライアントの LLM_TIMEOUT_MS より短くして、先にプロキシが 504 を返す */
export const PROXY_UPSTREAM_TIMEOUT_MS = 4500;
export const PROXY_MAX_OUTPUT_TOKENS = 200;
/** 本文の最大文字数（クライアント側の文字数制限より緩い安全網） */
export const PROXY_MAX_TEXT_CHARS = 200;
export const PROXY_MAX_BODY_BYTES = 4096;
export const PROXY_RATE_LIMIT_PER_MINUTE = 20;
export const PROXY_RATE_LIMIT_WINDOW_MS = 60_000;

/** モック参謀の思案時間（P2：UI 確認用。P3 で本番 LLM に置き換える） */
export const LLM_MOCK_DELAY_MS = 600;

// --- 計測ログ ---
export const LOG_STORAGE_KEY = "imperial-decree/log";
export const LOG_MAX_ENTRIES = 5000;

// --- UI 演出 ---
/** 判子アニメの長さ（SPEC §12.8：簡易1秒） */
export const STAMP_ANIMATION_MS = 1000;
export const PAPER_FADE_MS = 400;
/** 投書欄の記事にこれだけとどまったら「参照した」と数える（v3.2 §3.2 の計測） */
export const LETTERS_DWELL_MS = 1200;

// --- セーブ ---
export const SAVE_SCHEMA_VERSION = 2;
export const SAVE_STORAGE_KEY = "imperial-decree/save";

// --- シミュレーション（npm run sim 専用） ---
export const SIM_GAMES = 1000;
export const HEURISTIC_NOISE = 0.35;
export const SIM_RANDOM_MAGNITUDE_MIN = 10;
export const SIM_RANDOM_MAGNITUDE_MAX = 100;
export const SIM_RANDOM_NEGATIVE_CHANCE = 0.15;
