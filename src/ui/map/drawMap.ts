import { messages } from "../../i18n/messages";
import { categoryTint, palette } from "../theme";
import type { MapViewModel } from "./MapViewModel";

// 地形がないときの抽象グリッド：従来の 10×10 の略図（不変条件29 のフォールバック）。
// 測量図（地形があるとき）は cartography/Layers.ts が描く（M3）。

/** 抽象グリッド（地形が未完成・失敗のとき）。従来の 10×10 の略図 */
export const drawAbstractGrid = (ctx: CanvasRenderingContext2D, size: number, vm: MapViewModel): void => {
  const n = 10;
  const border = (size * 18) / 396;
  const tile = (size - border * 2) / n;
  ctx.save();
  ctx.fillStyle = palette.water;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = palette.paper;
  ctx.fillRect(border - 4, border - 4, size - (border - 4) * 2, size - (border - 4) * 2);
  const constructionKinds = new Map<number, (typeof vm.construction)[number]>();
  for (const w of vm.construction) for (const g of w.gridIndices) constructionKinds.set(g, w);
  const buildingAt = new Map(vm.buildings.map((b) => [b.gridIndex, b]));
  for (const p of vm.parcels) {
    const x = border + p.x * tile;
    const y = border + p.y * tile;
    ctx.globalAlpha = p.use === "empty" ? 0.45 : 0.7;
    ctx.fillStyle = palette.land;
    ctx.fillRect(x, y, tile, tile);
    ctx.globalAlpha = 1;
    if (p.use === "road") {
      ctx.fillStyle = palette.road;
      const w = tile * 0.28;
      ctx.fillRect(x, y + tile / 2 - w / 2, tile, w);
      ctx.fillRect(x + tile / 2 - w / 2, y, w, tile);
    }
    const b = buildingAt.get(p.gridIndex);
    const w = constructionKinds.get(p.gridIndex);
    const item = b ?? w;
    if (item && (p.use === "building" || p.use === "construction")) {
      const done = p.use === "building";
      ctx.globalAlpha = done ? 1 : 0.35;
      ctx.fillStyle = categoryTint[item.category];
      ctx.fillRect(x + 4, y + 4, tile - 8, tile - 8);
      ctx.globalAlpha = done ? 0.85 : 0.5;
      ctx.strokeStyle = palette.ink;
      ctx.lineWidth = done ? 1.5 : 1;
      ctx.strokeRect(x + 4, y + 4, tile - 8, tile - 8);
      ctx.globalAlpha = done ? 0.9 : 0.45;
      ctx.fillStyle = palette.ink;
      ctx.font = `${Math.round(tile * 0.5)}px serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(messages.tileGlyphs[item.kind], x + tile / 2, y + tile / 2);
      ctx.globalAlpha = 1;
    }
  }
  ctx.strokeStyle = palette.ink;
  ctx.globalAlpha = 0.18;
  ctx.lineWidth = 1;
  for (let i = 0; i <= n; i++) {
    const q = border + i * tile;
    ctx.beginPath();
    ctx.moveTo(border, q);
    ctx.lineTo(border + n * tile, q);
    ctx.moveTo(q, border);
    ctx.lineTo(q, border + n * tile);
    ctx.stroke();
  }
  ctx.restore();
};
