export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** 浮動小数の誤差（120×1.025=122.999…）で1人減らないよう、切り捨て前にわずかに補正する */
const FLOOR_EPSILON = 1e-9;
export const stableFloor = (value: number): number => Math.floor(value + FLOOR_EPSILON);
