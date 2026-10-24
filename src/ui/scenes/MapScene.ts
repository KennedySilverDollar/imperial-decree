import Phaser from "phaser";
import type { MapState, Tile } from "../../domain/Map";
import { palette } from "../theme";

// 領地図（SPEC §8, §12.7）。10×10 の抽象グリッドを図形だけで描く（画像アセットなし）。
// 描画専用：MapState を受け取って描くだけで、状態は持たない。

export const TILE_SIZE = 36;
export const MAP_BORDER = 18;
export const MAP_PIXELS = (size: number) => size * TILE_SIZE + MAP_BORDER * 2;

const color = (hex: string): number => Number.parseInt(hex.slice(1), 16);

export class MapScene extends Phaser.Scene {
  private graphics: Phaser.GameObjects.Graphics | null = null;
  private pending: MapState | null = null;

  constructor() {
    super("MapScene");
  }

  create(): void {
    this.graphics = this.add.graphics();
    if (this.pending) this.draw(this.pending);
  }

  setMap(map: MapState): void {
    this.pending = map;
    if (this.graphics) this.draw(map);
  }

  private draw(map: MapState): void {
    const g = this.graphics;
    if (!g) return;
    g.clear();
    const full = MAP_PIXELS(map.size);

    // 水辺の縁取りと羊皮紙の地
    g.fillStyle(color(palette.water), 1);
    g.fillRect(0, 0, full, full);
    g.fillStyle(color(palette.paper), 1);
    g.fillRect(MAP_BORDER - 4, MAP_BORDER - 4, full - (MAP_BORDER - 4) * 2, full - (MAP_BORDER - 4) * 2);

    for (const row of map.tiles) for (const tile of row) this.drawTile(g, tile);

    // 罫線
    g.lineStyle(1, color(palette.ink), 0.18);
    for (let i = 0; i <= map.size; i++) {
      const p = MAP_BORDER + i * TILE_SIZE;
      g.lineBetween(MAP_BORDER, p, MAP_BORDER + map.size * TILE_SIZE, p);
      g.lineBetween(p, MAP_BORDER, p, MAP_BORDER + map.size * TILE_SIZE);
    }
  }

  private drawTile(g: Phaser.GameObjects.Graphics, tile: Tile): void {
    const x = MAP_BORDER + tile.x * TILE_SIZE;
    const y = MAP_BORDER + tile.y * TILE_SIZE;
    const cx = x + TILE_SIZE / 2;
    const cy = y + TILE_SIZE / 2;
    const ink = color(palette.ink);

    g.fillStyle(color(palette.land), tile.kind === "empty" ? 0.45 : 0.7);
    g.fillRect(x, y, TILE_SIZE, TILE_SIZE);

    switch (tile.kind) {
      case "road":
        g.fillStyle(color(palette.road), 1);
        g.fillRect(x, cy - 5, TILE_SIZE, 10);
        g.fillRect(cx - 5, y, 10, TILE_SIZE);
        break;
      case "residential":
        g.fillStyle(color(palette.paper), 1);
        g.fillRect(cx - 9, cy - 2, 18, 12);
        g.fillStyle(ink, 0.85);
        g.fillTriangle(cx - 12, cy - 1, cx + 12, cy - 1, cx, cy - 12);
        g.lineStyle(1.5, ink, 0.85);
        g.strokeRect(cx - 9, cy - 2, 18, 12);
        break;
      case "market":
        g.fillStyle(color(palette.paper), 1);
        g.fillRect(cx - 12, cy - 3, 24, 13);
        g.fillStyle(ink, 0.75);
        for (let i = 0; i < 4; i++) g.fillRect(cx - 12 + i * 6, cy - 10, 3, 7);
        g.lineStyle(1.5, ink, 0.85);
        g.strokeRect(cx - 12, cy - 3, 24, 13);
        break;
      case "office":
        g.fillStyle(color(palette.paper), 1);
        g.fillRect(cx - 12, cy - 2, 24, 14);
        g.lineStyle(1.5, ink, 0.9);
        g.strokeRect(cx - 12, cy - 2, 24, 14);
        g.lineBetween(cx, cy - 2, cx, cy - 15);
        g.fillStyle(color(palette.vermilion), 1);
        g.fillTriangle(cx, cy - 15, cx + 11, cy - 11, cx, cy - 7);
        break;
      case "empty":
        break;
    }

    if (tile.cracked) {
      g.lineStyle(2, color(palette.warning), 1);
      g.beginPath();
      g.moveTo(x + 6, y + 6);
      g.lineTo(x + 13, y + 14);
      g.lineTo(x + 9, y + 19);
      g.lineTo(x + 17, y + 28);
      g.strokePath();
    }
  }
}
