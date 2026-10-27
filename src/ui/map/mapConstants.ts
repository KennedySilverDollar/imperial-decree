// 測量図の表示用の定数（SPEC_v3.3 §5）。ゲームのバランス値ではないので domain/constants.ts には置かない（DECISIONS AB-11 と同じ扱い）。
// 長さは地図の画素（描画の解像度 MAP_PX 四方）で表す。

/** 地図の描画の解像度（正方形） */
export const MAP_PX = 2400;
/** 村域（論理グリッド 10×10 を写す正方形）の左上と一辺 */
export const VILLAGE_ORIGIN = 600;
export const VILLAGE_SIZE = 1200;

/** 標高の格子（2048 四方の代わりに間引いた解像度：§11.1「間引いた解像度でも可」） */
export const HEIGHTMAP_SIZE = 400;

// --- 地形の形 ---
/** fBm のオクターブ（§5.2-1「5〜6オクターブ」）と、ドメインワーピングのオクターブ・強さ */
export const TERRAIN_OCTAVES = 5;
export const WARP_OCTAVES = 2;
export const WARP_STRENGTH = 0.45;
/** 標高の基本の周波数（地図の一辺あたり） */
export const TERRAIN_FREQUENCY = 2.2;
/** 村域の平地の高さ。等高線の間隔のちょうど中ほどに置き、村域に等高線が通らないようにする */
export const CONTOUR_INTERVAL = 0.04;
export const PLAIN_LEVEL = CONTOUR_INTERVAL * 8.5;
/** 村域の平地に残すわずかな起伏（等高線をまたがない大きさ） */
export const PLAIN_UNDULATION = 0.006;
/** 村域の縁から外へ、完全に平らに保つ幅と、元の地形へ戻るまでの幅 */
export const BASIN_MARGIN = 40;
export const BASIN_FALLOFF = 260;
/** 丘の辺の盛り上がり・野と沼の辺の下がり・森の辺のわずかな盛り上がり・川の辺の傾き */
export const HILL_RISE = 0.42;
export const LOWLAND_SINK = 0.14;
export const FOREST_RISE = 0.08;
export const RIVER_TILT = 0.12;
/** 外側の帯で地形の効き方が最大になる距離 */
export const SIDE_REACH = 420;

// --- 水系 ---
/** 川の幅と、村域の縁から川岸までの最小の距離（川は村域に入らない） */
export const RIVER_WIDTH = 30;
export const RIVER_GAP = 80;
/** 川の谷を刻む幅 */
export const RIVER_VALLEY = 170;
/** 川の水面の高さ（上流と下流） */
export const RIVER_LEVEL_HIGH = 0.26;
export const RIVER_LEVEL_LOW = 0.18;
/** 川の経路を探す粗い格子の一辺の数（地図の一辺を何マスに割るか） */
export const RIVER_GRID = 120;
/** 地図の縁の余白（川・沼をここまで寄せない） */
export const EDGE_MARGIN = 70;
/** 沼の半径の範囲と、村域から沼の岸までの最小の距離 */
export const LAKE_RADIUS_MIN = 95;
export const LAKE_RADIUS_MAX = 160;
export const LAKE_GAP = 90;
/** 沼の岸の揺らぎ（半径に対する割合） */
export const LAKE_WOBBLE = 0.22;
export const LAKE_SHORE = 140;

// --- 森・地味 ---
export const FOREST_FREQUENCY = 7;
export const FOREST_THRESHOLD = 0.56;
export const FOREST_SIDE_BIAS = 0.34;
/** 森を置かない：村域からの距離・川からの距離・これより高い頂 */
export const FOREST_VILLAGE_GAP = 110;
export const FOREST_RIVER_GAP = 45;
export const FOREST_PEAK = 0.88;
/** 地味：水辺からこの距離で半分になる */
export const FERTILITY_WATER_REACH = 260;

// --- 建設可能の判定と再試行 ---
/** 急傾斜とみなす傾き（標高差／地図の 100px） */
export const SLOPE_MAX = 0.05;
/** 建設可能を保証できないときに seed を変えて試す回数の上限。尽きたら安全な地形（川・沼を外縁に寄せる）にする */
export const TERRAIN_MAX_ATTEMPTS = 6;

// --- 区画 ---
/** 頂点のずらし幅（区画の一辺に対する割合）と、Lloyd 緩和の回数・寄せる割合 */
export const PARCEL_JITTER = 0.3;
export const PARCEL_RELAX_ITERATIONS = 2;
export const PARCEL_RELAX_BLEND = 0.5;
/** 区画の辺を何本の小さな線分に分け、どれだけ揺らすか（辺の長さに対する割合） */
export const PARCEL_EDGE_SEGMENTS = 3;
export const PARCEL_EDGE_WOBBLE = 0.05;

// --- 道路 ---
/** 道路の区画に接する辺は安く、それ以外の境界は高くつける（A* の重み） */
export const ROAD_EDGE_COST = 1;
export const OTHER_EDGE_COST = 4;
/** Catmull-Rom の1区間あたりの分割数 */
export const ROAD_CURVE_STEPS = 6;
/** 道路の二重線の幅と線の太さ */
export const ROAD_WIDTH = 16;
export const ROAD_LINE = 2;

// --- 測量の遅れ（§5.9。既定は無効のフラグ） ---
export const SURVEY_DELAY_DEFAULT = false;
/** 測量の遅れを有効にしたとき、何年ごとに測量するか */
export const SURVEY_INTERVAL_YEARS = 3;

// --- 手元の操作 ---
/** ホイールで切り替える3段階のズーム（村域全体〜区画1つ程度。§5.6） */
export const MAP_ZOOM_LEVELS = [1, 2, 4] as const;
/** 手元の地図の表示の一辺（CSS px） */
export const MAP_VIEW = 640;
/** 俯瞰に置く地図の静止画の一辺（px） */
export const MAP_SNAPSHOT = 900;
