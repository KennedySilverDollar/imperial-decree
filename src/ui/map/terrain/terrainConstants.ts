// 地形生成 v2（SPEC_v3.4 §3）の表示用の定数。ゲームのバランス値ではないので domain/constants.ts には置かない
// （AB-11 の deskConstants と同じ扱い）。長さはすべてメートル、角度は度。

/** 地図全体の一辺（§2.1） */
export const WORLD_M = 4000;
/** 1区画（論理セル）の一辺（BB-01） */
export const PARCEL_M = 60;
/** 論理グリッドの一辺のセル数（domain の GRID_SIZE と同じ値。domain の定数は地形から参照しない） */
export const VILLAGE_CELLS = 10;
/** 村域の半幅（600m 四方） */
export const VILLAGE_HALF_M = (PARCEL_M * VILLAGE_CELLS) / 2;
/** 平らな段丘面を村域の外へ延ばす幅（BB-23。区画の傾斜が縁の斜面にかからないように） */
export const PLANE_EXT_M = 60;
export const PLANE_HALF_M = VILLAGE_HALF_M + PLANE_EXT_M;
/** 段丘面の外側で地形に馴染ませる帯 */
export const PLANE_BLEND_M = 120;

/** 解像度（BB-03：全域 1024²＋村域 2048²） */
export const SURROUND_N = 1024;
export const VILLAGE_N = 2048;
/** 村域の高解像度ハイトマップが覆う範囲の半幅（段丘面全体） */
export const VILLAGE_WINDOW_HALF_M = PLANE_HALF_M;
/** Uint16 で持つ標高の刻み */
export const SURROUND_HEIGHT_STEP_M = 0.02;
export const VILLAGE_HEIGHT_STEP_M = 0.01;

/** 再試行の上限（§3.2）。超えたら生成は失敗とし、表示は抽象グリッドに戻る（不変条件29） */
export const MAX_TERRAIN_ATTEMPTS = 12;
/** 再試行前の粗い下見の解像度（侵食なし）。重い本生成を無駄にしないため */
export const PRECHECK_N = 256;
/** 下見では川・湖と村域の間にこれだけの余白を求める（侵食で流路が動いても本生成で村域にかからないように） */
export const PRECHECK_MARGIN_M = 60;

/** 区画の傾斜の上限（§3.2）と測り方（BB-13：区画内の平均。約15m の基線の差分） */
export const PARCEL_SLOPE_MAX_DEG = 5;
export const SLOPE_SAMPLE_STEP_M = 5;
export const SLOPE_BASELINE_M = 7.5;

/** 川＝集水域 1km² 以上（BB-14） */
export const RIVER_MIN_KM2 = 1;
/** 川幅 = RIVER_WIDTH_K × √集水域(km²) + RIVER_WIDTH_BASE_M */
export const RIVER_WIDTH_K = 6;
export const RIVER_WIDTH_BASE_M = 2;
/** 川と村域の間に空けるべき最小の距離（川幅の半分に加える） */
export const RIVER_CLEARANCE_M = 10;
/** 湖沼：窪地の深さと面積の下限 */
export const LAKE_MIN_DEPTH_M = 1.5;
export const LAKE_MIN_AREA_M2 = 30000;
/** 湖として描く数の上限（大きい順。残りの浅い窪地は埋まった平地として扱う） */
export const LAKE_MAX_COUNT = 3;
/** 湖沼・湿地と村域の間に空けるべき最小の距離 */
export const WATER_CLEARANCE_M = 5;

/** 地形の骨格（BaseTerrain） */
export const TERRAIN = {
  /** 川の縦断勾配（下流へ） */
  riverGradient: 0.025,
  riverBaseM: 120,
  /** 蛇行（大きな曲がり）の振幅・波長 */
  meanderAmp1: [80, 260],
  meanderLen1: [1400, 2600],
  meanderAmp2: [20, 70],
  meanderLen2: [500, 900],
  /** 村の前後で蛇行を消す範囲（川が村域の一辺に沿う） */
  straightNearM: 450,
  straightFarM: 1200,
  /** 村域中心の川の中心線からの距離 */
  villageDistM: [620, 740],
  /** 村域中心の下流方向の位置（地図中心から） */
  villageAlongM: [-700, 700],
  /** 村域の向きの川に対するずれ（rad） */
  villageRotRad: 0.12,
  /** 段丘面の川へ向かう傾き（川と平行な向きは川の縦断勾配に従う） */
  tiltTowardRiverDeg: [1.2, 2.4],
  /** 丘の裾の小川：半幅・深さ・位置のゆらぎ */
  toeStreamHalfWidthM: 35,
  toeStreamDepthM: 2.5,
  toeStreamWobbleM: 30,
  /** 段丘面の外周のゆらぎ（四角く見えないように） */
  planeEdgeWobbleM: 30,
  /** 段丘面の微起伏の振幅 */
  microReliefM: [0.03, 0.08],
  /** 谷の断面：氾濫原の半幅・崖線（段丘面の川側の縁）・段丘面の奥の余白・丘の傾き */
  floodplainHalfM: 60,
  scarpTopM: 150,
  scarpHeightM: 10,
  benchBackM: 80,
  hillSlope: 0.15,
  farBankRiseM: 6,
  farBankWidthM: 220,
  farBankSlope: 0.06,
  /** 山並み（丘の始まりからさらに奥） */
  ridgeAfterHillM: 300,
  ridgeRiseM: 1000,
  ridgeWaveM: 900,
  ridgeAmpM: 150,
  /** 広域の起伏 */
  lowFreqAmpM: 7,
  highFreqAmpM: 2,
  /** 村域が地図の縁から離れているべき距離 */
  edgeKeepoutM: 900,
} as const;

/** 侵食（Erosion） */
export const EROSION = {
  /** 粒子数 = セル数 × この値（1024² で約12万） */
  particlesPerCell: 0.114,
  life: 30,
  inertia: 0.05,
  capacity: 4,
  minCapacity: 0.01,
  deposit: 0.3,
  erode: 0.3,
  evaporate: 0.01,
  gravity: 4,
  thermalIterations: 3,
  thermalTalusDeg: 35,
  thermalRate: 0.2,
} as const;

/** 水文（Hydrology） */
export const HYDROLOGY = {
  /** 線の簡略化の許容誤差（セル単位） */
  simplifyCells: 0.6,
  /** 蛇行の付与：川幅に対する振幅・波長、平坦とみなす勾配 */
  meanderAmpPerWidth: 1.2,
  meanderAmpMaxM: 35,
  meanderWavePerWidth: 11,
  meanderFlatGradient: 0.03,
  meanderResampleM: 15,
  /** 蛇行・旧河道が村域へ近づいてよい距離 */
  meanderVillageKeepM: 60,
  /** 旧河道：数・半径（川幅の倍数）・村域からの距離 */
  oldChannelCount: [1, 2],
  oldChannelRadiusPerWidth: [3, 5],
  oldChannelMinRadiusM: 45,
  oldChannelVillageKeepM: 200,
  oldChannelEdgeKeepM: 150,
  /** 氾濫原：川からの距離と、最寄りの川面からの高さ */
  floodplainMaxM: 260,
  floodplainRelM: 2,
  /** 河原（礫）：川岸から */
  gravelBankM: 8,
} as const;

/** 街道（Highway） */
export const HIGHWAY = {
  gridN: 256,
  slopeCost: 40,
  riverCost: 25,
  /** 村域に近づけない余白 */
  villageKeepM: 15,
  /** 行き先（地図の縁）の許容幅 */
  goalSpreadM: 500,
} as const;

/** 植生の分類の目安（Vegetation） */
export const VEGETATION = {
  coniferAboveM: 150,
  broadleafWaterM: 450,
  wetlandWaterM: 60,
  scrubSlope: 0.3,
  patchNoiseScaleM: 380,
} as const;

/** 地質の分類の目安（Geology） */
export const GEOLOGY = {
  bedrockSlope: 0.8,
  bedrockHighM: 250,
  bedrockHighSlope: 0.5,
} as const;

/** 地名（Toponyms）の数 */
export const TOPONYM_COUNTS = {
  tributaries: 4,
  mountains: 3,
  hills: 2,
  lakes: 3,
  wetlands: 2,
  districts: 9,
} as const;
/** 山・丘として拾う頂の最小間隔 */
export const PEAK_SEPARATION_M = 700;
/** 村より高いと「山」と呼ぶ高さ（未満は「丘」） */
export const MOUNTAIN_ABOVE_VILLAGE_M = 80;
/** 街道の最高点が出発点よりこれだけ高ければ「峠」と呼ぶ */
export const PASS_RISE_M = 30;
