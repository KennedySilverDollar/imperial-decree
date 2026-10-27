import { BUILDINGS } from "../../domain/Buildings";
import type { Gazetteer } from "../../engine/Gazetteer";
import { messages } from "../../i18n/messages";
import { boundsOf, centroid, pointInPolygon, type Point } from "./geometry2d";
import { HEIGHTMAP_SIZE, MAP_PX, ROAD_LINE, ROAD_WIDTH, VILLAGE_SIZE } from "./mapConstants";
import { villageOutline } from "./ParcelMapper";
import { drawPictogram, type Ctx2D } from "./pictograms";
import { buildRoadGraph, routeRoads, type RoadGraph, type RoadNetwork } from "./RoadRouter";
import { mixHex, SURVEY } from "./surveyPalette";
import type { ParcelView, SurveyModel } from "./surveyModel";
import type { TerrainData } from "./TerrainGenerator";

// 毎年描き込むレイヤ 7〜12（SPEC_v3.3 §5.4）：区画・道路・建物の絵記号・地名・装飾・書き込み。
// 生成時のレイヤ（BaseRenderer の画像）の上に、本体のスレッドで描く（書体を使うため）。
// 直近の1年に描き込んだ線は新しい濃いインク、それ以前は古いインク（§5.7）。亀裂印は側近報告で開示されたものだけ（§5.8）。

const CELL = VILLAGE_SIZE / 10;
/** 表題の枠（地名をこの下に隠さない） */
const TITLE_BOX = { x: 80, y: 80, w: 640, h: 150 } as const;
const t = messages.ui.map;

export const SURVEY_FONTS = {
  label: `"Shippori Mincho B1", "Noto Serif JP", serif`,
  pencil: `"Klee One", "Noto Serif JP", serif`,
  body: `"Noto Serif JP", serif`,
} as const;

/** 地図に書く文字（書体の読み込みを待つため、描く前に一覧で求める） */
export const surveyTexts = (gazetteer: Gazetteer, model: SurveyModel): readonly { font: string; text: string }[] => [
  { font: `56px ${SURVEY_FONTS.label}`, text: Object.values(gazetteer.features).filter((n): n is string => n !== null).join("") },
  { font: `56px ${SURVEY_FONTS.label}`, text: t.title(gazetteer.region) + t.north },
  { font: `30px ${SURVEY_FONTS.label}`, text: t.surveyedIn(model.surveyYear) + t.scale + t.scaleLabel + "〇一二三四五六七八九十" },
  { font: `24px ${SURVEY_FONTS.body}`, text: t.marginNote },
  { font: `26px ${SURVEY_FONTS.pencil}`, text: t.crackNote + t.unsurveyed + model.parcels.flatMap((p) => p.notes).join("") + "…＋" },
];

// 地形ごとに、道の網の形（境界のグラフ）を一度だけ作る
const graphs = new WeakMap<TerrainData, RoadGraph>();
const networks = new WeakMap<TerrainData, Map<number, RoadNetwork>>();
export const roadNetworkFor = (terrain: TerrainData, roads: number): RoadNetwork => {
  let graph = graphs.get(terrain);
  if (!graph) {
    graph = buildRoadGraph(terrain.parcels);
    graphs.set(terrain, graph);
  }
  let byCount = networks.get(terrain);
  if (!byCount) {
    byCount = new Map();
    networks.set(terrain, byCount);
  }
  let network = byCount.get(roads);
  if (!network) {
    network = routeRoads(graph, roads);
    byCount.set(roads, network);
  }
  return network;
};

const trace = (ctx: Ctx2D, points: readonly Point[], close = false) => {
  ctx.beginPath();
  points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  if (close) ctx.closePath();
};

const fertilityAt = (terrain: TerrainData, p: Point): number => {
  const cell = MAP_PX / HEIGHTMAP_SIZE;
  const i = Math.min(HEIGHTMAP_SIZE - 1, Math.max(0, Math.floor(p.x / cell)));
  const j = Math.min(HEIGHTMAP_SIZE - 1, Math.max(0, Math.floor(p.y / cell)));
  return (terrain.fertility[j * HEIGHTMAP_SIZE + i] as number) / 255;
};

/** 平行線のハッチング（多角形で切り抜く） */
const hatch = (ctx: Ctx2D, polygon: readonly Point[], angle: number, spacing: number) => {
  const b = boundsOf(polygon);
  const c = centroid(polygon);
  const reach = Math.hypot(b.maxX - b.minX, b.maxY - b.minY);
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  ctx.beginPath();
  for (let s = -reach; s <= reach; s += spacing) {
    const ox = c.x - dy * s;
    const oy = c.y + dx * s;
    ctx.moveTo(ox - dx * reach, oy - dy * reach);
    ctx.lineTo(ox + dx * reach, oy + dy * reach);
  }
};

/** レイヤ 7：区画（破線の境界）、畑は縞、普請中は斜めの細線 */
const paintParcels = (ctx: Ctx2D, terrain: TerrainData, model: SurveyModel, graph: RoadGraph) => {
  for (const view of model.parcels) {
    const parcel = terrain.parcels[view.gridIndex];
    if (!parcel) continue;
    const isFarm = view.kind === "building" && view.building === "farm";
    if (!isFarm && view.kind !== "construction") continue;
    ctx.save();
    trace(ctx, parcel.polygon, true);
    ctx.clip();
    if (isFarm) {
      const rich = fertilityAt(terrain, parcel.center);
      hatch(ctx, parcel.polygon, ((view.gridIndex * 37) % 180) * (Math.PI / 180), 11);
      ctx.strokeStyle = mixHex(SURVEY.fieldPoor, SURVEY.fieldRich, rich);
      ctx.globalAlpha = 0.75;
      ctx.lineWidth = 2;
    } else {
      hatch(ctx, parcel.polygon, Math.PI / 4, 16);
      ctx.strokeStyle = view.fresh ? SURVEY.newInk : SURVEY.oldInk;
      ctx.globalAlpha = 0.28;
      ctx.lineWidth = 1.5;
    }
    ctx.stroke();
    ctx.restore();
  }
  // 境界：隣り合う区画で共有する辺を一度ずつ、細い破線で
  const edges = new Path2D();
  graph.adjacent.forEach((list, a) =>
    list.forEach(({ to }) => {
      if (to < a) return;
      const p = graph.nodes[a] as Point;
      const q = graph.nodes[to] as Point;
      edges.moveTo(p.x, p.y);
      edges.lineTo(q.x, q.y);
    }),
  );
  ctx.save();
  ctx.strokeStyle = SURVEY.ink;
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = 1.6;
  ctx.setLineDash([7, 6]);
  ctx.stroke(edges);
  ctx.restore();
  // 村域の外周は実線
  ctx.save();
  trace(ctx, villageOutline(terrain.parcels), true);
  ctx.strokeStyle = SURVEY.ink;
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = 2.6;
  ctx.stroke();
  ctx.restore();
};

/** レイヤ 8：道路の二重線。古い道を先に、直近の1年に伸びた道を新しいインクで */
const paintRoads = (ctx: Ctx2D, network: RoadNetwork, model: SurveyModel) => {
  const layers = [false, true].map((fresh) =>
    network.pathCurves.filter((_, i) => ((network.pathTiles[i] ?? 0) >= model.freshRoadsFrom) === fresh),
  );
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  layers.forEach((curves, fresh) => {
    if (curves.length === 0) return;
    ctx.strokeStyle = fresh ? SURVEY.newInk : SURVEY.oldInk;
    ctx.lineWidth = ROAD_WIDTH + ROAD_LINE * 2;
    for (const c of curves) {
      trace(ctx, c);
      ctx.stroke();
    }
  });
  ctx.strokeStyle = SURVEY.roadFill;
  ctx.lineWidth = ROAD_WIDTH;
  for (const curves of layers)
    for (const c of curves) {
      trace(ctx, c);
      ctx.stroke();
    }
  ctx.restore();
};

/** 朱の亀裂印：稲妻形の折れ線（色だけに頼らない：形で分かる） */
const paintCrack = (ctx: Ctx2D, x: number, y: number) => {
  ctx.save();
  ctx.strokeStyle = SURVEY.vermilion;
  ctx.lineWidth = 3.2;
  ctx.lineCap = "round";
  ctx.lineJoin = "miter";
  trace(ctx, [
    { x, y: y - 22 },
    { x: x - 7, y: y - 8 },
    { x: x + 5, y: y - 2 },
    { x: x - 6, y: y + 12 },
    { x: x + 3, y: y + 22 },
  ]);
  ctx.stroke();
  ctx.restore();
};

/** レイヤ 9：建物の絵記号（＋亀裂印と鉛筆の注記、未測の印） */
const paintBuildings = (ctx: Ctx2D, terrain: TerrainData, model: SurveyModel) => {
  for (const view of model.parcels) {
    const parcel = terrain.parcels[view.gridIndex];
    if (!parcel || view.building === null || view.kind === "road" || view.kind === "empty") continue;
    const { x, y } = parcel.center;
    const farm = view.building === "farm";
    const size = farm ? CELL * 0.4 : CELL * 0.56;
    const color = view.fresh ? SURVEY.newInk : SURVEY.oldInk;
    if (view.kind === "construction") {
      drawPictogram(ctx, view.building, x, y, size, color, 0.55);
    } else {
      // 記号の下地（紙の色）を敷いて、等高線や畑の縞に埋もれないように
      if (!farm) {
        ctx.save();
        ctx.fillStyle = SURVEY.paper;
        ctx.globalAlpha = 0.72;
        ctx.beginPath();
        ctx.arc(x, y, size * 0.62, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      drawPictogram(ctx, view.building, x, y, size, color);
      if (BUILDINGS[view.building].category === "administration") {
        // 行政の建物は記号の下に一本線（目立たせるのは色ではなく線で）
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x - size * 0.45, y + size * 0.62);
        ctx.lineTo(x + size * 0.45, y + size * 0.62);
        ctx.stroke();
        ctx.restore();
      }
    }
    if (view.crack) {
      paintCrack(ctx, x + size * 0.6, y - size * 0.15);
      ctx.save();
      ctx.font = `22px ${SURVEY_FONTS.pencil}`;
      ctx.fillStyle = SURVEY.pencil;
      ctx.textAlign = "center";
      ctx.fillText(t.crackNote, x, y + size * 0.62 + 26);
      ctx.restore();
    }
  }
  for (const view of model.parcels) {
    if (!view.unsurveyed) continue;
    const parcel = terrain.parcels[view.gridIndex];
    if (!parcel) continue;
    ctx.save();
    ctx.font = `22px ${SURVEY_FONTS.pencil}`;
    ctx.fillStyle = SURVEY.pencil;
    ctx.textAlign = "center";
    ctx.fillText(t.unsurveyed, parcel.center.x - CELL * 0.28, parcel.center.y - CELL * 0.26);
    ctx.restore();
  }
};

/** 白抜きの縁取りをした横書きの文字（等高線に沿わせない：§5.4-10） */
const label = (ctx: Ctx2D, text: string, x: number, y: number, font: string, color: string = SURVEY.ink) => {
  ctx.save();
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if ("letterSpacing" in ctx) (ctx as { letterSpacing: string }).letterSpacing = "6px";
  ctx.lineJoin = "round";
  ctx.strokeStyle = SURVEY.paper;
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = 9;
  ctx.strokeText(text, x, y);
  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
};

/** レイヤ 10：地名（地形の名を、その地形の目印の位置に） */
const paintToponyms = (ctx: Ctx2D, terrain: TerrainData, gazetteer: Gazetteer) => {
  const font = `56px ${SURVEY_FONTS.label}`;
  const a = terrain.anchors;
  // 地図の縁に寄りすぎず、表題・方位記号・縮尺の枠の下に隠れない位置へずらす
  const inside = (p: Point) => {
    const x = Math.min(MAP_PX - 200, Math.max(200, p.x));
    let y = Math.min(MAP_PX - 120, Math.max(120, p.y));
    if (x < TITLE_BOX.x + TITLE_BOX.w + 120 && y < TITLE_BOX.y + TITLE_BOX.h + 40) y = TITLE_BOX.y + TITLE_BOX.h + 70;
    if (x > MAP_PX - 340 && y < 340) y = 360;
    if (x < 640 && y > MAP_PX - 230) y = MAP_PX - 250;
    return { x, y };
  };
  if (gazetteer.features.river) {
    const p = inside(a.river);
    label(ctx, gazetteer.features.river, p.x + 70, p.y - 50, font, SURVEY.waterLine);
  }
  if (gazetteer.features.hill) {
    const p = inside(a.hill);
    label(ctx, gazetteer.features.hill, p.x, p.y, font);
  }
  if (gazetteer.features.forest) {
    const p = inside(a.forest);
    label(ctx, gazetteer.features.forest, p.x, p.y, font, SURVEY.forest);
  }
  if (gazetteer.features.lake && a.lake) {
    const p = inside(a.lake);
    label(ctx, gazetteer.features.lake, p.x, p.y, font, SURVEY.waterLine);
  }
  if (gazetteer.features.plain && a.plain) {
    const p = inside(a.plain);
    label(ctx, gazetteer.features.plain, p.x, p.y, font);
  }
};

/** レイヤ 11：装飾（図郭の二重線・表題と測量年・方位記号・縮尺・余白の注記） */
const paintDecorations = (ctx: Ctx2D, gazetteer: Gazetteer, model: SurveyModel) => {
  ctx.save();
  ctx.strokeStyle = SURVEY.ink;
  ctx.globalAlpha = 0.8;
  ctx.lineWidth = 3;
  ctx.strokeRect(34, 34, MAP_PX - 68, MAP_PX - 68);
  ctx.lineWidth = 1.2;
  ctx.strokeRect(46, 46, MAP_PX - 92, MAP_PX - 92);
  ctx.restore();

  // 表題（左上の枠）
  const { x: tx, y: ty, w: tw, h: th } = TITLE_BOX;
  ctx.save();
  ctx.fillStyle = SURVEY.paper;
  ctx.globalAlpha = 0.9;
  ctx.fillRect(tx, ty, tw, th);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = SURVEY.ink;
  ctx.lineWidth = 2.4;
  ctx.strokeRect(tx, ty, tw, th);
  ctx.lineWidth = 1;
  ctx.strokeRect(tx + 8, ty + 8, tw - 16, th - 16);
  ctx.fillStyle = SURVEY.ink;
  ctx.textAlign = "center";
  ctx.font = `56px ${SURVEY_FONTS.label}`;
  ctx.fillText(t.title(gazetteer.region), tx + tw / 2, ty + 72);
  ctx.font = `30px ${SURVEY_FONTS.label}`;
  ctx.fillStyle = SURVEY.oldInk;
  ctx.fillText(t.surveyedIn(model.surveyYear), tx + tw / 2, ty + 118);
  ctx.restore();

  // 方位記号（右上）
  const cx = MAP_PX - 190;
  const cy = 200;
  ctx.save();
  ctx.fillStyle = SURVEY.paper;
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.arc(cx, cy, 96, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = SURVEY.ink;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(cx, cy, 80, 0, Math.PI * 2);
  ctx.stroke();
  for (let k = 0; k < 8; k++) {
    const angle = (k * Math.PI) / 4 - Math.PI / 2;
    const long = k % 2 === 0 ? 74 : 44;
    const side = angle + Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * long, cy + Math.sin(angle) * long);
    ctx.lineTo(cx + Math.cos(side) * 9, cy + Math.sin(side) * 9);
    ctx.lineTo(cx - Math.cos(side) * 9, cy - Math.sin(side) * 9);
    ctx.closePath();
    ctx.fillStyle = k === 0 ? SURVEY.ink : SURVEY.paper;
    ctx.fill();
    ctx.stroke();
  }
  ctx.fillStyle = SURVEY.ink;
  ctx.font = `56px ${SURVEY_FONTS.label}`;
  ctx.textAlign = "center";
  ctx.fillText(t.north, cx, cy - 102);
  ctx.restore();

  // 縮尺（左下）：一区画＝一町として 3 町ぶん
  const sx = 100;
  const sy = MAP_PX - 120;
  ctx.save();
  ctx.fillStyle = SURVEY.paper;
  ctx.globalAlpha = 0.85;
  ctx.fillRect(sx - 20, sy - 64, CELL * 3 + 80, 100);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = SURVEY.ink;
  ctx.lineWidth = 1.6;
  for (let k = 0; k < 3; k++) {
    ctx.fillStyle = k % 2 === 0 ? SURVEY.ink : SURVEY.paper;
    ctx.fillRect(sx + k * CELL, sy, CELL, 12);
    ctx.strokeRect(sx + k * CELL, sy, CELL, 12);
  }
  ctx.fillStyle = SURVEY.ink;
  ctx.font = `30px ${SURVEY_FONTS.label}`;
  ctx.textAlign = "center";
  ["〇", "一", "二", "三"].forEach((n, k) => ctx.fillText(n, sx + k * CELL, sy - 14));
  ctx.textAlign = "left";
  ctx.fillText(`${t.scaleLabel}（${t.scale}）`, sx + CELL * 3 + 14, sy + 12);
  ctx.restore();

  // 余白の注記（右下）
  ctx.save();
  ctx.font = `24px ${SURVEY_FONTS.body}`;
  ctx.fillStyle = SURVEY.oldInk;
  ctx.textAlign = "right";
  ctx.fillText(t.marginNote, MAP_PX - 70, MAP_PX - 64);
  ctx.restore();
};

/** レイヤ 12：書き込み（区画に留めたメモ）。鉛筆の小さな丸と、最初の数文字 */
const paintNotes = (ctx: Ctx2D, terrain: TerrainData, model: SurveyModel) => {
  for (const view of model.parcels) {
    if (view.notes.length === 0) continue;
    const parcel = terrain.parcels[view.gridIndex];
    if (!parcel) continue;
    const x = parcel.center.x - CELL * 0.3;
    const y = parcel.center.y + CELL * 0.32;
    ctx.save();
    ctx.strokeStyle = SURVEY.pencil;
    ctx.fillStyle = SURVEY.pencil;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(parcel.center.x, parcel.center.y, CELL * 0.42, CELL * 0.38, -0.2, 0, Math.PI * 2);
    ctx.setLineDash([3, 5]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = `24px ${SURVEY_FONTS.pencil}`;
    ctx.textAlign = "left";
    const first = [...(view.notes[0] ?? "")];
    const shown = first.length > 6 ? `${first.slice(0, 6).join("")}…` : first.join("");
    ctx.fillText(view.notes.length > 1 ? `${shown}＋${view.notes.length - 1}` : shown, x, y);
    ctx.restore();
  }
};

export interface SurveyArt {
  readonly base: CanvasImageSource;
  readonly terrain: TerrainData;
  readonly model: SurveyModel;
  readonly gazetteer: Gazetteer;
}

/** 測量図の全レイヤを描く（ctx は MAP_PX 四方） */
export const renderSurvey = (ctx: Ctx2D, art: SurveyArt): void => {
  const { terrain, model, gazetteer } = art;
  const network = roadNetworkFor(terrain, model.roads);
  const graph = graphs.get(terrain) as RoadGraph;
  ctx.save();
  ctx.clearRect(0, 0, MAP_PX, MAP_PX);
  ctx.drawImage(art.base, 0, 0, MAP_PX, MAP_PX);
  paintParcels(ctx, terrain, model, graph);
  paintRoads(ctx, network, model);
  paintBuildings(ctx, terrain, model);
  paintToponyms(ctx, terrain, gazetteer);
  paintDecorations(ctx, gazetteer, model);
  paintNotes(ctx, terrain, model);
  ctx.restore();
};

/** 区画の当たり判定（地図の画素の座標から区画の番号。村域の外は null） */
export const parcelAt = (terrain: TerrainData, p: Point): number | null => {
  for (const parcel of terrain.parcels) {
    const b = boundsOf(parcel.polygon);
    if (p.x < b.minX || p.x > b.maxX || p.y < b.minY || p.y > b.maxY) continue;
    if (pointInPolygon(p, parcel.polygon)) return parcel.gridIndex;
  }
  return null;
};

export type { ParcelView };
