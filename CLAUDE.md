# CLAUDE.md — 勅令都市（仮）P0プロトタイプ

## 0. このプロジェクトは何か
- 都市開発シム × 官僚マネジメント × AI解釈ゲーム。プレイヤーは都市を直接操作できず、**勅令（自然言語）→ 参謀(LLM)の解釈 → 側近による歪み → ルールエンジンの決定論的更新**の経路でのみ干渉する。
- 今回作るのは **ブラウザ向けP0プロトタイプのみ**（村→町、30〜50ターン）。目的は中核仮説の検証：「信頼性が曖昧な情報を反芻して勅令を出す難しさは面白いか」。
- 製品版機能（イベント、複数新聞、官僚機構、Tauri、多言語、霧など）は**作らない**。

## 1. 正典と優先順位
1. 正典は docs/ 内の仕様書。ゲームロジックの優先順位は SPEC_v3.2.md > SPEC_v3.1.md > SPEC.md（v3.0）。
2. 表現層（UI・描画・演出）に関しては SPEC_v3.4.md > SPEC_v3.3.md（v3.3-UI）> SPEC_v3.2.md > SPEC_v3.1.md > SPEC.md の順で優先する。v3.3-UI・v3.4 はゲームロジックを何も変更しない。
   - **「v3.3」の呼び分け**：リポジトリでは「v3.3」が2つの意味で使われている。
     - **v3.3（ゲームロジック）**＝工期・労働人口・秘匿資材・ランダムイベント。専用のファイルはなく、DECISIONS §12 と BALANCE 第3部が正。
     - **v3.3-UI**＝docs/SPEC_v3.3.md（表現層：机と測量図）。
   - 以降、本書の「v3.3」はゲームロジックの v3.3 を指し、表現層は「v3.3-UI」と書く（既存の記述で表現層を指す「v3.3」は v3.3-UI と読む）。
3. 仕様が曖昧・矛盾・未定義のときは推測で実装せず docs/DECISIONS.md に論点と推奨案を書き、承認を得てから進む。SPEC_v3.2.md §5 に既知の15論点がある。
4. 仕様の変更提案は DECISIONS.md の「仕様変更提案」に分けて書く。勝手に変更しない。

## 2. 技術スタック（既定値）
- TypeScript（strict）、npm、Vite、Vitest
- ゲームロジック: Effect-TS（`Context.Tag`によるサービス、`Effect.gen`）。スキーマは Effect Schema
- 描画: Phaser（10×10グリッドの地図のみ）
- パネルUI: React（DOM）。新聞・側近報告・勅令入力・意図宣言・3段表示
- LLM: Mistral API（`mistral-small-latest`）を **プロキシ経由** のみで呼ぶ（Cloudflare Workers）
- セーブ: localStorage（JSON）。LLM会話履歴は保存しない
- 主要コマンド（P0で整備済み）:
  - `npm run dev`：Vite 開発サーバー
  - `npm run build`：型検査（`tsc -b`）＋本番ビルド
  - `npm run preview`：ビルド結果を配信（`npm run preview -- --port 4173` で `scripts/screenshots.cjs` の既定 URL）
  - `node scripts/screenshots.cjs [URL]`：ブラウザで1ゲーム通しで遊び、`docs/screenshots/` を撮り直す（環境の Playwright を使用）
  - `npm test`：Vitest（`src/**/*.test.ts(x)`）
  - `npx wrangler dev --port 8787`：LLM プロキシ（`src/proxy/worker.ts`）をローカルで起動。設定は `.dev.vars`（`.dev.vars.example` をコピー）。フロントは `.env.local`（`.env.example` をコピー）で接続先を指定し、未設定ならモック参謀。手順・障害の模擬・本番デプロイは `docs/DEPLOY.md`
  - `node scripts/fake-mistral.mjs [port]`：キーなしで結線を確かめるための偽 Mistral（LLM ではない）
  - `npm run typecheck`：`tsc -b --noEmit`
  - `npm run lint`：ESLint。`Math.random` 禁止、`src/domain` からの effect/phaser/react import 禁止を含む
  - `npm run sim -- [ゲーム数]`：ヘッドレスシミュレーション（既定1000ゲーム×3方策）。A-02 の合否（ヒューリスティック到達率）を PASS/FAIL で出力し、建物利用エントロピー・新聞の検閲削除率・イベント解決率なども出す。結果は `docs/BALANCE.md` §11（v3.1）・§28（v3.2＋v3.3）
  - `npm run terrain:check -- [シード数=1000] [並列数]`：地形 v2 の検証（建設可能性・川・街道・地名、生成時間）。不合格があれば終了コード1
  - `npm run terrain:preview -- [出力先] [saveId ...]`：地形の簡易プレビュー PNG
  - 地図の確認（開発用、環境の Playwright）。出力先の既定は `docs/screenshots/m1`〜`m4`：
    - `node scripts/terrain-browser.mjs`：ブラウザの Worker で地形の生成時間を測る（`terrain-dev.html`）
    - `npx tsx scripts/map-states.ts <out.json> [シード,...] [年数,...]` → `node scripts/map-browser.mjs <out.json> [出力先] [lite]`：測量図 L0〜L3 と地形模型を描いて撮り、見えない値だけを変えた状態と画素を比べる（`map-dev.html`）
    - `node scripts/map-interact.cjs [URL]`・`node scripts/relief-interact.cjs [URL]`：本番ビルド（`npm run preview -- --port 4173`）で手元の地図・地形模型を操作し、fps を測って撮る
- パッケージ管理は **npm に統一**（`package-lock.json` をコミットする。pnpm / yarn は使わない。依存の追加は `npm install <pkg>`、CI やクリーン環境では `npm ci`）
- バージョン固定（AMENDMENT A-10）：Effect `~3.22.4`、TypeScript `5.9.2`（完全固定）、Phaser `~4.2.1`。Effect 4.x は `Context.Tag` が廃止されているため使わない。理由は `docs/DECISIONS.md` D-56
- 机と書類: DOM + CSS 3D（perspective / rotateX / translateZ）。完全3D（Three.js）は使わない
- 地図: Phaser.CANVAS（AA-09）。地形生成と静的レイヤのベイクは Web Worker + OffscreenCanvas で行い、ImageBitmap を CPU 側の Canvas に写して使う。MapScene はゲームの Canvas に Canvas 2D で直接描く（DECISIONS BC-27・BC-37）。ノイズは simplex-noise（シード付き）、区画は d3-delaunay
- 地形模型（M4）: Canvas 2D の擬似3D（Three.js は承認がないので使わない。DECISIONS §17.12）
- 音: 小さな AudioService（Web Audio API）。素材は CC0 または自作のみ
- 追加の依存を入れるときは、名称・ライセンス・用途を docs/DECISIONS.md に記録して許可を得る

## 3. ディレクトリ構成
```
src/
  domain/    純粋な型と純粋関数（Effect非依存）
  services/  LLMService / SaveService / LogService / Rng（Context.Tag）
  engine/    DecreeParser, AideInterpreter, RuleEngine, IntentEvaluator,
             MapUpdater, Newspaper, TurnMachine
  ui/        scenes(Phaser) と panels(React)
  i18n/      messages.ts（全文言）
  proxy/     Mistralプロキシ（Workers）
  content/newspaper/  記事テンプレート（データとして分離、v3.2）
docs/        SPEC.md, SPEC_AMENDMENT_v3.1.md, SPEC_v3.2.md, DECISIONS.md, BALANCE.md
```
v3.2/v3.3 で追加するファイル（P1）：
```
src/domain/Buildings.ts        20 target enum（建物17＋政策3）の単一情報源（建設費・維持費・前提・効果・タイル・秘匿の建材表と工期）
src/domain/DerivedStats.ts     派生指標（住宅容量・食料・衛生・治安・行政能力）
src/domain/Construction.ts     工事台帳（案件・進捗）と労働・資材の割り振り（純粋関数）
src/domain/Events.ts           ランダムイベント3種（疫病・凶作・盗賊）の定義
src/engine/DerivedCalculator.ts
src/engine/NewspaperGenerator.ts   決定論の新聞生成（seed付きPRNG）
src/engine/IntentSchema.ts         action/target の Effect Schema と、そこから生成する JSON Schema（プロキシも使う）
```
表現層で追加するファイル（v3.3）：
```
src/ui/desk/          DeskStage, DeskObject, FocusLayer, lighting, objects/
src/ui/map/           terrain.worker, TerrainGenerator, ParcelMapper, RoadRouter, Toponyms, MapScene, MapSnapshot
src/ui/transitions/   TurnSequence
src/ui/audio/         AudioService
src/ui/settings/      平面モード、動きを減らす、音量、文字サイズ
src/domain/PlayerNotes.ts   メモ（ロジック非依存）
```
v3.4（地図リアリティ、SPEC_v3.4.md）で追加・変更するファイル（表現層のみ。M1〜M3）：
```
src/ui/map/terrain/       地形生成の純関数群（基礎地形・段丘・侵食・水文・地質・植生・街道。DOM 非依存）。terrain.worker は薄いラッパー
src/ui/map/cartography/   画法（レイヤ、ケバ・等高線、注記、紙の経年、ベイクの陰影、LOD、建物平面）
src/ui/map/ParcelMapper.ts, RoadRouter.ts   区画・道路の表示専用の写像（AA-10）
src/ui/game/projectMapView.ts  GameState → MapViewModel の投影（地図の描画層が受け取る唯一の入力。BB-11 で ui/game に置く。型は src/ui/map/MapViewModel.ts）
src/ui/map/MapScene.ts, MapSnapshot.ts   MapScene は M2 で src/ui/scenes/ から移設済み（AA-15）。MapSnapshot は M3
src/ui/map/model3d/       地形模型（M4。ReliefMesh：形の純関数、ReliefModel：擬似3Dの描画）
src/ui/notes/notesStore.ts   書き付け（PlayerNotes）の保存（セーブとは別のキー。AA-11）
```

## 4. アーキテクチャ上の不変条件（破らない）
1. **状態を変更できるのはルールエンジンだけ。** LLMの出力は「提案」であり、検証・サニタイズ後にのみ使う。LLM出力で直接 `GameState` を書き換えない。
2. **LLMの責務は翻訳層のみ**（勅令→`DecreeIntent` JSON）。数値更新・歪み・新聞生成にLLMを使わない（新聞はテンプレ＋スロット）。
3. **決定論性**：乱数は `Rng` サービス経由（seed付き）。同じ seed・同じ入力・同じLLM出力なら同じ結果になること。`Math.random()` 直呼び禁止。
4. **`domain/` は純粋**。Effect・DOM・Phaser・fetchをimportしない。
5. **UIにゲームロジックを書かない。** UIは `TurnMachine` を呼んで状態を描画するだけ。
6. **文言は全て `i18n/messages.ts`**（新聞の記事テンプレートだけは `src/content/newspaper/` のデータ。DECISIONS I-15）。UIやエンジンに日本語リテラルを直書きしない。
7. **バランス値は `domain/constants.ts` に集約**。マジックナンバー禁止（歪み確率、税率、人口増加率、ボーナス量、文字数上限など）。
8. **LLM障害時もゲームを止めない**：タイムアウト5秒、リトライ2回（指数バックオフ）、失敗時はテンプレートパーサーにフォールバック。
9. **APIキーをフロントに置かない。** JSON Schemaはプロキシ側で固定し、フロントから改ざんできない構造にする。
10. 勅令テキストを**システムプロンプトに連結しない**。ユーザー入力として分離し、メタ命令（「官僚を無視せよ」等）はルールエンジン側でサニタイズ。`target` は許可リストで検証し、未知の値は no-op＋側近報告で「意味が取れなかった」と返す。
11. target enum（20種）は `domain/Buildings.ts` を単一情報源とし、Effect Schema・Structured Outputs の JSON Schema・プロキシ・UIのラベルをそこから生成する。手書きで複製しない。
12. 新聞はLLMを使わない。seed = hash(saveId, turn)。同じ saveId・turn・状態なら同一紙面。継続スレッドの進行と直近3ターンの使用テンプレートは GameState に保存する。
13. **UI に出さないもの**：派生指標（住宅容量・食料・衛生・治安・行政能力）、`NewspaperArticle.truthfulness`、**建物の建材表と工期（v3.3）、資材（木材・石材）の在庫（v3.3）**。常時表示するのは台帳の6項目（人口・国庫・幸福度・インフラ・汚職率・政治資本。I-31）のみ。労働人口は台帳に出さない。秘匿値は新聞と側近報告でしか知れない。
14. 派生指標・資材の在庫は max(0, …) でクランプする。
15. action × target の有効組合せ表を domain に定義し、無効・前提未達は国庫を消費せず no-op＋側近報告で理由を返す。
16. 記事テンプレートは data として src/content/ に置き、スロットは型付き。未定義スロットは Effect.die。
17. **建設には工期がある（v3.3）。** 勅令は「発注」で、効果は完成した年から。労働と資材の割り振りはルールエンジンの純粋関数で行い、乱数は Rng 経由（決定論を保つ）。ランダムイベントの発生も Rng 経由。表現層は GameState を読むだけで、書き込まない。書き込めるのは PlayerNotes と設定のみ。
18. 地形は seed = hash(saveId, "terrain") から決定論的に生成する。セーブには seed のみ保存し、ロード時に再生成する。Math.random() 禁止。
19. 論理グリッド100区画は全て建設可能であることを保証する。地形は村域の外側にのみ効かせ、バランスを変えない。
20. 地名一覧は新聞生成（NewspaperGenerator）より前に確定させ、新聞の {place} は地名一覧からのみ埋める。
21. 地図に描いてよいのは visual_state（完成した建物の種類・数・位置、普請中の有無）のみ。空洞は地図に一切出さない（I-32。亀裂印・注記は廃止）。進捗・工期・建材も出さない。
22. 派生指標・truthfulness・信頼性は、机・地図・書類のどこにも表示しない（インクの滲み等で暗示してもよいが、数値化しない）。
23. 平面モード（3D無効）を常に動作させ続ける。3D・平面で表示される情報は同一にする。
24. 色だけで意味を伝えない。朱の差分には必ず線・印を併用する。prefers-reduced-motion に追従する。
25. 手元（FocusLayer）の文字と入力は変形なし（transform: none）で描画する。遠近変形下に入力欄を置かない。
26. 地図の描画層（`src/ui/map/`）は `GameState`・`DerivedStats`・`Construction`・`Events` を import しない。専用の投影型 `MapViewModel` だけを受け取る。ESLint の `no-restricted-imports` で強制する。
27. 地形生成（`src/ui/map/terrain/`）は DOM に依存しない純関数とし、Worker は薄いラッパーにする。Node 環境の Vitest で単体テストする。
28. 地図の区画の割当・道路の本数（W-09, I-16, I-39）は変えない。地図の見た目は `ParcelMapper` と `RoadRouter` が表示専用で担う（AA-10）。
29. 地形生成が未完了・失敗のときは、既存の抽象10×10グリッド描画にフォールバックする。

## 5. 仕様の要点（詳細は SPEC.md）
- 1ターン=1年。勅令は1ターン1つ。文字数 `text.length + tags.length*5 <= 40`（2026-10-25 のユーザー指示で A-06 を改定：DECISIONS I-30。タグは「対象」「規模」「期限」「優先度」の4種、各1個、1つ5文字。期限・優先度は参謀への添え書きで執行に効果はない。本文は D-31 どおりコードポイントで数える）。残り文字数を常時表示。
- 意図宣言は任意。達成時のみボーナス **幸福度+5**（A-01。ペナルティなし）。判定は宣言値と実パラメータ変化の単純比較のみ。
- 結果は **3段表示＋意図比較**（参謀の解釈 / 側近による補正 / 実際の結果 / 意図比較）。「側近による補正」には**選ばれた側近と選定理由**、予算不足による縮小率を出す（A-05, A-07）。
- 政治資本：初期3、**+1/ターン、上限5**、勅令-1・任命-1（A-01）。担当側近は自動選択（専門一致→信頼順。A-05）。
- `target` は20種の固定 enum（建物17＋政策3。`domain/Buildings.ts` が単一情報源。不変条件11。当初の8種〔A-03〕は v3.2 で拡張）。LLM には勅令本文とタグのみ渡し、GameState は渡さない（A-09）。
- 側近は2人固定（A:老練な代官、B:若い商人上がり。初期値は SPEC 7.5）。手動介入は任命/解任のみ。
- エンディング：人口0 / 国庫マイナス / 幸福度0 でゲームオーバー、人口300＋インフラ25＋役所で成功、50ターンで失敗。
- 地図は自動配置。道路は中央の十字（最大19区画）に `floor(インフラ/5)` 本を描き区画を占めない（I-16）。建物は建てたときに区画を決めて GameState に保存し、空き区画を中央に近い順に並べ、カテゴリ優先順位ごとに3区画ずつ外へずらした帯から選ぶ（W-09, I-39）。プレイヤーは区画を指定できない。

## 6. 既知の曖昧点（初期推奨案）
既知の論点は docs/SPEC_v3.2.md §5（15件）と、v3.0用の論点（政治資本、更新式、歪み係数など）。SPEC_v3.3.md §14 の未決事項（筆書き風書体、しっぽり明朝B1・Klee Oneのライセンス確認、絵記号のデザイン、地図の表題、測量の遅れの採否、Tauri での WebGL/Worker 動作）も含む。P0で docs/DECISIONS.md に統合し、承認を取ること。

## 7. テスト方針
- `engine/` と `domain/` は単体テスト必須。特に: 文字数検証、`accuracy`式、各歪み、エンディング判定と優先順位、意図判定、地図の自動導出、seed再現性。
- LLMは必ずモック。フォールバック経路（タイムアウト/不正JSON/スキーマ違反）もテストする。
- ゲームを1本通すヘッドレスシミュレーション（ランダム勅令）で、到達率・ゲームオーバー率を出せるスクリプトを用意（`npm run sim`）。判定は **ヒューリスティック方策の到達率70〜90%**（A-02 の主指標）。ゲームオーバー率20〜40%は sim の合否に使わず、人間のプレイ（P4）で測る（DECISIONS P-08 / W-15、2026-10-25 承認）。ランダム勅令の結果は参考値。方策の定義は `docs/BALANCE.md` §9（v3.3 版は §27）。人間の初見到達率50〜70%はP4で実測。
- 派生指標・資材の在庫が負にならない（property-based）
- 20 enum 全てが Structured Outputs のスキーマ検証を通る（単一情報源から生成したスキーマで）
- テンプレートの全スロットが埋まる／未定義スロットで Effect.die
- 同一seedで同一紙面（決定論）
- 偏向変換後も本文が空にならない
- 前提未達（役所なしの裁判所、見張り塔なしの牢屋、人口<200の屋敷）が no-op になる
- 工事：工期より早く完成しない／労働の割り振りが需要に比例する／超過・資材不足で空洞化の確率が上がる（v3.3）
- ランダムイベント：発生・解決・放置の後遺症が決定論的に再現する（v3.3）
- 地形の決定論（同じ saveId で TerrainData のハッシュが一致）
- 地図（v3.4）：村域100区画が全て建設可能（水域でなく slope ≤ 5°。`npm run terrain:check`）／本通り（十字の区画）が連続した帯になり、道路の描画本数が `floor(インフラ/5)` と一致／`MapViewModel` が空洞・進捗・資材・イベントを含まない（それだけが違う2状態から同じ `MapViewModel` が得られる）／`src/ui/map/` が禁止モジュールを import していない／地形生成の失敗・タイムアウト時に抽象グリッドへフォールバックする
- 村域100区画が全て建設可能（水・急傾斜を含まない）／区画多角形が重ならず隙間がない
- 道路が区画内部を横切らない
- 地名の一意性、新聞の {place} が地名一覧から埋まる
- 平面モードと3Dモードで表示情報が同一
- prefers-reduced-motion で遷移演出が短縮される
- UI のコンポーネントテストは Vitest + Testing Library。視覚の確認は docs/screenshots/ のスクリーンショットで行う

## 8. UI・アセット
- コンセプト「机の上の書類と、広げた地図」。配色とフォントは SPEC 12.3 / 12.4 に従う（純色禁止、朱色のみアクセント）。
- P0で実装するのは判子アニメ（CSS transition）と紙のフェードのみ。
- アセットは **OFL または CC0 のみ**。ライセンス不明の素材は使わない。出典は `docs/ASSETS.md` に記録。

## 9. 作業ルール
- フェーズ（P1→P2→P3）ごとに完了条件を満たしたら止まって報告する。次フェーズに勝手に進まない。
- コミットは小さく、1コミット1目的。
- **破壊的な操作（rm、強制上書き、`git reset --hard`、ブランチ削除など）は、非破壊コマンドと同じブロックに混ぜない。** 1つずつ分けて提示し、ユーザーの明示的な承認を得てから実行する。
- 不明点が出たら、手を止める前に「選択肢と推奨案」をまとめて質問する（1回にまとめる）。
- コメント・コミットメッセージ・報告は日本語。識別子は英語。
- 視覚・体感に関わる作業は、実装後に必ずスクリーンショットと短い自己レビュー（読みにくさ、操作の引っかかり、性能）を報告する。性能は FPS オーバーレイ（開発用）で計測し、数値を報告する。

## 10. やらないこと（P0スコープ外）
イベントシステム（**ただし v3.3 のランダムイベント3種は対象**）／複数新聞／官僚機構（官僚を個別の人物として作ること。v3.3 の労働・資材の割り振りは側近配下の抽象的な仕組みとして作る）／教育・監査・派閥工作／ジオラマ・霧／Tauri・Steamworks／英独中の多言語／ローカルLLM／課金要素／区画の手動指定／bridge・mill（P0.5以降）／動的な偏向値／100本以上のテンプレート。
Three.js による完全3D／側近ごとの書体の差（P0）／モバイル対応も対象外。Three.js による地形模型（SPEC_v3.4 §10）は M4 として任意・要承認（BB-04）で、P0 のスコープ外は変えない（M4 は Three.js の承認がないので Canvas 2D の擬似3D で実装した。`src/ui/map/model3d/`、DECISIONS §17.12）。測量の遅れ（SPEC_v3.3 §5.9）は既定無効のフラグとしてのみ扱う。
