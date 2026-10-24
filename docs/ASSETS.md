# ASSETS.md — 素材と出典

方針（CLAUDE.md §8 / SPEC §12.10）：**OFL または CC0 のみ**。ライセンスが不明な素材は使わない。

## 使用中

| 素材 | 用途 | 入手元 | バージョン | ライセンス | 備考 |
|------|------|--------|------------|------------|------|
| Noto Serif JP（300/400/700） | 新聞・側近報告・勅令・見出し | npm `@fontsource/noto-serif-jp`（原典：Google Fonts / Noto プロジェクト） | 5.x | SIL Open Font License 1.1 | ビルドに同梱（unicode-range で分割、外部 CDN に依存しない） |
| Noto Sans JP（400/700） | UI ラベル・数値 | npm `@fontsource/noto-sans-jp`（原典：同上） | 5.x | SIL Open Font License 1.1 | 同上 |

ライセンス本文は `node_modules/@fontsource/noto-serif-jp/LICENSE` と `node_modules/@fontsource/noto-sans-jp/LICENSE` に含まれる。配布物に同梱するときは LICENSE を添える。

## 自作（外部素材なし）

| 表現 | 作り方 | ファイル |
|------|--------|----------|
| 紙の質感（新聞・書簡・巻物・3段表示の書類） | CSS のグラデーションと影 | `src/ui/styles.css`（`.paper`） |
| 机の木目 | CSS の繰り返しグラデーション | `src/ui/styles.css`（`.desk`） |
| 判子・押印 | CSS（円形ボタン＋枠線の印影、transition） | `src/ui/styles.css`（`.seal-button`, `.seal-imprint`） |
| 地図のタイル（住宅・道路・役所・市場・亀裂） | Phaser の Graphics で図形を描画 | `src/ui/scenes/MapScene.ts` |

## 未使用（P0 では入れない）
- 効果音（判子・紙めくり）：SPEC §12.8 でプロトは不要。入れる場合は CC0（freesound 等）か自作とし、ここに出典を書く。
- 木目・紙の画像テクスチャ：CSS で足りているため不使用。入れる場合は CC0（ambientCG 等）。
