# CLAUDE.md — 勅令都市（仮）P0プロトタイプ

## 0. このプロジェクトは何か
- 都市開発シム × 官僚マネジメント × AI解釈ゲーム。プレイヤーは都市を直接操作できず、**勅令（自然言語）→ 参謀(LLM)の解釈 → 側近による歪み → ルールエンジンの決定論的更新**の経路でのみ干渉する。
- 今回作るのは **ブラウザ向けP0プロトタイプのみ**（村→町、30〜50ターン）。目的は中核仮説の検証：「信頼性が曖昧な情報を反芻して勅令を出す難しさは面白いか」。
- 製品版機能（イベント、複数新聞、官僚機構、Tauri、多言語、霧など）は**作らない**。

## 1. 正典と優先順位
1. 正典は docs/ 内の仕様書と、DECISIONS.md の承認済み決定。優先順位は **DECISIONS.md §12 のユーザー指示（v3.3：工期・労働人口・秘匿資材・ランダムイベント） > `docs/SPEC_v3.2.md` > `docs/SPEC_AMENDMENT_v3.1.md`（v3.1。A-01〜A-10） > `docs/SPEC.md`（v3.0）**。v3.2 が明示的に上書きしていない v3.1 の決定は有効（A-06 のタグ仕様は I-30 で改定済み）。
2. 仕様が曖昧・矛盾・未定義のときは**推測で実装せず** `docs/DECISIONS.md` に論点と推奨案を書き、ユーザーの承認を得てから進む（軽微なものは推奨案で進めて記録だけ残してよい）。v3.2 の既知の論点は DECISIONS.md §11（V/X/W）、v3.3 は §12。
3. 仕様を変える提案は `docs/DECISIONS.md` に「仕様変更提案」として分けて書く。勝手に変更しない。

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
- パッケージ管理は **npm に統一**（`package-lock.json` をコミットする。pnpm / yarn は使わない。依存の追加は `npm install <pkg>`、CI やクリーン環境では `npm ci`）
- バージョン固定（AMENDMENT A-10）：Effect `~3.22.4`、TypeScript `5.9.2`（完全固定）、Phaser `~4.2.1`。Effect 4.x は `Context.Tag` が廃止されているため使わない。理由は `docs/DECISIONS.md` D-56

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
13. **UI に出さないもの**：派生指標（住宅容量・食料・衛生・治安・行政能力）、`NewspaperArticle.truthfulness`、**建物の建材表と工期（v3.3）、資材（木材・石材）の在庫（v3.3）**。常時表示するのは台帳（人口・国庫・幸福度・インフラ・汚職率・政治資本・**労働人口**）のみ。秘匿値は新聞と側近報告でしか知れない。
14. 派生指標・資材の在庫は max(0, …) でクランプする。
15. action × target の有効組合せ表を domain に定義し、無効・前提未達は国庫を消費せず no-op＋側近報告で理由を返す。
16. 記事テンプレートは data として src/content/ に置き、スロットは型付き。未定義スロットは Effect.die。
17. **建設には工期がある（v3.3）。** 勅令は「発注」で、効果は完成した年から。労働と資材の割り振りはルールエンジンの純粋関数で行い、乱数は Rng 経由（決定論を保つ）。ランダムイベントの発生も Rng 経由。

## 5. 仕様の要点（詳細は SPEC.md）
- 1ターン=1年。勅令は1ターン1つ。文字数 `text.length + tags.length*5 <= 40`（2026-10-25 のユーザー指示で A-06 を改定：DECISIONS I-30。タグは「対象」「規模」「期限」「優先度」の4種、各1個、1つ5文字。期限・優先度は参謀への添え書きで執行に効果はない。本文は D-31 どおりコードポイントで数える）。残り文字数を常時表示。
- 意図宣言は任意。達成時のみボーナス **幸福度+5**（A-01。ペナルティなし）。判定は宣言値と実パラメータ変化の単純比較のみ。
- 結果は **3段表示＋意図比較**（参謀の解釈 / 側近による補正 / 実際の結果 / 意図比較）。「側近による補正」には**選ばれた側近と選定理由**、予算不足による縮小率を出す（A-05, A-07）。
- 政治資本：初期3、**+1/ターン、上限5**、勅令-1・任命-1（A-01）。担当側近は自動選択（専門一致→信頼順。A-05）。
- `target` は8種の固定 enum：residential / road / well / office / market / tax / welfare / security（A-03）。LLM には勅令本文とタグのみ渡し、GameState は渡さない（A-09）。
- 側近は2人固定（A:老練な代官、B:若い商人上がり。初期値は SPEC 7.5）。手動介入は任命/解任のみ。
- エンディング：人口0 / 国庫マイナス / 幸福度0 でゲームオーバー、人口300＋インフラ25＋役所で成功、50ターンで失敗。
- 地図は自動配置（役所→道路→住宅→空き地）。プレイヤーは区画を指定できない。

## 6. 既知の曖昧点（初期推奨案）
以下は v3.0/v3.1 向けの初期論点（すべて決着済み。経緯は DECISIONS.md）。v3.2 の論点は DECISIONS.md §11、v3.3 は §12。

| # | 論点 | 推奨案 |
|---|------|--------|
| 1 | 政治資本の扱い | ~~毎ターン+3、上限10~~ → **A-01：+1/ターン、上限5、繰越あり** |
| 2 | 意図達成ボーナス | ~~政治資本+1~~ → **A-01：幸福度+5に固定** |
| 3 | 意図達成の判定 | increase/decrease は変化量が目標以上、absolute は到達値で判定 |
| 4 | LLMスキーマの `appoint`/`dismiss` | P0では手動介入のみなので、受けても no-op 扱い |
| 5 | `target` が自由文字列 | ~~当初案~~ → **A-03：residential/road/well/office/market/tax/welfare/security の8種enumに固定** |
| 6 | 汚職率の効果（村には官僚がいない） | 税収を汚職率%分目減りさせる。数値は定数 |
| 7 | 人口・税収・幸福度の更新式 | 未定義。`docs/BALANCE.md` に案を書いて承認を得る |
| 8 | 歪み(6.4)の発生確率・係数 | 未定義。`accuracy`式(7.6)を基に定数化し、BALANCEに記載 |
| 9 | 新聞の偏向度30の意味 | 報告数値に±30%以内のノイズ＋論調語の偏り |
| 10 | 勝敗同時成立時の優先 | ゲームオーバー優先 |
| 11 | 役所の建築条件・費用 | 未定義。BALANCEで提案 |
| 12 | Mistralの価格・Structured Outputsの制約（min/max対応等） | 未確認（環境から公式サイトに接続できず）。P3で確認。SPECの価格記載は要検証 |

新規論点（住宅区画の定義 N-01 など）は `docs/DECISIONS.md` §6。承認済みの行は DECISIONS の状態欄を参照。

SPECの誤記（`###汚職`、`6計画`、`.1 入力仕様`の章番号など）は製品版項目か表記ゆれなので、実装には影響させない。

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

## 10. やらないこと（P0スコープ外）
イベントシステム（**ただし v3.3 のランダムイベント3種は対象**）／複数新聞／官僚機構（官僚を個別の人物として作ること。v3.3 の労働・資材の割り振りは側近配下の抽象的な仕組みとして作る）／教育・監査・派閥工作／ジオラマ・霧／Tauri・Steamworks／英独中の多言語／ローカルLLM／課金要素／区画の手動指定／bridge・mill（P0.5以降）／動的な偏向値／100本以上のテンプレート。
