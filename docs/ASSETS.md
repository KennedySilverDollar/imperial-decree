# ASSETS.md — 素材と出典

方針（CLAUDE.md §8 / SPEC §12.10）：**OFL または CC0 のみ**。ライセンスが不明な素材は使わない。

## 使用中

| 素材 | 用途 | 入手元 | バージョン | ライセンス | 備考 |
|------|------|--------|------------|------------|------|
| Noto Serif JP（300/400/700） | 新聞・側近報告・勅令・見出し | npm `@fontsource/noto-serif-jp`（原典：Google Fonts / Noto プロジェクト） | 5.x | SIL Open Font License 1.1 | ビルドに同梱（unicode-range で分割、外部 CDN に依存しない） |
| Noto Sans JP（400/700） | UI ラベル・数値 | npm `@fontsource/noto-sans-jp`（原典：同上） | 5.x | SIL Open Font License 1.1 | 同上 |
| しっぽり明朝 B1（400） | 見出し（新聞の題字・記事見出し、台帳・結果束・既決箱の題、封書の宛名）（SPEC_v3.3 §8.3） | npm `@fontsource/shippori-mincho-b1`（原典：Google Fonts `ofl/shipporiminchob1`、制作 FONTDASU） | 5.3.0 | SIL Open Font License 1.1（Copyright 2021 The Shippori Mincho Project Authors） | U2 で追加。取得・確認日 2026-10-27（AA-02） |
| Klee One（400） | 手書き風（意図の鉛筆書き、メモ、留めたメモ、台帳の折れ線の項目名、結果束の書き込み）（§8.3） | npm `@fontsource/klee-one`（原典：Google Fonts `ofl/kleeone`、制作 Fontworks） | 5.3.1 | SIL Open Font License 1.1（Copyright 2020 The Klee Project Authors） | 同上 |
| Yuji Syuku（400） | 勅令の本文（筆）（§8.3・AA-01） | npm `@fontsource/yuji-syuku`（原典：Google Fonts `ofl/yujisyuku`、制作 Kinuta Font Factory） | 5.3.1 | SIL Open Font License 1.1（Copyright 2021 The Yuji Project Authors） | 同上。候補の Yuji Boku（数字の字形が読みにくい）・Yuji Mai（仮名の装飾が強い）と並べて比べ、本文の読みやすさで選んだ |

### 書体の読み込み方（サブセット化）

- 各書体は fontsource の `400.css` を読み込む。これは文字の範囲ごとに分割した約120個の woff2 を `unicode-range` 付きの `@font-face` で宣言したもので、ブラウザは**画面に出た文字を含む範囲のファイルだけ**を取りに行く（Google Fonts と同じ分割）。自前でグリフを抜き出すサブセット化はしていない（ゲームの文言と新聞の地名・記事は増え続けるため、固定のサブセットだと字が欠ける）。
- `japanese-400.css`（1ファイル 3.5MB の全グリフ）は使わない。
- 計測（`node scripts/screenshots-u2.cjs`、2026-10-27）：初回表示の転送量は全体 2.4MB・うち書体 1.5MB（96 ファイル）。書類をひととおり手に取ったあとで全体 2.8MB・書体 1.9MB（118 ファイル）。SPEC_v3.3 §2.3 の初回読み込み 5MB 以内に収まる。`dist/` 全体は全グリフの分割ファイルを含むため約 71MB あるが、読み込まれるのはその一部。

ライセンス本文は `node_modules/@fontsource/<書体>/LICENSE`（noto-serif-jp・noto-sans-jp・shippori-mincho-b1・klee-one・yuji-syuku）に含まれる。配布物に同梱するときは LICENSE を添える。

### プログラムの依存（素材ではないが、地形の生成に使うもの）

| 名称 | 用途 | 入手元 | バージョン | ライセンス |
|------|------|--------|------------|------------|
| simplex-noise | 測量図の地形の seed 付きノイズ（fBm・ドメインワーピング・森・水彩のむら）。乱数は自前の seed 付き系列を渡す（Math.random は使わない） | npm `simplex-noise` | 4.0.3 | MIT |

## 自作（外部素材なし）

| 表現 | 作り方 | ファイル |
|------|--------|----------|
| 紙の質感（新聞・書簡・巻物・3段表示の書類） | CSS のグラデーションと影 | `src/ui/styles.css`（`.paper`） |
| 机の木目 | CSS の繰り返しグラデーション | `src/ui/styles.css`（`.desk`） |
| 判子・押印 | CSS（円形ボタン＋枠線の印影、transition） | `src/ui/styles.css`（`.seal-button`, `.seal-imprint`） |
| 地図のタイル（住宅・道路・役所・市場・亀裂） | Phaser の Graphics で図形を描画 | `src/ui/scenes/MapScene.ts` |
| 付箋・墨の濃淡・朱の残り字数・押印の動き（持ち上げ→朱肉→押印） | CSS（背景色・`@keyframes`）と、文字の位置から決まる濃さ（`ink.ts`） | `src/ui/desk/desk.css`, `src/ui/desk/ink.ts` |
| 測量図の地形（標高・川・沼・森・地味）と、紙・水彩・陰影・等高線・樹木記号 | 手続き的生成（`simplex-noise` の seed 付きノイズ）と Canvas 2D の描画。画像素材は使わない（SPEC_v3.3 §10.2「地形の表現：素材不要」） | `src/ui/map/TerrainGenerator.ts`, `src/ui/map/BaseRenderer.ts` |
| 建物の絵記号 17 種（住宅・長屋・屋敷・道路・井戸・倉庫・市場・農地・工房・役所・徴税所・裁判所・診療所・学校・寺院・見張り塔・牢屋） | 自作の SVG パス（32×32、線のみ、線幅 2、端と角は丸）。官製の地図記号に倣い、役所は二重丸、徴税所は算盤玉、裁判所は高札、学校は「文」、畑は双葉、工房は歯車。寺院は二層の屋根（卍は海外で誤読されるため使わない）。地図（Path2D）と凡例（`<svg>`）で同じデータを使う | `src/ui/map/pictograms.ts` |
| 測量図の装飾（図郭の二重線・表題・方位記号・縮尺・亀裂印・鉛筆の書き込み） | Canvas 2D の線と文字（書体は上表のしっぽり明朝 B1・Klee One・Noto Serif JP） | `src/ui/map/SurveyRenderer.ts` |
| 結果の束の綴じ紐・訂正線と「訂」の印・意図の○／× | CSS（枠線・疑似要素） | `src/ui/desk/desk.css` |
| 封書と封蝋・新聞の折り目・台帳の見開きと鉛筆の折れ線・メモの破り目・既決箱の木枠 | CSS のグラデーション・`clip-path`・影、折れ線は SVG の `polyline` | `src/ui/desk/desk.css`, `src/ui/panels/LedgerPanel.tsx` |
| 効果音 11 種（書類を手に取る・置く、新聞を広げる・めくる、封蝋を割る、筆記、付箋、判子、地図のペン先、配達の足音・書類が置かれる音）と環境音 3 種（ランプ・雨・風） | **音源ファイルを使わず、Web Audio API でその場で合成**（seed 付きの白色雑音を帯域フィルタで絞った音と、音程が下がる正弦波・三角波の組み合わせ、包絡は指数減衰）。作り方の数値は `soundRecipes.ts` のデータ。SPEC_v3.3 §8.1 の一覧と1対1（各レシピに場面名を書いてある） | `src/ui/audio/soundRecipes.ts`, `src/ui/audio/AudioService.ts` |
| ターン遷移の演出（既決箱へ・窓の光・配達・台帳の書き込み）、ランプの消灯、町の印章、地図のインクの描き込み（輪郭→記号、失われた建物の二重線） | CSS の `@keyframes`・個別の `translate`/`scale`・`mix-blend-mode`、地図は Canvas 2D の線の伸び（破線の長さで描きかけを表す） | `src/ui/desk/desk.css`, `src/ui/desk/WindowLight.tsx`, `src/ui/map/SurveyRenderer.ts` |

## 未使用（P0 では入れない）
- 効果音の録音素材：U4 では上表のとおり合成（自作）で足りた。録音素材に差し替える場合は CC0（freesound 等）に限り、ここに出典を書く。
- 木目・紙の画像テクスチャ：CSS で足りているため不使用。入れる場合は CC0（ambientCG 等）。
