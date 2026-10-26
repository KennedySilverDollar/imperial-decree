# docs/handoff — 引き継ぎ文書（他の Claude Code・開発者向け）

勅令都市（仮）の作業を引き継ぐための文書一式です。**コードから事実を抜き出して書いてあり、2026-10-26 時点（ブランチ `p2/v3.2-ui`）で正確**です。コードと食い違ったらコードが正で、文書を直してください。

## 1. 読む順番

| 順 | 文書 | 読む理由 |
|----|------|----------|
| 1 | [`/CLAUDE.md`](../../CLAUDE.md) | 機械的に読まれる正式な指示書（不変条件・コマンド・作業ルール） |
| 2 | [`DEV_RULES.md`](DEV_RULES.md) | **製作ルール**。守る作り方の全記録（不変条件17項目・作業ルール・規約・テスト・手順・環境の落とし穴） |
| 3 | [`REQUIREMENTS.md`](REQUIREMENTS.md) | **機能要件書**。何を満たすべきか（要件 ID・受け入れ基準・実装状況・KPI・次の候補） |
| 4 | [`SPECIFICATION.md`](SPECIFICATION.md) | **実装仕様書**。今のコードの挙動（ターンの流れ・式・全定数・建物表・新聞・プロキシ API・診断画面・既知の差異） |
| 5 | [`/README.md`](../../README.md) | **README**。構築手順・コマンド・環境変数・遊び方・現状 |

経緯や却下案を知りたいときだけ `docs/DECISIONS.md`（論点と決定の台帳）、バランスの根拠は `docs/BALANCE.md`、LLM プロキシの運用は `docs/DEPLOY.md`、素材は `docs/ASSETS.md`。原典の仕様は `docs/SPEC.md`（v3.0）→ `docs/SPEC_AMENDMENT_v3.1.md` → `docs/SPEC_v3.2.md`（後ろほど優先。さらに `DECISIONS.md §12` の v3.3 が最優先）。

## 2. 現状（2026-10-26）

- **ブランチ**: 最新は **`p2/v3.2-ui`**（`p0/decisions-and-scaffold`・`p0.5/spec-v3.2-review`・`p1/core-engine`・`p1/v3.2-core`・`p2/ui`・`p3/llm-proxy` を全て含む）。ローカルの `main` は古い。**PR は未作成**（依頼があるまで作らない）。
- **品質ゲート**: `npm test` 237件通過（24ファイル）／`npm run typecheck`／`npm run lint`／`npm run build` すべて通過。
- **sim**（各1000ゲーム）: ヒューリスティック 到達 **82.8%**（合否の基準 70〜90% → PASS）、ゲームオーバー 11.1%（参考。人間のプレイで測る）。
- **できている**: 20 target（建物17＋政策3）、派生指標、新聞 v2（28テンプレート・3層の偏向・継続スレッド・投書による空洞のにおわせ）、工期・労働人口・秘匿資材・見かけ倒し（空洞）、イベント3種、台帳6項目、地図（カテゴリ色＋1文字記号）、3段表示、LLM プロキシ、AI診断画面（`/?debug`）、計測ログ。
- **未確認・未着手**: 実 Mistral での動作（Structured Outputs・価格・所要時間）、人間のプレイテスト（P4）、自己レビューで挙がった改善候補（[`REQUIREMENTS.md §6`](REQUIREMENTS.md)）、仕様・文書間の既知の差異（[`SPECIFICATION.md §19`](SPECIFICATION.md)）。

## 3. 最短の始め方

```sh
git checkout p2/v3.2-ui
npm ci
npm test && npm run typecheck && npm run lint     # まず緑であることを確認
npm run dev                                       # http://localhost:5173（/?debug が AI診断画面）
```

## 4. 作業の種類ごとの入口

| やること | まず読む | 触るファイル | 終わったら |
|----------|----------|--------------|------------|
| 「AI が動かない」を調べる | `SPECIFICATION.md §17.1`、`docs/DEPLOY.md §1.5` | `/?debug` を開く。コードは `engine/LLMDiagnostics.ts`、`ui/panels/DebugPanel.tsx` | 原因と対処を記録 |
| バランス調整 | `DEV_RULES.md §4.2`、`docs/BALANCE.md §28` | `domain/constants.ts`、`domain/Buildings.ts`（定数だけ） | `npm run sim`、`BALANCE.md` に履歴 |
| 建物・政策を足す | `SPECIFICATION.md §10`、`DEV_RULES.md §11` | `domain/Buildings.ts`（単一情報源）→ `messages.ts` → 新聞テンプレート → テスト | `DECISIONS.md` に論点を先に書く |
| 新聞の記事を足す・直す | `SPECIFICATION.md §13` | `content/newspaper/ja.ts`（データ）、必要なら `engine/NewspaperGenerator.ts` のトリガー | `NewspaperTemplates.test` が検証する |
| 文言を直す | `DEV_RULES.md §4.1` | `i18n/messages.ts` | 日本語直書き検出コマンド |
| UI を直す | `DEV_RULES.md §6`、`SPECIFICATION.md §17` | `ui/panels/*`、`ui/styles.css` | `node scripts/screenshots.cjs` で実ブラウザ確認 |
| 仕様の食い違い・曖昧さを見つけた | `DEV_RULES.md §1.1` | `docs/DECISIONS.md`（論点・選択肢・推奨案） | 承認を得てから実装 |

## 5. 用語

| 用語 | 意味 |
|------|------|
| 勅令 | プレイヤーが書く自然文（40字以内、タグつき）。唯一の干渉手段 |
| 参謀 | LLM（失敗時はテンプレートパーサー）。勅令を `DecreeIntent` に翻訳するだけ |
| 側近 | 勅令を執行する人物（最大2人）。解釈を歪め、報告で隠す・欠かす |
| 台帳 | 常時見える6項目（人口・国庫・幸福度・インフラ・汚職率・政治資本） |
| 派生指標 | 住宅容量・食料・衛生・治安・行政能力。見えない |
| 発注 / 工事 / 工期 | 建物は発注すると工事台帳に載り、数年かけて完成する（v3.3） |
| 労働人口・資材 | 秘匿の値。工事の速さと質（見かけ倒しの確率）を決める |
| 空洞（hollow）/ 見かけ倒し | 建っているが効果ゼロ・維持費は払う建物。地図には出ない |
| 骨抜き | 側近が派閥の意に反する指示を、建物の半数を見かけ倒しにして実行すること |
| 三角測量 | 新聞（投書）・側近報告・地図を突き合わせて真実に近づくこと。このゲームの遊びの核 |
| 3段表示 | 結果画面（参謀の解釈／側近による補正／実際の結果）＋意図比較 |
| 意図宣言 | 勅令の余白に書く任意の目標。達成で幸福度+5 |
| A-xx / D-xx / I-xx / V-xx / Z-xx | `docs/DECISIONS.md` の ID（決定・論点の台帳） |
