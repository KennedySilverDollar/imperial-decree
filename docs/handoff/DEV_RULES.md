# DEV_RULES.md — 勅令都市（仮）製作ルール

> このプロジェクトで**守る作り方**の全記録です。他の Claude Code が作業を引き継ぐとき、最初にこれと `CLAUDE.md` を読んでください。
> `CLAUDE.md` が機械的に読まれる正式な指示書で、本書はそれを**網羅・補足**したものです（食い違ったら `CLAUDE.md` が優先。ただし `CLAUDE.md` が古い場合は直す）。
> 何を作るか → `REQUIREMENTS.md`　挙動の詳細 → `SPECIFICATION.md`　入口 → `README.md`

---

## 1. 読む順番と正典

1. `CLAUDE.md`（指示書）→ 本書 → `REQUIREMENTS.md` → `SPECIFICATION.md`。
2. 仕様の正典の優先順位（上が強い）:
   **`docs/DECISIONS.md §12`（v3.3：ユーザー指示）＞ `docs/SPEC_v3.2.md` ＞ `docs/SPEC_AMENDMENT_v3.1.md`（A-01〜A-10）＞ `docs/SPEC.md`（v3.0）**。
   上位が明示的に上書きしていない下位の決定は有効。改定された項目は `DECISIONS.md` の該当 ID が最新（例: タグ仕様 A-06 → `I-30`、台帳の労働人口 `Z-02` → `I-31`）。
3. 関連文書: `docs/BALANCE.md`（全バランス値の式・根拠・sim の結果と調整履歴）、`docs/DEPLOY.md`（プロキシとフロントの動かし方）、`docs/ASSETS.md`（素材の出典）、`docs/screenshots/`。

### 1.1 仕様が曖昧・矛盾・未定義のとき

**推測で実装しない。** `docs/DECISIONS.md` に「論点・選択肢・推奨案」を書き、ユーザーの承認を得てから進む。軽微なものは**推奨案で進めて記録だけ残してよい**（状態欄に「記録のみ」「承認（推奨案・日付）」）。

- 仕様を**変える**提案は「仕様変更提案」として分けて書く。勝手に変えない。
- 不明点が出たら、手を止める前に「選択肢と推奨案」を**1回にまとめて**質問する（1つずつ小出しにしない）。
- ユーザーの指示が承認済みの決定と**食い違う**ときは、黙って片方に寄せず、食い違いを示して選んでもらう（例: タグ仕様 `U-01`/`I-30`、台帳の労働人口 `I-31`）。ユーザーが選んだら `DECISIONS.md` に ID を付けて記録し、`CLAUDE.md` も直す。
- `DECISIONS.md` の ID 体系: `A-xx`（v3.1 差分仕様）／`D-xx`（P0 の設計判断）／`N-xx`（P0 の新規論点）／`I-xx`（実装中の判断。P1・P2 以降も連番）／`U-xx`（UI）／`L-xx`（LLM・プロキシ）／`P-xx`（仕様変更提案）／`V-xx` `W-xx` `X-xx`（v3.2）／`Y-xx` `Z-xx`（v3.3）。**表の行を追記して連番を続ける**（欠番・重複を作らない）。

---

## 2. 作業ルール

### 2.1 フェーズと報告
- **フェーズごとに完了条件を満たしたら止まって報告する。次フェーズに勝手に進まない。**
- 報告は日本語。「できたこと」「確認した方法」「判断したこと」「未確認・制約」「自己レビュー」を正直に書く。**失敗・未実施・未確認は隠さない**（テストが落ちたら出力つきで、省いた手順は省いたと）。

### 2.2 コミット
- **コミットは小さく、1コミット1目的。**
- **コメント・コミットメッセージ・報告・ドキュメントは日本語。識別子は英語。**
- コメントは周囲のコードの密度と書き方に合わせる（「なぜ」を書く。DECISIONS の ID を引くことが多い）。
- コミットの末尾に、セッションの指示にある帰属行（`Co-Authored-By: ...`、`Claude-Session: ...`）を付ける。
- **コミット・push はユーザーの依頼（またはフェーズ完了の指示）に従って行う。** **PR はユーザーが明示的に求めるまで作らない。**
- push は `git push -u origin <branch>`。ネットワーク失敗のときだけ 2s/4s/8s/16s で最大4回リトライ。

### 2.3 破壊的な操作
- **`rm`・強制上書き・`git reset --hard`・ブランチ削除などは、非破壊コマンドと同じブロックに混ぜない。** 1つずつ分けて提示し、**ユーザーの明示的な承認**を得てから実行する（過去に `rm` を他のコマンドと混ぜてブロックされた）。
- 削除したいものは、まず上書き・再エクスポート・無視（`.gitignore`）で済まないかを考える。
- 外部サービスへの変更（デプロイ・Cloudflare・Mistral の設定変更など）は**実行前にユーザーに確認**する。

### 2.4 秘密情報
- **シークレット（`MISTRAL_API_KEY`・`PROXY_TOKEN`）は絶対にコミットしない。** ローカルは `.dev.vars` / `.env.local`（どちらも `.gitignore` 済み。**中身を表示・コピー・ログに出さない**）、本番は `wrangler secret`。
- `.env.example` / `.dev.vars.example` だけがコミット対象。診断画面・レポートではトークンを先頭2文字と長さに伏せる。

### 2.5 パッケージ管理
- **npm に統一**（`package-lock.json` をコミット。pnpm / yarn は使わない）。依存の追加は `npm install <pkg>`、クリーン環境では `npm ci`。`packageManager` は `npm@10.9.4`。
- 指示文に `pnpm test` などとあっても `npm test` に読み替える（`I-22`）。
- **バージョン固定**（A-10）: Effect `~3.22.4`（`Context.Tag` を使うため Effect 4.x は不可。`D-56`）、TypeScript `5.9.2`（完全固定）、Phaser `~4.2.1`。Playwright は**環境のものを使い、プロジェクトの依存に入れない**。

---

## 3. アーキテクチャ上の不変条件（破らない）

`CLAUDE.md §4` の17項目。違反は**バグ**として扱う。

1. **状態を変更できるのはルールエンジンだけ。** LLM の出力は「提案」で、検証・サニタイズ後にのみ使う。LLM 出力で直接 `GameState` を書き換えない。
2. **LLM の責務は翻訳層のみ**（勅令 → `DecreeIntent` JSON）。数値更新・歪み・新聞生成に LLM を使わない（新聞はテンプレ＋スロット）。
3. **決定論性**: 乱数は `Rng` サービス経由（seed 付き）。同じ seed・同じ入力・同じ LLM 出力なら同じ結果。**`Math.random()` 直呼び禁止**（eslint で強制）。
4. **`domain/` は純粋。** Effect・DOM・Phaser・fetch を import しない（eslint で強制）。`Option` の代わりに `T | null`。
5. **UI にゲームロジックを書かない。** UI は `TurnMachine`（`ui/runtime.ts` 経由）を呼んで状態を描画するだけ。
6. **文言は全て `i18n/messages.ts`。** UI やエンジンに日本語リテラルを直書きしない。**例外は新聞の記事テンプレートだけ**（`src/content/newspaper/` のデータ。`I-15`）。
7. **バランス値は `domain/constants.ts` に集約。** マジックナンバー禁止（歪み確率・税率・人口増加率・ボーナス量・文字数上限など）。建物ごとの数値表は `domain/Buildings.ts`。
8. **LLM 障害時もゲームを止めない**: タイムアウト5秒・リトライ2回（指数バックオフ）・失敗時はテンプレートパーサー。
9. **API キーをフロントに置かない。** JSON Schema はプロキシ側で固定し、フロントから改ざんできない構造にする。
10. 勅令テキストを**システムプロンプトに連結しない**。ユーザー入力として分離し、メタ命令（「官僚を無視せよ」等）はルールエンジン側でサニタイズ。`target` は許可リストで検証し、未知の値は no-op＋側近報告で「意味が取れなかった」と返す。
11. **target enum（20種）は `domain/Buildings.ts` が単一情報源。** Effect Schema・Structured Outputs の JSON Schema・プロキシ・UI のラベルをそこから生成する。手書きで複製しない。
12. **新聞は LLM を使わない。** seed = hash(saveId, turn)。同じ saveId・turn・状態なら同一紙面。継続スレッドの進行と直近3ターンの使用テンプレートは GameState に保存する。
13. **UI に出さないもの**: 派生指標（住宅容量・食料・衛生・治安・行政能力）、`NewspaperArticle.truthfulness`、建物の建材表と工期、資材（木材・石材）の在庫。**常時表示するのは台帳6項目（人口・国庫・幸福度・インフラ・汚職率・政治資本）のみ**（労働人口も出さない。`I-31`）。秘匿値は新聞と側近報告でしか知れない。
14. 派生指標・資材の在庫は `max(0, …)` でクランプする。
15. **action × target の有効組合せ表を domain に定義**し、無効・前提未達は**国庫を消費せず** no-op＋側近報告で理由を返す。
16. 記事テンプレートは data として `src/content/` に置き、スロットは型付き。**未定義スロットは `Effect.die`**。
17. **建設には工期がある（v3.3）。** 勅令は「発注」で、効果は完成した年から。労働と資材の割り振りはルールエンジンの純粋関数で行い、乱数は Rng 経由。ランダムイベントの発生も Rng 経由。

### 3.1 層と依存の向き

```
src/
  domain/    純粋な型と純粋関数（Effect 非依存）   ← 何にも依存しない
  services/  LLMService / SaveService / LogService / Rng（Context.Tag）   ← domain に依存
  engine/    DecreeParser, AideInterpreter, RuleEngine, IntentEvaluator, MapUpdater,
             NewspaperGenerator, TurnMachine, LLMDiagnostics ...   ← domain・services に依存
  ui/        scenes(Phaser) と panels(React)   ← engine・domain に依存（ロジックは持たない）
  i18n/      messages.ts（全文言）
  proxy/     Mistral プロキシ（Workers。domain の定数・語彙を共有）
  content/newspaper/  記事テンプレート（データ）
```
逆向き（domain → engine など）の import をしない。

---

## 4. コーディング規約

- **TypeScript strict**（加えて `exactOptionalPropertyTypes`・`noUncheckedIndexedAccess`・`noUnusedLocals/Parameters`・`verbatimModuleSyntax`）。`any` を使わない。
- **Effect**: サービスは `Context.Tag`、ロジックは `Effect.gen`。リトライで毎回サービスを呼び直すには `Effect.suspend` で包む（そうしないと先に作った結果が使い回される）。スキーマは Effect Schema。
- 状態は**不変オブジェクト**として扱い、更新は新しいオブジェクトを返す。
- 網羅を型で保証する（`satisfies Record<Target, string>`、`as const`）。新しい target・イベント・セクションを足したら、コンパイルエラーが「直す場所」を教える設計にする。
- 数値の端数: 人口の切り捨ては `stableFloor`（浮動小数の誤差で1人減るのを防ぐ）。
- 浮動小数の比較・clamp は `domain/math.ts` を使う。
- 名前は英語、意図が分かる長さで。ファイルは役割ごとに1つ（`engine/Xxx.ts` と `engine/Xxx.test.ts` を並べる）。
- eslint の方針に従う（`npm run lint`）。無効化コメントで黙らせない。

### 4.1 文言の置き場
- 画面・側近報告・3段表示・エラー・診断画面のヒントなど、プレイヤー（または開発者）が読む日本語は**すべて `i18n/messages.ts`**。関数（`(n: number) => ...`）で引数を受けてよい。
- 新聞の記事テンプレートだけ `src/content/newspaper/ja.ts`（データ）。スロットは `{name}` で書き `slots` に宣言する。読み込み時に `engine/NewspaperTemplates.ts` の Effect Schema が検証する。
- プロキシのシステムプロンプトはプレイヤーに見せないモデル向けの定義なので英語・i18n の対象外。
- 確認コマンド（日本語の直書きの検出。何も出なければ OK）。**`LC_ALL=C.UTF-8` が必須**: UTF-8 のロケールでないと `grep -P` の `\p{Han}` が働かず、違反があっても何も出ない（空振りする）。出力を信じる前に、違反例（`printf 'const x = "日本語";\n'`）で検出されることを確かめる:

```sh
LC_ALL=C.UTF-8 grep -rnP '["\x27\x60][^"\x27\x60]*[\p{Han}\p{Hiragana}\p{Katakana}][^"\x27\x60]*["\x27\x60]' src scripts --include=*.ts --include=*.tsx \
  | grep -v '\.test\.' | grep -v 'src/i18n/messages.ts\|src/content/'
```

### 4.2 バランス値の変更手順
1. `domain/constants.ts`（または `Buildings.ts`）の値だけを変える。**ロジックは変えない**（変えるなら別の論点として `DECISIONS.md` へ）。
2. `npm run sim`（既定 各1000ゲーム）で再計測。判定は**ヒューリスティック方策の到達率 70〜90%**（A-02）。ゲームオーバー率は sim の合否に使わず、人間のプレイ（P4）で測る（`P-08`/`W-15`）。ランダム勅令の結果は参考値。
3. 範囲外なら**定数だけ**を調整して再計測し、**履歴（変更・結果・メモ）を `docs/BALANCE.md` に残す**（§11・§28 の形式）。採用しなかった試行も記録する。
4. `docs/BALANCE.md` の定数一覧と `constants.ts` のコメントを揃える。

---

## 5. テスト方針

### 5.1 原則
- **`engine/` と `domain/` は単体テスト必須。** 特に: 文字数検証、`accuracy` 式、各歪み、エンディング判定と優先順位、意図判定、地図の自動導出、seed 再現性。
- **LLM は必ずモック。** フォールバック経路（タイムアウト・不正 JSON・スキーマ違反・レート制限・拒否）もテストする。
- 外部サービス（Mistral・Cloudflare）を呼ぶテストを書かない。プロキシは `handleRequest` に偽の上流を渡してテストする。

### 5.2 必須のテスト（今あるもの。壊さない）
派生指標・資材の在庫が負にならない（property-based）／20 enum が単一情報源から生成したスキーマ検証を通る／テンプレートの全スロットが埋まる・未定義スロットで `Effect.die`／同一 seed で同一紙面／偏向変換後も本文が空にならない／前提未達（役所なしの裁判所・見張り塔なしの牢屋・人口<200の屋敷）が no-op／工事（工期より早く完成しない・労働の割り振りが需要に比例・超過と資材不足で空洞化確率が上がる）／ランダムイベント（発生・解決・放置の後遺症が決定論的）／三角測量（倉庫の空洞：投書・能力高の側近の言及・変化のない地図）／AI 診断（故障ごとの切り分け）。

### 5.3 道具
- `src/test/fixtures.ts`: `steward` / `merchant`（初期側近）、`intentOf()`、`baseLayer()`、`fixedLLMLayer()`。
- `services/Rng.ts` の `RngScripted([...])`: 決まった値を順に返す乱数（歪みの境界を検査する）。
- `fast-check`: property-based テスト（派生指標、新聞の5〜7本など）。
- `LLMServiceMock` / `LLMServiceUnavailable`: LLM の差し替え。
- プロキシの結合テスト（`LLMDiagnostics.test.ts`）: 本物の `handleRequest` を、CORS を模擬した偽ブラウザ fetch の裏につなぐ。

### 5.4 品質ゲート（コミット前・報告前に必ず）
```sh
npm test            # Vitest（237件、24ファイル）
npm run typecheck   # tsc -b --noEmit
npm run lint        # eslint
npm run build       # tsc -b + vite build
```
バランス値・ルールエンジンを変えたら `npm run sim` も。UI を変えたら実ブラウザで1ゲーム通す（`node scripts/screenshots.cjs`）。**型とテストが通っても UI は目で確認する**（見た目の問題は型に出ない）。

---

## 6. UI・アセット

- コンセプト「**机の上の書類と、広げた地図**」。配色とフォントは SPEC 12.3 / 12.4（純色禁止、朱色のみアクセント）。色は CSS 変数（`styles.css`）と `ui/theme.ts` で同じ値を使う。
- P0 で実装する演出は**判子アニメ（CSS transition）と紙のフェードのみ**。画像アセット・効果音は入れない。
- アセットは **OFL または CC0 のみ。** ライセンス不明の素材は使わない。出典は `docs/ASSETS.md` に記録（フォントは `@fontsource` の Noto Serif JP / Noto Sans JP。ビルドに同梱し外部 CDN に依存しない）。
- 地図のタイルは「カテゴリ別の色＋1文字アイコン」（アートは後回し）。
- UI に出さないもの（不変条件13）を、デバッグ用でも**ゲーム画面には**出さない。開発者向けの診断は `?debug` に隔離する。

---

## 7. LLM・プロキシ・セキュリティ

- Mistral（`mistral-small-latest`）へは**必ずプロキシ経由**。フロントは `VITE_LLM_PROXY_URL` と `VITE_LLM_PROXY_TOKEN` だけを持つ（トークンはビルドに埋め込まれて公開されるので秘密ではない。実際の防御は Origin 制限・レート制限・リクエスト形式の固定）。
- プロキシは `{text, tags}` だけを受け、スキーマは固定。エラーは `{error: <コード>}`。勅令本文はログに残さない。
- LLM 出力は**クライアントで必ず検証**（`decodeLLMOutput`）。範囲外は clamp、未知の target は null。
- 失敗は黙って握りつぶさず、`reason`/`detail` をログに残す（原因が追えること。`I-41`）。
- 「AI が動かない」とき: まず `/?debug`（AI診断画面）で段階を切り分ける。**「このビルドの参謀」がモックなら LLM を呼んでいない**（`.env.local` が読まれていない）。環境変数はビルド・起動時に読まれるので、変えたら `npm run dev` を再起動。
- `wrangler dev` のローカル検証: キー無しなら `scripts/fake-mistral.mjs`（偽 Mistral。LLM ではない）と `--var MISTRAL_BASE_URL:http://127.0.0.1:8788` を使う。**複数のインスタンスを同時に起動するときは `--inspector-port` を分ける**（さもないと「Address already in use」で片方が落ちる）。
- 本番デプロイ（`wrangler login`/`secret put`/`deploy`、Pages への公開）は**ユーザーの確認が必要**。

---

## 8. ドキュメントの更新ルール

| 変えたもの | 更新する文書 |
|-----------|--------------|
| 仕様・挙動・判断（新しい論点、実装中の細部の決定） | `docs/DECISIONS.md`（ID を付けて追記。承認が要るものは承認後に実装） |
| バランス値・式・sim の結果 | `docs/BALANCE.md`（式・定数一覧・調整履歴）。`constants.ts` と整合させる |
| 不変条件・作業ルール・コマンド・ディレクトリ構成 | `CLAUDE.md`（古くなった記述は**直す**。食い違いを放置しない）と本書 |
| 挙動（実装準拠の仕様） | `docs/handoff/SPECIFICATION.md` |
| 要件の追加・状態の変化 | `docs/handoff/REQUIREMENTS.md` |
| 手順・コマンド・環境変数 | `README.md`、`docs/DEPLOY.md` |
| 素材 | `docs/ASSETS.md` |
| 画面の見た目 | `docs/screenshots/`（`node scripts/screenshots.cjs` で撮り直す） |

- 数値を文書に書くときは**コードから抜き出す**（手で写さない）。`SPECIFICATION.md` の表はそうして作った。
- 原典（`SPEC.md` / `SPEC_AMENDMENT_v3.1.md` / `SPEC_v3.2.md`）の誤記（`###汚職`・`6計画`・`.1 入力仕様` など）は製品版項目か表記ゆれ。実装には影響させない。**原典を書き換えない**（差分は DECISIONS で扱う）。

---

## 9. ブランチ運用

- フェーズごとにブランチを切る（`p0/…`・`p0.5/…`・`p1/…`・`p2/…`・`p3/…`）。**現在の最新は `p2/v3.2-ui`**（`p0`〜`p3`・`p0.5/spec-v3.2-review`・`p1/v3.2-core` を全て含む）。
- `main`（ローカル）は古い（`origin/main` は仕様書 v3.2 を作った時点）。**統合・PR・削除はユーザーの指示があるまでしない。**
- 新しい作業は最新のブランチから切る。マージ済みの PR のブランチに新しい作業を積まない。

---

## 10. 環境の注意（過去に踏んだもの）

- **プロセスの後片付け**: バックグラウンドで起動した `wrangler` / `vite preview` / `fake-mistral` は、`pkill -f "[w]rangler"` のように**パターンの1文字を `[ ]` で囲む**（`pkill -f wrangler` は自分のシェルにもマッチして自滅する）。
- **一時ファイル**はセッションの scratchpad ディレクトリに置く（リポジトリ直下に作らない）。スクリーンショットの試し撮りも scratchpad に出力し、確定したものだけ `docs/screenshots/` に。
- **Playwright** は環境のものを使う（`require("playwright")`）。`npx playwright install` は不要。Chromium は事前にインストール済み。
- `.env.local` / `.dev.vars` は**この環境に既にある**場合がある。中身を読み出さない。テストでは `--var` で偽の値に上書きする。
- Vite の環境変数はビルド・起動時に埋め込まれる。`.env.local` を変えたら再起動（本番は再ビルド）。
- ブラウザは、CORS ヘッダーのない応答（例: プロキシの 403 `forbidden_origin`）を**読ませず「接続失敗」**にする。「届くのに読めない」は Origin 許可の問題を疑う。
- 乱数の系列を増やすとテストの期待値が動く。新聞・任命候補・区画のように**本系列を消費しない別系列**を使うと、既存の再現性を保てる。
- **`grep -P` はロケールに注意**（上の §4.1）。このシェルの既定は `C` ロケールで、Unicode のプロパティが効かない。「何も出なかった」は「問題なし」とは限らない。検査コマンドは必ず違反例で動作を確かめてから信じる。
- フォントやレイアウトを変えたら、新聞が1画面に収まるかを確認する（5〜7記事）。

---

## 11. 新しい機能を足すときの手順

1. 要件・論点を `DECISIONS.md` に書く（選択肢と推奨案。必要なら質問を1回にまとめる）。承認を得る。
2. 語彙・型を `domain/` に（単一情報源から派生するものは派生させる）。バランス値は `constants.ts`。文言は `messages.ts`。
3. ロジックを `engine/`（純粋な部分は `domain/`）に。乱数は `Rng` 経由。状態を変えるのはルールエンジンだけ。
4. テストを書く（境界・決定論・失敗経路）。
5. UI は描画だけ。`runtime.ts` 経由で呼ぶ。
6. 品質ゲート（§5.4）→ sim が必要なら流す → 実ブラウザで確認。
7. 文書を更新（§8）→ 小さなコミットに分ける → フェーズ完了なら報告して止まる。

---

## 12. やってはいけないこと（まとめ）

- LLM に数値更新・歪み・新聞を任せる／LLM の出力で状態を直接書き換える。
- `Math.random()`、日本語リテラルの直書き、マジックナンバー、`domain/` から Effect・DOM・fetch を import する。
- target の一覧を手で複製する（`Buildings.ts` から生成する）。
- UI に派生指標・truthfulness・資材・建材表・工期・労働人口を出す。地図に空洞を出す。
- 無効な指示や前提未達で国庫を消費する。
- 承認なしに仕様を変える／黙って食い違いを放置する。
- シークレットをコミット・表示する。承認なしにデプロイや外部サービスの変更をする。
- 破壊的な操作を他のコマンドと混ぜる。承認なしに PR を作る・ブランチを消す。
- 次のフェーズに勝手に進む。
- テストを落としたまま・省いたまま「完了」と報告する。
