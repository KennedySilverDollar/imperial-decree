# ASSETS.md — 素材と出典

方針（CLAUDE.md §8 / SPEC §12.10）：**OFL または CC0 のみ**。ライセンスが不明な素材は使わない。

## 使用中

| 素材 | 用途 | 入手元 | バージョン | ライセンス | 備考 |
|------|------|--------|------------|------------|------|
| Noto Serif JP（300/400/700） | 新聞・側近報告・勅令・見出し | npm `@fontsource/noto-serif-jp`（原典：Google Fonts / Noto プロジェクト） | 5.x | SIL Open Font License 1.1 | ビルドに同梱（unicode-range で分割、外部 CDN に依存しない） |
| Noto Sans JP（400/700） | UI ラベル・数値 | npm `@fontsource/noto-sans-jp`（原典：同上） | 5.x | SIL Open Font License 1.1 | 同上 |

プログラムの依存（素材ではないが記録）：`simplex-noise` 4.0.3（MIT）、`d3-delaunay` 6.0.4（ISC）とその依存 `delaunator` 5.1.0（ISC）・`robust-predicates` 3.0.3（Unlicense）。DECISIONS BC-01・BC-15。

ライセンス本文は `node_modules/@fontsource/noto-serif-jp/LICENSE` と `node_modules/@fontsource/noto-sans-jp/LICENSE` に含まれる。配布物に同梱するときは LICENSE を添える。

## 自作（外部素材なし）

| 表現 | 作り方 | ファイル |
|------|--------|----------|
| 紙の質感（新聞・書簡・巻物・3段表示の書類） | CSS のグラデーションと影 | `src/ui/styles.css`（`.paper`） |
| 机の木目 | CSS の繰り返しグラデーション | `src/ui/styles.css`（`.desk`） |
| 判子・押印 | CSS（円形ボタン＋枠線の印影、transition） | `src/ui/styles.css`（`.seal-button`, `.seal-imprint`） |
| 地図のタイル（抽象グリッド。地形が使えないときのフォールバック） | Canvas 2D で図形と文字の記号（`messages.tileGlyphs`）を描画。亀裂は I-32 で廃止 | `src/ui/map/drawMap.ts`（`drawAbstractGrid`。旧 `src/ui/scenes/MapScene.ts`） |
| 建物の絵記号17種（v3.4 M2、AA-12） | 24×24 の枠の SVG パス（線の太さ 1.6 で統一、測量図の記号風）。自作・CC0 | `src/ui/map/glyphs/buildingGlyphs.ts` |
| 地形（測量図の下塗り・陰影・水系） | 手続き的生成（simplex-noise・自前の水文と輪郭）。素材なし | `src/ui/map/terrain/` |
| 区画・本通り・建物の配置・普請中・開墾 | 手続き的生成（d3-delaunay の Voronoi）。素材なし | `src/ui/map/` |
| 測量図の画法（等高線・ケバ・崖線・植生の記号・水彩のむら・紙の経年・方位記号・縮尺・表題の枠・建物平面・留め針，v3.4 M3） | 手続き的描画（Canvas 2D、自前の marching squares）。自作・CC0。画像素材なし。字は既存の Noto Serif JP（上の行） | `src/ui/map/cartography/` |
| 地形模型（石膏の台座・格子の面・水面・植栽・建物の箱，v3.4 M4） | 手続き的描画（Canvas 2D の擬似3D）。自作・CC0。画像素材・3D モデルなし（Three.js は使っていない） | `src/ui/map/model3d/` |

## 未使用（P0 では入れない）
- 効果音（判子・紙めくり）：SPEC §12.8 でプロトは不要。入れる場合は CC0（freesound 等）か自作とし、ここに出典を書く。
- 木目・紙の画像テクスチャ：CSS で足りているため不使用。入れる場合は CC0（ambientCG 等）。
