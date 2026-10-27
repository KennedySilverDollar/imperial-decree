import Phaser from "phaser";
import { hatchSegments, type Point } from "./geometry2d";
import { MAP_PX, MAP_VIEW, MAP_ZOOM_LEVELS } from "./mapConstants";

// 手元の測量図（SPEC_v3.3 §5.6）。描き終えた測量図（Canvas）をテクスチャとして貼り、カメラで拡大・移動するだけ。
// 描画の中身は持たない（SurveyRenderer が描いた Canvas を見せる）。状態は書き換えない。
// ホイールで3段階の拡大、ドラッグで移動、区画にかざす・押すと呼び出し元へ知らせる（区画の判定は呼び出し元）。
// 静止しているときはループを止め（DECISIONS AB-17）、動かしたときだけ1フレーム描く。

export interface MapSceneEvents {
  /** かざした地図上の点（地図の画素）と、画面上の位置（地図の枠の左上から CSS px）。外れたら null */
  readonly onHover: (world: Point | null, screen: Point) => void;
  /** 押した（ドラッグしなかった）地図上の点 */
  readonly onSelect: (world: Point) => void;
  readonly onZoom: (level: number) => void;
  /** 1フレーム描きたい（止めたループを起こす） */
  readonly onWake: () => void;
}

const TEXTURE = "survey";
/** 並べ読みのしるしの朱（SPEC_v3.3 §3.5 の朱色） */
const HIGHLIGHT_COLOR = 0xa63a2e;
/** これ以上動いたら、押したのではなくドラッグ */
const DRAG_SLOP = 6;

export class MapScene extends Phaser.Scene {
  private canvas: HTMLCanvasElement | null = null;
  private image: Phaser.GameObjects.Image | null = null;
  private events_: MapSceneEvents | null = null;
  private level = 0;
  private dragDistance = 0;
  private highlightLayer: Phaser.GameObjects.Graphics | null = null;
  private highlighted: readonly (readonly Point[])[] = [];

  constructor() {
    super("MapScene");
  }

  /** 測量図の Canvas と知らせ先を渡す（create の前でも後でもよい） */
  setSurvey(canvas: HTMLCanvasElement, events: MapSceneEvents): void {
    this.canvas = canvas;
    this.events_ = events;
    if (this.sys.isActive()) this.attach();
  }

  /** 測量図を描き直したあと、テクスチャを更新する */
  refresh(): void {
    // 起動前（create の前）は何もしない。create で最新の Canvas を貼る
    if (!this.sys.isActive()) return;
    const texture = this.textures.get(TEXTURE) as Phaser.Textures.CanvasTexture | undefined;
    texture?.refresh?.();
    this.events_?.onWake();
  }

  create(): void {
    const camera = this.cameras.main;
    camera.setBounds(0, 0, MAP_PX, MAP_PX);
    camera.setBackgroundColor("#E8DCC0");
    this.applyZoom(0, null);
    if (this.canvas) this.attach();

    this.input.on("wheel", (pointer: Phaser.Input.Pointer, _objects: unknown, _dx: number, dy: number) => {
      this.setLevel(this.level + (dy < 0 ? 1 : -1), { x: pointer.x, y: pointer.y });
    });
    this.input.on("pointerdown", () => {
      this.dragDistance = 0;
    });
    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (pointer.isDown) {
        const dx = pointer.x - pointer.prevPosition.x;
        const dy = pointer.y - pointer.prevPosition.y;
        this.dragDistance += Math.hypot(dx, dy);
        camera.scrollX -= dx / camera.zoom;
        camera.scrollY -= dy / camera.zoom;
        this.events_?.onWake();
        this.events_?.onHover(null, { x: pointer.x, y: pointer.y });
        return;
      }
      this.events_?.onHover(this.worldOf(pointer), { x: pointer.x, y: pointer.y });
    });
    this.input.on("pointerup", (pointer: Phaser.Input.Pointer) => {
      if (this.dragDistance <= DRAG_SLOP) this.events_?.onSelect(this.worldOf(pointer));
    });
    this.input.on("gameout", () => this.events_?.onHover(null, { x: 0, y: 0 }));
  }

  /**
   * 並べ読みのしるし（§4.6）：区画を朱でほのかに塗り、太い輪郭と斜線を重ねる（色だけに頼らない：不変条件24）。
   * 空の配列で消す。create の前に渡されたものは create で描く
   */
  setHighlight(polygons: readonly (readonly Point[])[]): void {
    this.highlighted = polygons;
    const g = this.highlightLayer;
    if (!g) return;
    g.clear();
    for (const polygon of polygons) {
      if (polygon.length < 3) continue;
      const outline = () => {
        g.beginPath();
        polygon.forEach((p, i) => (i === 0 ? g.moveTo(p.x, p.y) : g.lineTo(p.x, p.y)));
        g.closePath();
      };
      g.fillStyle(HIGHLIGHT_COLOR, 0.14);
      outline();
      g.fillPath();
      g.lineStyle(2, HIGHLIGHT_COLOR, 0.65);
      for (const [a, b] of hatchSegments(polygon, 16, -Math.PI / 4)) g.lineBetween(a.x, a.y, b.x, b.y);
      g.lineStyle(6, HIGHLIGHT_COLOR, 0.9);
      outline();
      g.strokePath();
    }
    this.events_?.onWake();
  }

  /** 拡大の段（0..2）を変える。around は拡大の中心にする画面上の点（無ければ画面の中央） */
  setLevel(level: number, around: Point | null): void {
    if (!this.sys.isActive()) return;
    const next = Math.min(MAP_ZOOM_LEVELS.length - 1, Math.max(0, level));
    if (next === this.level) return;
    this.applyZoom(next, around);
    this.events_?.onZoom(next);
    this.events_?.onWake();
  }

  private applyZoom(level: number, around: Point | null): void {
    const camera = this.cameras.main;
    const before = around ? camera.getWorldPoint(around.x, around.y) : null;
    this.level = level;
    const fit = MAP_VIEW / MAP_PX;
    camera.setZoom(fit * (MAP_ZOOM_LEVELS[level] ?? 1));
    if (before && around) {
      // かざした点が同じ場所に残るように、中心をずらす
      camera.centerOn(before.x - (around.x - MAP_VIEW / 2) / camera.zoom, before.y - (around.y - MAP_VIEW / 2) / camera.zoom);
    } else if (level === 0) {
      camera.centerOn(MAP_PX / 2, MAP_PX / 2);
    }
  }

  private worldOf(pointer: Phaser.Input.Pointer): Point {
    const p = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    return { x: p.x, y: p.y };
  }

  private attach(): void {
    if (!this.canvas) return;
    if (this.textures.exists(TEXTURE)) this.textures.remove(TEXTURE);
    this.textures.addCanvas(TEXTURE, this.canvas);
    this.image?.destroy();
    this.image = this.add.image(0, 0, TEXTURE).setOrigin(0, 0);
    this.highlightLayer?.destroy();
    this.highlightLayer = this.add.graphics();
    this.setHighlight(this.highlighted);
    this.events_?.onWake();
  }
}
