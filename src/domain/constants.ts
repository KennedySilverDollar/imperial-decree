// バランス値と仕様上の定数（docs/BALANCE.md §10 と対応。変更時は BALANCE.md も更新する）

// --- 初期値・資源 ---
export const INITIAL_POPULATION = 120;
export const INITIAL_TREASURY = 500;
export const INITIAL_HAPPINESS = 50;
export const INITIAL_INFRASTRUCTURE = 10;
export const INITIAL_CORRUPTION = 5;
export const INITIAL_HOUSING_UNITS = 8;
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
export const TAG_CHAR_COST = 3;
export const MAX_TAGS = 2;
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
/** 縮小後の効果量がこれ未満なら「何もできなかった」扱い（DECISIONS N-10） */
export const MIN_EFFECTIVE_SCALE = 0.01;

// --- 人口 ---
export const RESIDENTS_PER_HOUSING_TILE = 20;
export const HAPPINESS_GROWTH_THRESHOLD = 50;
export const HAPPINESS_NEUTRAL = 50;
export const POPULATION_GROWTH_BASE = 0.03;
export const POPULATION_GROWTH_PER_HAPPINESS = 0.002;
export const POPULATION_OUTFLOW_PER_HAPPINESS = 0.004;
export const OVERCROWD_OUTFLOW_RATE = 0.15;

// --- 税収と支出 ---
export const TAX_PER_CAPITA = 1.25;
export const INFRA_UPKEEP_PER_POINT = 2.0;
export const AIDE_SALARY = 15;
export const OFFICE_UPKEEP = 20;
export const MARKET_TAX_BONUS = 0.12;
export const MARKET_MAX = 3;
export const PERCENT = 100;

// --- 幸福度 ---
export const HAPPINESS_EQUILIBRIUM_BASE = 48;
export const HAPPINESS_PER_INFRA = 0.4;
export const HAPPINESS_PENALTY_PER_CORRUPTION = 0.2;
export const HAPPINESS_REVERT_RATE = 0.1;
export const CROWDING_HAPPINESS_PENALTY = 3;
export const NEGLECTED_CORRUPTION_THRESHOLD = 50;
export const NEGLECTED_CORRUPTION_PENALTY = 3;

// --- インフラ・汚職 ---
export const INFRA_DECAY_CHANCE = 0.3;
export const INFRA_DECAY_AMOUNT = 1;
export const CORRUPTION_DRIFT_PER_TURN = 0.3;

// --- 勅令の効果（action × target） ---
export const ROAD_INFRA_PER_MAG = 0.12;
export const ROAD_COST_PER_MAG = 4;
export const WELL_INFRA_PER_MAG = 0.06;
export const WELL_HAPPINESS_PER_MAG = 0.05;
export const WELL_COST_PER_MAG = 3;
export const RESIDENTIAL_UNITS_PER_MAG = 0.06;
export const RESIDENTIAL_COST_PER_MAG = 5;
export const MARKET_COST = 150;
export const LEVY_PER_CAPITA_PER_MAG = 0.03;
export const LEVY_HAPPINESS_PER_MAG = 0.25;
export const RELIEF_HAPPINESS_PER_MAG = 0.1;
export const WELFARE_HAPPINESS_PER_MAG = 0.15;
export const WELFARE_COST_PER_MAG = 3;
export const SECURITY_CORRUPTION_PER_MAG = 0.1;
export const SECURITY_HAPPINESS_PER_MAG = 0.03;
export const SECURITY_COST_PER_MAG = 2;

// --- 役所 ---
export const OFFICE_COST = 400;
export const OFFICE_MIN_POPULATION = 200;
export const OFFICE_MIN_INFRASTRUCTURE = 15;

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

// --- 地図 ---
export const GRID_SIZE = 10;
export const INFRA_PER_ROAD_TILE = 5;
export const MIN_EMPTY_TILES = 10;
export const HOLLOW_DECAY_PER_TURN = 1;
export const HOLLOW_DISCLOSE_ABILITY_MIN = 70;

// --- 新聞 ---
export const NEWSPAPER_BIAS = 30;
export const NEWSPAPER_TONE_CHANCE = 0.3;

// --- LLM ---
export const LLM_TIMEOUT_MS = 5000;
export const LLM_MAX_RETRIES = 2;
export const LLM_BACKOFF_BASE_MS = 500;
export const LLM_TEMPERATURE = 0.2;

// --- セーブ ---
export const SAVE_SCHEMA_VERSION = 1;
export const SAVE_STORAGE_KEY = "imperial-decree/save";

// --- シミュレーション（pnpm sim 専用） ---
export const SIM_GAMES = 1000;
export const HEURISTIC_NOISE = 0.35;
export const SIM_RANDOM_MAGNITUDE_MIN = 10;
export const SIM_RANDOM_MAGNITUDE_MAX = 100;
export const SIM_RANDOM_NEGATIVE_CHANCE = 0.15;
