// 地形 v2 の型（SPEC_v3.4 §11.1）。座標は地図の左上を原点とするメートル（x：右、y：下）。

export type Point = readonly [number, number];
export type Polyline = readonly Point[];
/** 閉じた多角形（最後の点から最初の点へ戻る辺を含む） */
export type Polygon = readonly Point[];

export interface River {
  /** 上流 → 下流 */
  readonly points: Polyline;
  /** 各点の川幅（m。集水域から） */
  readonly widths: readonly number[];
  /** 各点の水面の標高（m。窪地を埋めた水面。下流へ単調に下がる） */
  readonly levels: readonly number[];
  readonly name: string;
  readonly main: boolean;
  /** 下流端の集水域（km²） */
  readonly areaKm2: number;
}

export type ToponymKind = "region" | "river" | "mountain" | "hill" | "lake" | "wetland" | "pass" | "destination" | "district";

export interface Toponym {
  readonly kind: ToponymKind;
  readonly name: string;
  /** 注記を置く位置（地図座標） */
  readonly anchor: Point;
}

export interface Parcel {
  /** 0..99（MapState の tiles[y][x] と gridIndex = y × 10 + x で対応） */
  readonly gridIndex: number;
  readonly polygon: Polygon;
  /** 小字（区画名） */
  readonly name: string;
  /** 区画内の平均傾斜（度）。ロジックには影響しない */
  readonly slope: number;
}

/**
 * 村域の座標系。区画 (x, y) の中心は center + a·axisA + b·axisB、
 * a = (x + 0.5)·60 − 300（川と平行・下流向き）、b = 300 − (y + 0.5)·60（y = 0 が丘側、y = 9 が川側）。
 */
export interface VillageFrame {
  readonly center: Point;
  readonly axisA: Point;
  readonly axisB: Point;
  readonly halfM: number;
}

export type ArmEnd = "upstream" | "downstream" | "hillside" | "riverside";

export interface Highway {
  /** 十字の本通りの一端 → 地図の縁 */
  readonly points: Polyline;
  readonly from: ArmEnd;
  /** 街道の先の注記（「◯◯方面」の◯◯） */
  readonly destination: string;
}

/** Uint16 のハイトマップ。標高(m) = offsetM + 値 × stepM */
export interface HeightField {
  readonly size: number;
  readonly heightmap: Uint16Array;
  readonly offsetM: number;
  readonly stepM: number;
}

export interface TerrainDataV2 {
  readonly version: 2;
  /** hash(saveId, "terrain") */
  readonly seed: number;
  /** 採用した試行の番号（0 始まり） */
  readonly attempt: number;
  readonly worldM: number;
  /** 地図全体（1024²） */
  readonly surround: HeightField;
  /** 村域の段丘面（2048²、frame の a,b ∈ [−windowHalfM, windowHalfM]） */
  readonly village: HeightField & {
    readonly frame: VillageFrame;
    readonly windowHalfM: number;
    /** 法線。上位8bit = nx、下位8bit = ny（各 [−1,1] を 0..255 に） */
    readonly normal: Uint16Array;
  };
  readonly rivers: readonly River[];
  readonly lakes: readonly Polygon[];
  readonly wetlands: readonly Polygon[];
  /** 旧河道（湿地として描く。§3.3） */
  readonly oldChannels: readonly Polygon[];
  /** 地質（surround と同じ格子。Geology.ts の GEOLOGY_CLASS） */
  readonly geology: Uint8Array;
  /** 植生（surround と同じ格子。Vegetation.ts の VEGETATION_CLASS） */
  readonly vegetation: Uint8Array;
  readonly highway: Highway;
  /** 渡河点（街道と川の交わる所） */
  readonly fords: readonly Point[];
  readonly parcels: readonly Parcel[];
  readonly toponyms: readonly Toponym[];
}

export interface TerrainTimings {
  readonly [stage: string]: number;
}

/** 試行を捨てた理由。river：格子の上で川が村域にかかる、riverShape：蛇行を付けた後の形が村域に近い、noMainRiver：地図の縁へ出る川がない */
export type AttemptFailure = "layout" | "precheck" | "river" | "riverShape" | "noMainRiver" | "lake" | "slope" | "highway";

export type TerrainResult =
  | {
      readonly ok: true;
      readonly data: TerrainDataV2;
      readonly attempts: number;
      readonly failures: readonly AttemptFailure[];
      readonly timings: TerrainTimings;
    }
  | {
      readonly ok: false;
      readonly attempts: number;
      readonly failures: readonly AttemptFailure[];
      readonly timings: TerrainTimings;
    };
