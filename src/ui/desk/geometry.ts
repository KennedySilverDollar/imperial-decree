import { DESK_AREA, DESK_PERSPECTIVE_PX, DESK_TILT_DEG, FOCUS_GAP_PX, FOCUS_MARGIN_PX, TABLETOP_SIZE } from "./deskConstants";
import { DESK_OBJECTS, DESK_OBJECT_IDS, SIDE_BY_SIDE_READERS, type DeskObjectId, type HomePosition, type PickableId } from "./objects";

// 机の幾何（純粋関数）。全オブジェクトが同じ原点（机の中心の映る点）を変形の基準にするので、
// 1つのカメラから見た1枚の天板の上に並ぶ。手元へ取ると transform: none になり、その位置が「手元の置き場」になる。
//
// 各オブジェクトの変形（外から内へ）:
//   perspective → rotateX（机の傾き＋視差）→ scale（画面に収める）→ translate3d（机上の置き場・高さ）
//   → rotateZ（机上の向き）→ translate（手元の置き場から原点へ）

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface DeskFit {
  /** 机の単位 → 画面 px の縮尺 */
  readonly scale: number;
  /** 机の中心が映る点（ステージ内の px） */
  readonly originX: number;
  readonly originY: number;
}

export interface Slot {
  readonly left: number;
  readonly top: number;
}

const rad = (deg: number) => (deg * Math.PI) / 180;

/** 机の上の点（机の単位）が、原点からどれだけずれて映るか（px） */
export const project = (
  point: { readonly x: number; readonly y: number; readonly z?: number },
  scale: number,
  tiltDeg: number = DESK_TILT_DEG,
  perspective: number = DESK_PERSPECTIVE_PX,
): { readonly x: number; readonly y: number } => {
  const sx = point.x * scale;
  const sy = point.y * scale;
  const sz = (point.z ?? 0) * scale;
  const t = rad(tiltDeg);
  const y = sy * Math.cos(t) - sz * Math.sin(t);
  const z = sy * Math.sin(t) + sz * Math.cos(t);
  const f = perspective / (perspective - z);
  return { x: sx * f, y: y * f };
};

const projectedExtent = (scale: number) => {
  const halfW = DESK_AREA.width / 2;
  const halfH = DESK_AREA.height / 2;
  const far = project({ x: halfW, y: -halfH }, scale);
  const near = project({ x: halfW, y: halfH }, scale);
  return { top: far.y, bottom: near.y, halfWidth: Math.max(far.x, near.x) };
};

/** 書類の領域が画面（ステージ）に収まる最大の縮尺と、そのときの原点 */
export const fitDesk = (stage: Size, fill = 0.98): DeskFit => {
  let lo = 0.05;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const e = projectedExtent(mid);
    const fits = e.halfWidth * 2 <= stage.width * fill && e.bottom - e.top <= stage.height * fill;
    if (fits) lo = mid;
    else hi = mid;
  }
  const e = projectedExtent(lo);
  return { scale: lo, originX: stage.width / 2, originY: stage.height / 2 - (e.top + e.bottom) / 2 };
};

/**
 * 手元の置き場。並べるもの（勅令用紙と判子、並べ読みの地図と書類）は左右に並べて中央に寄せる。
 * 俯瞰の書類もこの置き場を基準に変形するので、手に取ると変形が外れてここに来る。
 */
export const focusSlots = (
  stageWidth: number,
  focused: PickableId | null,
  sideBySide: boolean,
): Readonly<Record<DeskObjectId, Slot>> => {
  const centered = (width: number): number => Math.max(FOCUS_MARGIN_PX, (stageWidth - width) / 2);
  const pair = (a: DeskObjectId, b: DeskObjectId, bTop = FOCUS_MARGIN_PX): Record<string, Slot> => {
    const wa = DESK_OBJECTS[a].width;
    const wb = DESK_OBJECTS[b].width;
    const left = centered(wa + FOCUS_GAP_PX + wb);
    return { [a]: { left, top: FOCUS_MARGIN_PX }, [b]: { left: left + wa + FOCUS_GAP_PX, top: bTop } };
  };
  const slots = Object.fromEntries(
    DESK_OBJECT_IDS.map((id) => [id, { left: centered(DESK_OBJECTS[id].width), top: FOCUS_MARGIN_PX }]),
  ) as Record<DeskObjectId, Slot>;
  // 判子は勅令用紙の右に、少し下げて置く
  Object.assign(slots, pair("decree", "stamp", FOCUS_MARGIN_PX + 96));
  if (sideBySide && focused !== null && SIDE_BY_SIDE_READERS.includes(focused)) Object.assign(slots, pair("map", focused));
  return slots;
};

const n = (value: number) => Number(value.toFixed(3));

/** 俯瞰での変形。視差（--parallax-x/y）と持ち上げ（--lift）は CSS 変数で後から足す */
export const overviewTransform = (
  slot: Slot,
  width: number,
  home: HomePosition,
  fit: DeskFit,
): { readonly transform: string; readonly transformOrigin: string } => {
  const dx = slot.left + width / 2 - fit.originX;
  const dy = slot.top - fit.originY;
  return {
    transform: [
      `perspective(${DESK_PERSPECTIVE_PX}px)`,
      `rotateX(calc(${DESK_TILT_DEG}deg + var(--parallax-x, 0deg)))`,
      `rotateY(var(--parallax-y, 0deg))`,
      `scale(${n(fit.scale)})`,
      `translate3d(${n(home.x)}px, ${n(home.y)}px, calc(${n(home.z)}px + var(--lift, 0px)))`,
      `rotateZ(${n(home.rotate)}deg)`,
      `translate(${n(-dx)}px, ${n(-dy)}px)`,
    ].join(" "),
    transformOrigin: `${n(fit.originX - slot.left)}px ${n(fit.originY - slot.top)}px`,
  };
};

/** 天板（書類の領域より広い板）の置き場と変形 */
export const tabletopStyle = (fit: DeskFit) => ({
  left: n(fit.originX - TABLETOP_SIZE.width / 2),
  top: n(fit.originY - TABLETOP_SIZE.height / 2),
  width: TABLETOP_SIZE.width,
  height: TABLETOP_SIZE.height,
  transform: [
    `perspective(${DESK_PERSPECTIVE_PX}px)`,
    `rotateX(calc(${DESK_TILT_DEG}deg + var(--parallax-x, 0deg)))`,
    `rotateY(var(--parallax-y, 0deg))`,
    `scale(${n(fit.scale)})`,
  ].join(" "),
});

/** 机上の点が映るステージ内の位置（照明の重ね合わせの中心などに使う） */
export const screenPoint = (point: { readonly x: number; readonly y: number; readonly z?: number }, fit: DeskFit) => {
  const p = project(point, fit.scale);
  return { x: fit.originX + p.x, y: fit.originY + p.y };
};
