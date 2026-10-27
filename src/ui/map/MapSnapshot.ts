import { MAP_PX } from "./mapConstants";

// 俯瞰用の静止画（SPEC_v3.3 §2.2「地図：俯瞰時は静止画スナップショット」）。
// 手元の地図は Phaser のライブの Canvas だが、机に置いてあるときは測量図を縮めた画像を見せるだけにする
// （3D の変形の下で動く Canvas を合成し続けない）。Phaser は CANVAS 描画（DECISIONS AA-09）なので、
// 画像は常に Canvas 2D で作る（WebGL からの読み出しはしない＝WebGL が無くても同じ画像になる）。

/** 測量図（MAP_PX 四方）を size 四方に縮めて target に描く。描けなければ false */
export const drawSnapshot = (source: CanvasImageSource, target: HTMLCanvasElement, size: number): boolean => {
  if (target.width !== size) target.width = size;
  if (target.height !== size) target.height = size;
  const ctx = target.getContext("2d");
  if (!ctx) return false;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  // 一度に 1/2.7 まで縮めると細い線がちらつくので、半分ずつ縮める
  let current: CanvasImageSource = source;
  let currentSize = MAP_PX;
  while (currentSize / 2 > size) {
    const half = document.createElement("canvas");
    half.width = Math.round(currentSize / 2);
    half.height = Math.round(currentSize / 2);
    const h = half.getContext("2d");
    if (!h) break;
    h.imageSmoothingQuality = "high";
    h.drawImage(current, 0, 0, half.width, half.height);
    current = half;
    currentSize = half.width;
  }
  // 描き込みの演出が縮めた変形を残していても、ここでは原寸で描く
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(current, 0, 0, size, size);
  return true;
};
