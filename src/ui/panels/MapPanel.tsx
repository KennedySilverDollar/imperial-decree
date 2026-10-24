import Phaser from "phaser";
import { useEffect, useRef } from "react";
import { GRID_SIZE } from "../../domain/constants";
import type { MapState, TileKind } from "../../domain/Map";
import { messages } from "../../i18n/messages";
import { MAP_PIXELS, MapScene } from "../scenes/MapScene";
import { palette } from "../theme";

const LEGEND: readonly TileKind[] = ["office", "road", "residential", "market", "empty"];

export function MapPanel({ map }: { readonly map: MapState }) {
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
        {LEGEND.map((kind) => (
          <li key={kind}>
            <span className={`legend-swatch legend-${kind}`} aria-hidden />
            {legend[kind]} {kind === "empty" ? "" : map.counts[kind]}
          </li>
        ))}
        <li>
          <span className="legend-swatch legend-cracked" aria-hidden />
          {legend.cracked}
        </li>
      </ul>
      <p className="panel-note">{messages.ui.map.note}</p>
    </section>
  );
}
