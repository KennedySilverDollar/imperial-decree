// 地図の描画層（M2：区画・道路・建物・普請中・開墾）の表示用の定数。ゲームのバランス値ではないので domain/constants.ts には置かない。
// 長さはメートル。

/** 区画の母点の揺らし：等高線に沿う向き・横切る向き・十字の通りを横切る向き */
export const PARCEL_JITTER_ALONG_M = 14;
export const PARCEL_JITTER_ACROSS_M = 6;
export const PARCEL_JITTER_CROSS_M = 2;
/** 制約付き Lloyd 緩和：回数・1回に重心へ寄せる割合・母点がセルの縁から保つ距離 */
export const LLOYD_ITERATIONS = 3;
export const LLOYD_STEP = 0.6;
export const PARCEL_SITE_MARGIN_M = 10;
/** 十字の通りの母点が通りの中心線から離れてよい距離 */
export const CROSS_SITE_SLACK_M = 3;

/** 本通りの幅と、角を丸める回数 */
export const ROAD_WIDTH_M = 9;
export const ROAD_SMOOTHING = 2;
/** 装飾の脇道：本通りまでの最大の長さ */
export const SIDE_PATH_MAX_M = 90;

/** 建物の配置：区画の内側に空ける余白・向きの揺らぎ（度）・同じ区画の棟の間隔 */
export const BUILDING_INSET_M = 4;
export const BUILDING_ROTATION_JITTER_DEG = 8;
export const BUILDING_GAP_M = 2;

/** 開墾：完成した畑1つあたり・最大で村域の外へ広げる距離（BB-08：村域外へ数十m） */
export const CLEARING_PER_FARM_M = 8;
export const CLEARING_MAX_M = 60;
export const CLEARING_BASE_M = 12;
/** 耕作の縞の間隔 */
export const FURROW_SPACING_M = 4;

/** 普請中：縄張りの内側への余白・足場の格子の間隔 */
export const CONSTRUCTION_INSET_M = 6;
export const SCAFFOLD_SPACING_M = 6;

/** 手元の地図の操作（M3）：ホイール1画素あたりのズームの倍率、ボタン1回のズーム、クリックとみなす移動の上限（CSS 画素） */
export const WHEEL_ZOOM_PER_PX = 1.0018;
export const BUTTON_ZOOM = 1.6;
export const CLICK_SLOP_PX = 4;
/** 性能の自動調整（§9）：この fps を下回る状態が SUSTAIN_MS 続いたら軽量モード */
export const LITE_FPS = 45;
export const LITE_SUSTAIN_MS = 1000;
/** 地形生成を待つ上限。超えたら抽象グリッドに戻る（不変条件29） */
export const TERRAIN_TIMEOUT_MS = 12000;

/** 地形模型（M4）：手に取ったときに、操作中の fps がこれを下回る状態が RELIEF_SUSTAIN_MS 続いたら模型を止める（§10.3） */
export const RELIEF_MIN_FPS = 45;
export const RELIEF_SUSTAIN_MS = 1000;
/** 模型の Canvas の一辺（CSS 画素） */
export const RELIEF_CANVAS_PX = 420;
/** ホイール1画素あたりのズームの倍率 */
export const RELIEF_WHEEL_PER_PX = 1.0022;
