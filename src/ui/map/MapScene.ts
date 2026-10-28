import Phaser from "phaser";
import { drawMapLayers, parcelAt, type Baked } from "./cartography/Layers";
import { drawProgress } from "./cartography/Ink";
import { clampView, defaultView, panBy, screenToWorld, zoomAt, type MapView } from "./cartography/lod";
import { composeMap, type MapComposition } from "./composeMap";
import { drawAbstractGrid } from "./drawMap";
import { LITE_FPS, LITE_SUSTAIN_MS } from "./mapConstants";
import { MapSnapshot } from "./MapSnapshot";
import type { MapViewModel } from "./MapViewModel";
import type { TerrainReady } from "./terrainClient";
import type { Point } from "./terrain/types";

// 領地図（SPEC_v3.4 §6・§7、AA-09：Phaser.CANVAS。WebGL・シェーダは使わない）。
// 描画専用：MapViewModel と地形を受け取り、Canvas のテクスチャに描くだけ。ゲームの状態は持たない。
// 地形があれば測量図（cartography/Layers.ts）、なければ抽象 10×10 グリッド（不変条件29）。ゲームの Canvas に直接描く。
// 手元（interactive）ではホイールのズームとドラッグのパン（L0〜L3）。机の上に置いたままのときは L1 の俯瞰の静止画（MapSnapshot）。
// 年に一度しか変わらないので、描いたらループを止める（AB-17）。動かしている間・描き込みの演出の間だけ毎フレーム描く。
// 操作中に 45fps を下回る状態が続いたら軽量モード（細部・一部の注記・重ねの演出を省く。§9）。

export const TILE_SIZE = 36;
export const MAP_BORDER = 18;
export const MAP_PIXELS = (size: number) => size * TILE_SIZE + MAP_BORDER * 2;
/** ゲームの Canvas の画素は表示（CSS 画素）の MAP_RESOLUTION 倍。ゲームは zoom 1/MAP_RESOLUTION で表示の大きさに縮める */
export const MAP_RESOLUTION = 2;
/** 描き込みの演出を済ませた建物（saveId:建物ID）。地図を開き直しても繰り返さない */
const inked = new Set<string>();

export interface MapSceneState {
  readonly lite: boolean;
  readonly widthM: number;
}

export class MapScene extends Phaser.Scene {
  private ready = false;
  private vm: MapViewModel | null = null;
  private terrain: TerrainReady | null = null;
  private comp: MapComposition | null = null;
  private baked: Baked[] = [];
  private view: MapView | null = null;
  private interactive = false;
  private reduced = false;
  private liteForced = false;
  private liteAuto = false;
  private hover: number | null = null;
  private selected: number | null = null;
  /** 描き込みの演出：建物ID → 始めた時刻 */
  private inking = new Map<number, number>();
  private dirty = true;
  private moving = 0;
  private slowMs = 0;
  private readonly snapshot = new MapSnapshot();
  private readonly sizePx: number;
  /** 軽量モード・表示の幅が変わったとき（パネルが data 属性に出す） */
  onState: ((s: MapSceneState) => void) | null = null;

  constructor(sizePx: number) {
    super("MapScene");
    this.sizePx = sizePx;
  }

  create(): void {
    // ゲームの Canvas に直接描く（MapPanel が clearBeforeRender: false で作る。表示物は置かない）。
    // テクスチャを経由すると、毎フレーム 792² の写しが要り、ソフトウェア描画の環境では 20ms を超えた（M3 の計測）
    this.ready = true;
    this.game.events.on(Phaser.Core.Events.POST_RENDER, () => {
      if (!this.dirty && this.inking.size === 0 && performance.now() - this.moving > 200) this.game.loop.sleep();
    });
    this.requestDraw();
  }

  get lite(): boolean {
    return this.liteForced || this.liteAuto;
  }

  setView(view: MapViewModel, terrain: TerrainReady | null): void {
    const terrainChanged = terrain !== this.terrain;
    this.vm = view;
    this.terrain = terrain;
    this.comp = terrain ? composeMap(view, terrain.data) : null;
    if (terrainChanged) {
      this.baked = terrain ? [...terrain.layers] : [];
      this.view = terrain ? defaultView(terrain.data.village.frame) : null;
      this.hover = null;
      this.selected = null;
    }
    // その年に完成した建物を一度だけ「外形 → 屋根 → 着彩」の順に描き込む（動きを減らす設定では即時）
    if (terrain) {
      const now = performance.now();
      for (const b of view.buildings) {
        const key = `${view.saveId}:${b.id}`;
        if (inked.has(key)) continue;
        inked.add(key);
        if (!this.reduced && b.builtTurn >= view.turn - 1) this.inking.set(b.id, now);
      }
    }
    this.requestDraw();
  }

  setInteractive(interactive: boolean): void {
    if (this.interactive === interactive) return;
    this.interactive = interactive;
    if (!interactive) this.hover = null;
    this.requestDraw();
  }

  setReduced(reduced: boolean): void {
    this.reduced = reduced;
    if (reduced && this.inking.size > 0) {
      this.inking.clear();
      this.requestDraw();
    }
  }

  setLowPower(lowPower: boolean): void {
    if (this.liteForced === lowPower) return;
    this.liteForced = lowPower;
    this.requestDraw();
  }

  get hasTerrain(): boolean {
    return this.comp !== null;
  }

  /** at は地図の上の位置（0..1） */
  zoom(factor: number, at: Point = [0.5, 0.5]): void {
    if (!this.view || !this.terrain) return;
    this.view = zoomAt(this.view, factor, at, this.terrain.data.worldM);
    this.touch();
  }

  /** 地図の大きさに対する割合で動かす */
  pan(dx: number, dy: number): void {
    if (!this.view || !this.terrain) return;
    this.view = panBy(this.view, dx, dy, this.terrain.data.worldM);
    this.touch();
  }

  resetView(): void {
    if (!this.terrain) return;
    this.view = defaultView(this.terrain.data.village.frame);
    this.touch();
  }

  /** 地図の上の位置（0..1）の区画（なければ null） */
  parcelAtScreen(at: Point): number | null {
    if (!this.view || !this.comp) return null;
    return parcelAt(this.comp, screenToWorld(this.view, at));
  }

  setHover(gridIndex: number | null): void {
    if (this.hover === gridIndex) return;
    this.hover = gridIndex;
    this.requestDraw();
  }

  setSelected(gridIndex: number | null): void {
    if (this.selected === gridIndex) return;
    this.selected = gridIndex;
    this.requestDraw();
  }

  private touch(): void {
    this.moving = performance.now();
    this.requestDraw();
  }

  private requestDraw(): void {
    this.dirty = true;
    this.game?.loop.wake();
  }

  override update(_time: number, delta: number): void {
    // 性能の自動調整：操作中のフレームの間隔だけを数える（止まっている間の間隔は数えない）
    const active = performance.now() - this.moving < 200;
    if (active && delta > 0 && delta < 250) {
      if (1000 / delta < LITE_FPS) this.slowMs += delta;
      else this.slowMs = Math.max(0, this.slowMs - delta * 0.5);
      if (!this.liteAuto && this.slowMs >= LITE_SUSTAIN_MS) {
        this.liteAuto = true;
        this.dirty = true;
      }
    }
    if (this.dirty || this.inking.size > 0) this.draw();
  }

  private draw(): void {
    const vm = this.vm;
    // Phaser.CANVAS なので 2D の文脈（AA-09）
    const ctx = this.game.context as CanvasRenderingContext2D | null;
    if (!this.ready || !vm || !ctx || typeof ctx.drawImage !== "function") return;
    this.dirty = false;
    const size = this.sizePx * MAP_RESOLUTION;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, size, size);
    const comp = this.comp;
    const terrain = this.terrain;
    if (comp && terrain && this.view) {
      const now = performance.now();
      const inking = new Map<number, number>();
      for (const [id, started] of this.inking) {
        const p = drawProgress(now - started, this.reduced);
        if (p >= 1) this.inking.delete(id);
        else inking.set(id, p);
      }
      const view = this.interactive ? this.view : defaultView(terrain.data.village.frame);
      const plain = !this.interactive && inking.size === 0;
      const still = plain ? this.snapshot.get({ vm, terrain: terrain.data, sizePx: size, lite: this.lite }, comp, this.baked) : null;
      if (still) {
        ctx.drawImage(still, 0, 0);
      } else {
        drawMapLayers(ctx, size, comp, terrain.data, this.baked, vm, {
          view: clampView(view, terrain.data.worldM),
          lite: this.lite,
          inking,
          hover: this.interactive ? this.hover : null,
          selected: this.interactive ? this.selected : null,
        });
      }
      this.onState?.({ lite: this.lite, widthM: view.widthM });
    } else {
      drawAbstractGrid(ctx, size, vm);
    }
    ctx.restore();
  }
}
