import { planBuilding, type BuildingPlan } from "./BuildingLayout";
import { layoutClearing, markConstruction, type ClearingLayout, type ConstructionMark } from "./Clearing";
import type { MapViewModel } from "./MapViewModel";
import { mapParcels, type ParcelShape } from "./ParcelMapper";
import { routeRoads, type RoadLayout } from "./RoadRouter";
import type { Polyline, TerrainDataV2, VillageFrame } from "./terrain/types";

// 地図の構図（M2）：MapViewModel と地形から、描く図形をすべて求める純関数。Canvas には描かない（drawMap.ts が描く）。
// 区画の形は地形だけで決まるので、地形ごとに一度だけ求めて覚えておく。

export interface MapComposition {
  readonly frame: VillageFrame;
  readonly shapes: readonly ParcelShape[];
  readonly roads: RoadLayout;
  readonly highway: Polyline;
  readonly buildings: readonly BuildingPlan[];
  readonly construction: readonly ConstructionMark[];
  readonly clearing: ClearingLayout;
}

const shapeCache = new WeakMap<TerrainDataV2, ParcelShape[]>();

export const parcelShapesOf = (terrain: TerrainDataV2): ParcelShape[] => {
  let shapes = shapeCache.get(terrain);
  if (!shapes) {
    shapes = mapParcels(terrain.village.frame, terrain.village, terrain.seed);
    shapeCache.set(terrain, shapes);
  }
  return shapes;
};

const ROAD_LINE = 4;

/** 建物が面する本通りの向き（局所座標の角度）：近い方の腕と平行 */
export const faceAngleOf = (x: number, y: number): number => (Math.abs(y - ROAD_LINE) <= Math.abs(x - ROAD_LINE) ? 0 : Math.PI / 2);

export const composeMap = (vm: MapViewModel, terrain: TerrainDataV2): MapComposition => {
  const F = terrain.village.frame;
  const shapes = parcelShapesOf(terrain);
  const roads = routeRoads(F, shapes, vm.parcels, vm.roads, vm.buildings, terrain.highway.from);
  const buildings = vm.buildings.map((b) => {
    const shape = shapes[b.gridIndex]!;
    return planBuilding(vm.saveId, b, shape, faceAngleOf(shape.x, shape.y), F);
  });
  return {
    frame: F,
    shapes,
    roads,
    highway: terrain.highway.points,
    buildings,
    construction: markConstruction(F, shapes, vm.construction),
    clearing: layoutClearing(F, shapes, vm.buildings),
  };
};
