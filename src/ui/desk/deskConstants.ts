// 執務机の表現上の定数（SPEC_v3.3 §2〜§4・§9）。ゲームのバランス値ではないので domain/constants.ts には置かない。
// 長さの単位は「机の単位」＝ 手元で正対させたときの CSS px。

/** 遠近（SPEC_v3.3 §2.2「perspective: 1600px 前後」） */
export const DESK_PERSPECTIVE_PX = 1600;
/** 机の傾き（§3.1「傾き約 40°」） */
export const DESK_TILT_DEG = 40;
/** マウス位置に応じた視差の最大角（§3.1「±1.5°以内」） */
export const PARALLAX_MAX_DEG = 1.5;

/** 書類を置く領域（机の中心を原点、y は手前が正） */
export const DESK_AREA = { width: 2320, height: 1420 } as const;
/** 天板は書類の領域より広く、画面の外まで続く */
export const TABLETOP_SIZE = { width: 4200, height: 2900 } as const;

/** 俯瞰でホバーしたときに持ち上がる高さ（机の単位） */
export const HOVER_LIFT = 16;

/** 手元へ引き寄せる／置く時間（§4.1「0.35 秒」） */
export const FOCUS_TRANSITION_MS = 350;
/** 「動きを減らす」での置き換え（移動はせず、短いフェード。§8.2） */
export const REDUCED_FADE_MS = 120;
/** 押印の所作のうち、判が紙に当たる時点（desk.css の seal-press の 84%。打撃音を合わせる） */
export const STAMP_HIT_AT = 0.84;
/** 「動きを減らす」での押印の待ち時間（通常は domain/constants の STAMP_ANIMATION_MS） */
export const REDUCED_STAMP_MS = 200;

/** 手元に置いた書類と画面の縁の間 */
export const FOCUS_MARGIN_PX = 20;
/** 手元の書類の下に空けておく、「置き方」の案内の分 */
export const FOCUS_HINT_SPACE_PX = 26;
/** 並べた書類（勅令用紙と判子、並べ読み）の間 */
export const FOCUS_GAP_PX = 24;

/** 画面上部の帯（題字・年・設定）の高さ */
export const HEADER_HEIGHT_PX = 52;

/** 性能の自動調整（§9「一定時間 45fps を下回ったら」） */
export const LOW_FPS_THRESHOLD = 45;
export const LOW_FPS_WINDOW_MS = 3000;
/** FPS の平均を取る区間 */
export const FPS_SAMPLE_WINDOW_MS = 1000;

/** 手元の文字サイズ（§9「3段階」） */
export const TEXT_SCALES = { normal: 1, large: 1.15, xlarge: 1.3 } as const;
