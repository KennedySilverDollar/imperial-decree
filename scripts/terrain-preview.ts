// 地形 v2 の簡易プレビュー（開発用）。シードごとに「標高（段彩＋陰影）／水系・街道・村域／植生」を横に並べた PNG を書く。
// 使い方: npx tsx scripts/terrain-preview.ts [出力先=docs/screenshots/m1] [saveId ...]
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { saveIdFor } from "../src/domain/GameState";
import { generateTerrain } from "../src/ui/map/terrain/generateTerrain";
import { renderPreviewPanels } from "../src/ui/map/terrain/renderPreview";

const PANEL = 512;
const GAP = 8;

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf: Buffer): number => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer): Buffer => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const encodePng = (rgba: Uint8Array, w: number, h: number): Buffer => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

const [outDir = "docs/screenshots/m1", ...ids] = process.argv.slice(2);
const saveIds = ids.length > 0 ? ids : [1, 2, 3, 4, 5, 6].map(saveIdFor);
mkdirSync(outDir, { recursive: true });
for (const saveId of saveIds) {
  const r = generateTerrain(saveId);
  if (!r.ok) {
    console.log(`${saveId}: 生成失敗（${r.failures.join(",")}）`);
    continue;
  }
  const panels = renderPreviewPanels(r.data, PANEL);
  const w = PANEL * 3 + GAP * 2;
  const out = new Uint8Array(w * PANEL * 4).fill(255);
  [panels.height, panels.water, panels.vegetation].forEach((px, p) => {
    for (let y = 0; y < PANEL; y++) out.set(px.subarray(y * PANEL * 4, (y + 1) * PANEL * 4), (y * w + p * (PANEL + GAP)) * 4);
  });
  const file = join(outDir, `terrain-${saveId}.png`);
  writeFileSync(file, encodePng(out, w, PANEL));
  const names = r.data.toponyms.map((t) => `${t.kind}:${t.name}`).join(" ");
  console.log(`${file}  試行${r.attempts}回  ${Math.round(r.timings.total ?? 0)}ms  ${names}`);
}
