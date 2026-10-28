import type { Baked } from "./cartography/Layers";
import { drawMapLayers } from "./cartography/Layers";
import { defaultView } from "./cartography/lod";
import type { MapComposition } from "./composeMap";
import type { MapViewModel } from "./MapViewModel";
import { cpuCanvas } from "./terrainClient";
import type { TerrainDataV2 } from "./terrain/types";

// 俯瞰の静止画（SPEC_v3.4 §7.1）：机の上に置いたままの地図は L1（村域と周辺）の一枚絵。
// 手に取っていない間は毎回描き直さず、MapViewModel・地形・大きさ・軽量モードが同じなら同じ画像を使い回す。
// 描くのは手元と同じ drawMapLayers（同じ情報。不変条件23）。

export interface SnapshotKey {
  readonly vm: MapViewModel;
  readonly terrain: TerrainDataV2;
  readonly sizePx: number;
  readonly lite: boolean;
}

export class MapSnapshot {
  private key: SnapshotKey | null = null;
  private canvas: HTMLCanvasElement | OffscreenCanvas | null = null;

  /** 俯瞰の画像（作れなければ null） */
  get(key: SnapshotKey, comp: MapComposition, baked: readonly Baked[]): CanvasImageSource | null {
    const k = this.key;
    if (k && this.canvas && k.vm === key.vm && k.terrain === key.terrain && k.sizePx === key.sizePx && k.lite === key.lite) return this.canvas;
    // テクスチャと同じ CPU 側の Canvas に描く（GPU からの読み戻しを避ける。terrainClient の cpuCanvas）
    const canvas = cpuCanvas(key.sizePx);
    const ctx = canvas?.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D | null | undefined;
    if (!canvas || !ctx) return null;
    drawMapLayers(ctx, key.sizePx, comp, key.terrain, baked, key.vm, {
      view: defaultView(key.terrain.village.frame),
      lite: key.lite,
      inking: new Map(),
      hover: null,
      selected: null,
    });
    this.key = key;
    this.canvas = canvas;
    return canvas;
  }
}
