import Phaser from "phaser";
import { useEffect, useRef } from "react";
import { CATEGORIES, type BuildingId } from "../../domain/Buildings";
import { GRID_SIZE } from "../../domain/constants";
import type { MapState } from "../../domain/Map";
import { messages } from "../../i18n/messages";
import { MAP_PIXELS, MapScene } from "../scenes/MapScene";
import { palette } from "../theme";

const PLAIN_LEGEND = ["road", "construction", "empty"] as const;

export interface WorkItem {
  readonly id: number;
  readonly building: BuildingId;
  readonly count: number;
  readonly repair: boolean;
  readonly orderedTurn: number;
}

// 普請中の案件は「何を発注したか」だけを出す。工期・進み具合・建材は秘匿（CLAUDE.md §4-13）。
export function MapPanel({ map, works }: { readonly map: MapState; readonly works: readonly WorkItem[] }) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<MapScene | null>(null);

  useEffect(() => {
    if (!host.current) return;
    const mapScene = new MapScene();
    const size = MAP_PIXELS(GRID_SIZE);
    const game = new Phaser.Game({
      type: Phaser.CANVAS,
      parent: host.current,
      width: size,
      height: size,
      backgroundColor: palette.paper,
      scene: mapScene,
      banner: false,
      audio: { noAudio: true },
    });
    scene.current = mapScene;
    return () => {
      scene.current = null;
      game.destroy(true);
    };
  }, []);

  // シーンの create 前に渡された地図は保留され、create 時に描かれる
  useEffect(() => {
    scene.current?.setMap(map);
  }, [map]);

  const legend = messages.ui.map.legend;
  return (
    <section className="panel map-panel" aria-label={messages.ui.panels.map}>
      <h2 className="panel-title">{messages.ui.panels.map}</h2>
      <div className="map-canvas" ref={host} data-testid="map-canvas" />
      <ul className="map-legend">
        {CATEGORIES.map((category) => (
          <li key={category}>
            <span className={`legend-swatch legend-${category}`} aria-hidden />
            {messages.categories[category]}
          </li>
        ))}
        {PLAIN_LEGEND.map((kind) => (
          <li key={kind}>
            <span className={`legend-swatch legend-${kind}`} aria-hidden />
            {legend[kind]}
          </li>
        ))}
      </ul>
      <p className="panel-note">{messages.ui.map.note}</p>
      <div className="works" data-testid="works">
        <h3 className="works-title">{messages.ui.map.worksTitle}</h3>
        {works.length === 0 ? (
          <p className="panel-note">{messages.ui.map.noWorks}</p>
        ) : (
          <ul className="works-list">
            {works.map((w) => (
              <li key={w.id}>{messages.ui.map.work(messages.targets[w.building], w.count, w.repair, w.orderedTurn)}</li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
