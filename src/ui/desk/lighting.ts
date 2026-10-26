import { TABLETOP_SIZE } from "./deskConstants";
import { DESK_OBJECTS } from "./objects";

// 擬似照明と影（SPEC_v3.3 §3.4）。光源は2つ：ランプ（左奥・点光源）と窓（右上・画面外の平行光）。
// 影は「机からの高さ」と光源の向きから決める：高いほど遠くへずれ、ぼけ、薄くなる。
// box-shadow のずれは要素自身の座標（rotateZ の前）で効くので、机上の向きの分だけ逆に回して渡す。

export interface PointLight {
  readonly kind: "point";
  /** 机の単位。z は机からの高さ */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly strength: number;
}

export interface DirectionalLight {
  readonly kind: "directional";
  /** 光が来る向き（机の平面上、単位ベクトルでなくてよい） */
  readonly fromX: number;
  readonly fromY: number;
  /** 仰角（度） */
  readonly elevationDeg: number;
  readonly strength: number;
}

export type Light = PointLight | DirectionalLight;

const lampHome = DESK_OBJECTS.lamp.home;

/** ランプの火屋の高さ（机の単位） */
const LAMP_FLAME_HEIGHT = 520;

export const LAMP_LIGHT: PointLight = { kind: "point", x: lampHome.x + 40, y: lampHome.y + 60, z: LAMP_FLAME_HEIGHT, strength: 0.42 };
export const WINDOW_LIGHT: DirectionalLight = { kind: "directional", fromX: 1, fromY: -0.9, elevationDeg: 52, strength: 0.26 };
export const LIGHTS: readonly Light[] = [LAMP_LIGHT, WINDOW_LIGHT];

/** ランプの光の色（§3.5 #F2C48A）と、窓の光（天候連動は U4 以降。今は晴れの暖色の手前の中立色） */
export const LAMP_COLOR = "242 196 138";
export const WINDOW_COLOR = "226 230 228";
/** 影の色（机の暗部 #24180D よりさらに暗い焦げ茶） */
const SHADOW_COLOR = "16 9 3";

/** 影がずれる距離の上限（紙が浮いて見えすぎないように） */
const MAX_OFFSET = 70;

export interface ShadowLayer {
  readonly x: number;
  readonly y: number;
  readonly blur: number;
  readonly alpha: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** 机上の位置 (x, y)・高さ height の物が、1つの光源で落とす影（机の座標でのずれ） */
export const shadowLayer = (light: Light, x: number, y: number, height: number): ShadowLayer => {
  const h = Math.max(0, height);
  let ox: number;
  let oy: number;
  if (light.kind === "point") {
    // 光源から物を通って机に落ちる点（相似三角形）
    const k = h / Math.max(1, light.z - h);
    ox = (x - light.x) * k;
    oy = (y - light.y) * k;
  } else {
    const len = Math.hypot(light.fromX, light.fromY) || 1;
    const reach = h / Math.tan((light.elevationDeg * Math.PI) / 180);
    ox = (-light.fromX / len) * reach;
    oy = (-light.fromY / len) * reach;
  }
  const dist = Math.hypot(ox, oy);
  if (dist > MAX_OFFSET) {
    ox = (ox / dist) * MAX_OFFSET;
    oy = (oy / dist) * MAX_OFFSET;
  }
  return {
    x: ox,
    y: oy,
    blur: 2 + h * 1.1,
    alpha: light.strength * clamp(1 - h / 160, 0.45, 1),
  };
};

/** 机の座標のずれを、rotateZ(deg) された要素の座標に直す */
export const toLocal = (layer: ShadowLayer, rotateDeg: number): ShadowLayer => {
  const t = (-rotateDeg * Math.PI) / 180;
  return { ...layer, x: layer.x * Math.cos(t) - layer.y * Math.sin(t), y: layer.x * Math.sin(t) + layer.y * Math.cos(t) };
};

const fmt = (layer: ShadowLayer) =>
  `${layer.x.toFixed(1)}px ${layer.y.toFixed(1)}px ${layer.blur.toFixed(1)}px rgb(${SHADOW_COLOR} / ${(layer.alpha * 100).toFixed(1)}%)`;

/** 接地の影（どの高さでも紙の縁に少しだけ） */
const CONTACT: ShadowLayer = { x: 0, y: 1, blur: 2, alpha: 0.32 };

export interface ObjectShadow {
  /** box-shadow（紙） */
  readonly box: string;
  /** filter（小物の輪郭） */
  readonly drop: string;
}

/** 机上の物の影。2つの光源の影と接地の影を重ねる */
export const objectShadow = (x: number, y: number, height: number, rotateDeg: number, lights: readonly Light[] = LIGHTS): ObjectShadow => {
  const layers = [CONTACT, ...lights.map((light) => toLocal(shadowLayer(light, x, y, height), rotateDeg))];
  return {
    box: layers.map(fmt).join(", "),
    drop: layers.map((l) => `drop-shadow(${fmt(l)})`).join(" "),
  };
};

const pct = (v: number) => `${v.toFixed(1)}%`;

/** 天板の照明：ランプを中心にした放射グラデーション、窓からの薄い光、手前と縁の陰り */
export const tabletopLighting = (): string => {
  const lx = ((LAMP_LIGHT.x + TABLETOP_SIZE.width / 2) / TABLETOP_SIZE.width) * 100;
  const ly = ((LAMP_LIGHT.y + TABLETOP_SIZE.height / 2) / TABLETOP_SIZE.height) * 100;
  return [
    `radial-gradient(ellipse 34% 30% at ${pct(lx)} ${pct(ly)}, rgb(${LAMP_COLOR} / 26%), rgb(${LAMP_COLOR} / 8%) 55%, transparent 100%)`,
    `radial-gradient(ellipse 60% 50% at 100% 0%, rgb(${WINDOW_COLOR} / 7%), transparent 70%)`,
    `linear-gradient(to bottom, transparent 55%, rgb(36 24 13 / 55%) 100%)`,
    `radial-gradient(ellipse 70% 62% at 50% 42%, transparent 55%, rgb(36 24 13 / 72%) 100%)`,
  ].join(", ");
};

/** 書類にも掛かる照明の重ね（mix-blend-mode: soft-light）。中心はランプの映る点 */
export const lightingOverlay = (lampScreen: { readonly x: number; readonly y: number }, stage: { readonly width: number; readonly height: number }): string => {
  const x = (lampScreen.x / Math.max(1, stage.width)) * 100;
  const y = (lampScreen.y / Math.max(1, stage.height)) * 100;
  return [
    `radial-gradient(circle at ${pct(x)} ${pct(y)}, rgb(${LAMP_COLOR} / 45%), rgb(${LAMP_COLOR} / 10%) 45%, transparent 75%)`,
    `radial-gradient(ellipse at 100% 0%, rgb(${WINDOW_COLOR} / 18%), transparent 50%)`,
    `radial-gradient(ellipse at 50% 45%, transparent 50%, rgb(20 12 5 / 50%) 100%)`,
  ].join(", ");
};
