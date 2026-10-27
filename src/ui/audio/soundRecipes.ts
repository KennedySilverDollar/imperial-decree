// 効果音の作り方（SPEC_v3.3 §8.1）。音源ファイルは使わず、Web Audio の雑音と音程の組み合わせでその場で合成する（＝自作。docs/ASSETS.md）。
// ここは数値だけのデータ（純粋）。鳴らすのは AudioService。音量は控えめ（§8.1「既定は控えめ」）を前提にした相対値。

export type SoundId =
  | "pickUp"
  | "putDown"
  | "newspaper"
  | "pageTurn"
  | "waxCrack"
  | "brush"
  | "sticky"
  | "stamp"
  | "pen"
  | "footsteps"
  | "delivered";

/** 雑音を帯域で絞った音（紙の擦れ・筆・ペン先・雨など） */
export interface NoiseLayer {
  readonly kind: "noise";
  readonly filter: "lowpass" | "highpass" | "bandpass";
  readonly frequency: number;
  readonly q: number;
  /** 立ち上がり・減衰（秒） */
  readonly attack: number;
  readonly decay: number;
  readonly gain: number;
  /** 鳴り始めのずれ（秒） */
  readonly delay?: number;
}

/** 音程のある音（判子の打撃・足音の低い響き） */
export interface ToneLayer {
  readonly kind: "tone";
  readonly wave: OscillatorType;
  readonly frequency: number;
  /** 終わりの音程（打撃は下がる） */
  readonly endFrequency: number;
  readonly attack: number;
  readonly decay: number;
  readonly gain: number;
  readonly delay?: number;
}

export type SoundLayer = NoiseLayer | ToneLayer;

export interface SoundRecipe {
  /** §8.1 のどの場面か（一覧との対応の確認用） */
  readonly scene: string;
  readonly layers: readonly SoundLayer[];
  /** 続けて鳴らすときの最短の間（秒）。筆記音のように入力1文字ごとに来るものを間引く */
  readonly minInterval?: number;
}

const paper = (frequency: number, decay: number, gain: number, delay = 0): NoiseLayer => ({
  kind: "noise",
  filter: "bandpass",
  frequency,
  q: 0.8,
  attack: 0.01,
  decay,
  gain,
  delay,
});

export const SOUND_RECIPES: Readonly<Record<SoundId, SoundRecipe>> = {
  pickUp: { scene: "書類を手に取る", layers: [paper(2600, 0.16, 0.5), paper(900, 0.1, 0.2, 0.03)] },
  putDown: { scene: "書類を置く", layers: [paper(1800, 0.12, 0.4), { kind: "noise", filter: "lowpass", frequency: 260, q: 0.7, attack: 0.002, decay: 0.08, gain: 0.35, delay: 0.06 }] },
  newspaper: { scene: "新聞を広げる", layers: [paper(1400, 0.35, 0.6), paper(3200, 0.25, 0.35, 0.08), paper(800, 0.2, 0.25, 0.18)] },
  pageTurn: { scene: "新聞・書類をめくる", layers: [paper(2200, 0.22, 0.45), paper(4200, 0.1, 0.2, 0.05)] },
  waxCrack: {
    scene: "封蝋を割る",
    layers: [
      { kind: "noise", filter: "highpass", frequency: 3000, q: 0.7, attack: 0.001, decay: 0.03, gain: 0.7 },
      { kind: "noise", filter: "bandpass", frequency: 1500, q: 2, attack: 0.001, decay: 0.05, gain: 0.4, delay: 0.035 },
    ],
  },
  brush: { scene: "勅令の筆記", layers: [{ kind: "noise", filter: "bandpass", frequency: 1100, q: 1.4, attack: 0.02, decay: 0.12, gain: 0.18 }], minInterval: 0.09 },
  sticky: { scene: "付箋を貼る", layers: [paper(3600, 0.06, 0.35), { kind: "noise", filter: "lowpass", frequency: 500, q: 0.7, attack: 0.002, decay: 0.04, gain: 0.2, delay: 0.04 }] },
  stamp: {
    scene: "判子",
    layers: [
      { kind: "tone", wave: "sine", frequency: 120, endFrequency: 48, attack: 0.003, decay: 0.32, gain: 0.9 },
      { kind: "noise", filter: "lowpass", frequency: 420, q: 0.8, attack: 0.002, decay: 0.12, gain: 0.5 },
      { kind: "tone", wave: "triangle", frequency: 220, endFrequency: 180, attack: 0.02, decay: 0.6, gain: 0.08, delay: 0.05 },
    ],
  },
  pen: { scene: "地図の描き込み", layers: [{ kind: "noise", filter: "bandpass", frequency: 4200, q: 3, attack: 0.03, decay: 0.18, gain: 0.16 }], minInterval: 0.14 },
  footsteps: {
    scene: "配達（扉の向こうの足音）",
    layers: [0, 0.32, 0.64].map(
      (delay): ToneLayer => ({ kind: "tone", wave: "sine", frequency: 85, endFrequency: 55, attack: 0.005, decay: 0.12, gain: 0.35, delay }),
    ),
  },
  delivered: { scene: "配達（書類が置かれる）", layers: [0, 0.2, 0.4].map((delay) => paper(1500, 0.14, 0.4, delay)) },
};

/** 環境音（§8.1「ランプの微かな音、窓の外の天候（雨、風）。小さく常時」） */
export interface AmbienceRecipe {
  readonly lamp: NoiseLayer;
  readonly rain: NoiseLayer;
  readonly wind: NoiseLayer;
}

export const AMBIENCE: AmbienceRecipe = {
  lamp: { kind: "noise", filter: "lowpass", frequency: 180, q: 0.5, attack: 1.5, decay: 0, gain: 0.25 },
  rain: { kind: "noise", filter: "bandpass", frequency: 1800, q: 0.4, attack: 2, decay: 0, gain: 0.45 },
  wind: { kind: "noise", filter: "lowpass", frequency: 420, q: 0.6, attack: 2, decay: 0, gain: 0.3 },
};

/** 音量（0..1）：主音量・効果音・環境音。既定は控えめ（§8.1） */
export interface Volumes {
  readonly master: number;
  readonly sfx: number;
  readonly ambient: number;
}

export const DEFAULT_VOLUMES: Volumes = { master: 0.5, sfx: 0.6, ambient: 0.3 };

/** 実際に掛かる音量（主音量×系統） */
export const effectiveGain = (volumes: Volumes, bus: "sfx" | "ambient"): number => {
  const clamp = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
  return clamp(volumes.master) * clamp(volumes[bus]);
};
