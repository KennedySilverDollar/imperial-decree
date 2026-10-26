# 勅令都市（仮） — P0 プロトタイプ

都市開発シミュレーション × 官僚マネジメント × AI 解釈ゲームの、ブラウザ向けプロトタイプです。

プレイヤーは領主として辺境の村を治めます。ただし都市を直接は操作できません。**自然言語の勅令**を書いて判を押すと、次の順に処理されて都市が変わります。

1. **参謀（LLM）** が勅令を解釈する。
2. **側近**がその指示を歪めて実行する（誤読・取り違え・骨抜き）。
3. **ルールエンジン**が決定論的に都市を更新する。建物は「発注」で、**工期と労働人口と秘匿の資材**がかかる。

結果は「**新聞**」「**側近報告**」「**地図**」の3つの媒体で返ってきますが、どれも完全には信頼できません。たとえば倉庫が見かけ倒し（空洞）のとき、新聞は投書でにおわせ、能力の高い側近は報告し、地図は何も変わりません。**食い違いに気づくことが、このゲームの遊びです。**

> このプロトタイプで検証したい中核仮説：**信頼性が曖昧な情報を反芻した上で、その時点で正しい勅令を出し、意図通りに発展させる難しさは面白いか。**

![机の上の書類と、広げた地図](docs/screenshots/10-desk-midgame.png)

> **他の Claude Code・開発者の方へ**: 引き継ぎ用の文書一式が [docs/handoff/](docs/handoff/README.md) にあります（機能要件・製作ルール・実装仕様書）。まず [docs/handoff/README.md](docs/handoff/README.md) と [CLAUDE.md](CLAUDE.md) を読んでください。

---

## 目次

1. [クイックスタート](#1-クイックスタート)
2. [必要環境](#2-必要環境)
3. [構築手順](#3-構築手順)
4. [コマンド一覧](#4-コマンド一覧)
5. [遊び方](#5-遊び方)
6. [ゲーム仕様（要約）](#6-ゲーム仕様要約)
7. [アーキテクチャ](#7-アーキテクチャ)
8. [LLM 連携・セキュリティ・AI診断](#8-llm-連携セキュリティai診断)
9. [テストとバランス検証](#9-テストとバランス検証)
10. [計測ログ（プロト KPI）](#10-計測ログプロト-kpi)
11. [ドキュメント一覧](#11-ドキュメント一覧)
12. [現状と既知の制約](#12-現状と既知の制約)
13. [開発ルール](#13-開発ルール)

---

## 1. クイックスタート

API キーは不要です。何も設定しなければ、参謀は**モック**（キーワードで字面を読むテンプレート解釈）で動きます。**このとき LLM は一切呼ばれません。**

```sh
git clone <このリポジトリ>
cd imperial-decree
git checkout p2/v3.2-ui     # 最新のブランチ（main は古い）
npm ci
npm run dev                 # http://localhost:5173 を開く
```

実際の LLM（Mistral）につなぐ手順は [3.3](#33-実-llmmistralにつなぐ) にあります。**AI が使われない・失敗する原因は、`/?debug`（AI診断画面）で切り分けられます**（[8.4](#84-ai診断画面debug)）。

## 2. 必要環境

| 項目 | バージョン | 備考 |
|------|------------|------|
| Node.js | 22 以上 | 22.22 で動作確認 |
| npm | 10 以上 | **パッケージ管理は npm に統一**（pnpm / yarn は使わない） |
| ブラウザ | 最近の Chrome / Edge / Firefox / Safari | 地図は Phaser の Canvas 描画。Chromium で検証 |
| Mistral API キー | — | 実 LLM で遊ぶときのみ必要 |
| Cloudflare アカウント | — | プロキシを本番にデプロイするときのみ必要。ローカル実行には不要 |

主な依存は次のとおりです。バージョンは追加仕様 A-10 に従って固定しています。

| ライブラリ | バージョン | 用途 |
|------------|------------|------|
| Effect-TS | `~3.22.4` | ゲームロジック・サービス（`Context.Tag`）・スキーマ。4.x は `Context.Tag` が廃止されているため使わない |
| TypeScript | `5.9.2`（完全固定） | strict モード |
| Phaser | `~4.2.1` | 10×10 の地図描画 |
| React | 19 | パネル UI |
| Vite / Vitest | 8 / 5 | ビルド・テスト |
| fast-check | 4 | property-based テスト |
| tsx | 4 | `npm run sim` |
| wrangler | 4 | LLM プロキシ（Cloudflare Workers）のローカル実行・デプロイ |

## 3. 構築手順

### 3.1 依存のインストール

```sh
npm ci            # package-lock.json どおりに入れる（普段はこちら）
# 依存を追加するときだけ: npm install <pkg>
```

### 3.2 モック参謀で遊ぶ（設定不要）

```sh
npm run dev       # 開発サーバー http://localhost:5173
# または本番ビルドで確認
npm run build
npm run preview   # http://localhost:4173
```

`.env.local` が無い（または `VITE_LLM_PROXY_URL` と `VITE_LLM_PROXY_TOKEN` の**どちらか**が欠けている）とき、参謀はモック（`src/engine/MockLLM.ts`）になります。勅令はキーワード（道・家・井戸・市場・役所・税・祭・治安・倉・畑など20種）で解釈されます。

### 3.3 実 LLM（Mistral）につなぐ

ブラウザから Mistral を直接呼ぶことはありません。必ず **Cloudflare Workers のプロキシ**（`src/proxy/worker.ts`）を通します。API キーを持つのはプロキシだけです。

```sh
# 1) プロキシのシークレット（.dev.vars は git 管理外）
cp .dev.vars.example .dev.vars
#   MISTRAL_API_KEY=<Mistral の API キー>
#   PROXY_TOKEN=<ランダムな文字列>   例: openssl rand -hex 24
#   ALLOWED_ORIGINS=http://localhost:5173,http://localhost:4173

# 2) フロントの接続先（.env.local は git 管理外）
cp .env.example .env.local
#   VITE_LLM_PROXY_URL=http://localhost:8787
#   VITE_LLM_PROXY_TOKEN=<.dev.vars の PROXY_TOKEN と同じ値>

# 3) 起動（ターミナルを2つ）
npx wrangler dev --port 8787     # プロキシ（ローカルの workerd。Cloudflare へのログインは不要）
npm run dev                      # フロント（env は起動時に読まれる。変えたら再起動）
```

プロキシ単体の動作確認：

```sh
curl -s -X POST http://localhost:8787/v1/decree \
  -H "Authorization: Bearer <PROXY_TOKEN>" -H "Content-Type: application/json" \
  -d '{"text":"道を大いに造れ","tags":[]}'
# → {"output":"{\"action\":\"build\",\"target\":\"road\",...}","mode":"json_schema"}
```

画面での見分け方は次のとおりです。

- 3段表示の1枚目が「**参謀の解釈**」なら、LLM 経由で解釈されています。
- 「**参謀不在のため書記が字面から解釈**」なら、テンプレートにフォールバックしています（理由も併記されます）。
- もっと確実には **`/?debug`** を開き、「このビルドの参謀」と各段階の結果を見てください。

### 3.4 キーなしで結線だけ確かめる（偽 Mistral）

`scripts/fake-mistral.mjs` は、キーワードで答える**試験用の代役**です（LLM ではありません）。

```sh
node scripts/fake-mistral.mjs 8788
# .dev.vars に MISTRAL_BASE_URL=http://127.0.0.1:8788 を追加して wrangler dev を起動し直す
# （.dev.vars を触らず、npx wrangler dev --var MISTRAL_BASE_URL:http://127.0.0.1:8788 --var MISTRAL_API_KEY:fake でもよい）
# FAKE_MISTRAL_REJECT_SCHEMA=1 node scripts/fake-mistral.mjs 8788 で json_object へのフォールバックを試せる
```

**`wrangler dev` を複数同時に起動するときは `--inspector-port` を分けてください**（さもないと片方が「Address already in use」で落ちます）。

### 3.5 障害を模擬する

`ENVIRONMENT=development` のときだけ有効です。どの障害でもゲームは止まらず、テンプレート解釈で進みます。

```sh
npx wrangler dev --port 8787 --var FAULT_MODE:timeout           # 応答しない → 5秒×3回でテンプレートへ
npx wrangler dev --port 8787 --var FAULT_MODE:invalid_json      # JSON でない出力
npx wrangler dev --port 8787 --var FAULT_MODE:schema_violation  # 形式違反の出力
npx wrangler dev --port 8787 --var FAULT_MODE:upstream_error    # 上流 502
# プロキシを止めた状態でも、フロントはテンプレートで進む
```

### 3.6 本番デプロイ

手順は [docs/DEPLOY.md](docs/DEPLOY.md) にあります。

- プロキシ：`wrangler secret put` → `wrangler deploy`
- フロント：環境変数を付けて `npm run build` し、`dist/` を静的ホスティングへ置く

Cloudflare アカウントと公開環境を変更する操作なので、**実行前にプロジェクトのオーナーに確認してください。**

**シークレット（`MISTRAL_API_KEY`, `PROXY_TOKEN`）は絶対にコミットしないでください。** `.dev.vars` / `.env.local` は `.gitignore` 済みです（中身を表示・コピーもしないでください）。

### 3.7 環境変数

**フロント（`.env.local`、Vite。ビルド・起動時に埋め込まれる）**

| 変数 | 必須 | 説明 |
|------|------|------|
| `VITE_LLM_PROXY_URL` | 任意 | プロキシの URL（オリジンだけ。`/v1/decree` は付けない）。未設定ならモック参謀 |
| `VITE_LLM_PROXY_TOKEN` | 任意 | プロキシの簡易トークン。ビルドに埋め込まれて公開されるため、秘密情報ではない。**URL と両方そろわないとモック** |

**プロキシ（`.dev.vars` / `wrangler secret` / `wrangler.toml [vars]`）**

| 変数 | 種別 | 既定 | 説明 |
|------|------|------|------|
| `MISTRAL_API_KEY` | Secret | — | Mistral の API キー。未設定ならプロキシは 500 を返す |
| `PROXY_TOKEN` | Secret | — | フロントと共有する簡易トークン |
| `ALLOWED_ORIGINS` | var | 空 | 許可する Origin（カンマ区切り）。空なら Origin 付きのリクエストはすべて拒否。**ページの Origin と完全一致が必要** |
| `MISTRAL_MODEL` | var | `mistral-small-latest` | モデル名 |
| `MISTRAL_BASE_URL` | var | `https://api.mistral.ai` | 上流の URL（偽 Mistral で試すときに変える） |
| `RATE_LIMIT_PER_MINUTE` | var | `20` | クライアントごとの毎分上限 |
| `SCHEMA_INCLUDE_RANGES` | var | `false` | JSON Schema に minimum/maximum を付けるか（Mistral の対応は未確認） |
| `ENVIRONMENT` | var | `production` | `development` のときだけ `FAULT_MODE` が有効 |
| `FAULT_MODE` | var | 空 | `timeout` / `invalid_json` / `schema_violation` / `upstream_error` |

## 4. コマンド一覧

| コマンド | 内容 |
|----------|------|
| `npm run dev` | Vite 開発サーバー（http://localhost:5173）。`/?debug` が AI診断画面 |
| `npm run build` | 型検査（`tsc -b`）＋本番ビルド（`dist/`） |
| `npm run preview` | ビルド結果を配信（http://localhost:4173。`-- --port 4173` で `screenshots.cjs` の既定 URL） |
| `npm test` | 単体テスト（Vitest、`src/**/*.test.ts(x)`。237件） |
| `npm run typecheck` | 型検査のみ（`tsc -b --noEmit`） |
| `npm run lint` | ESLint。`Math.random` の直呼び禁止、`src/domain` からの effect/phaser/react の import と fetch・DOM の使用の禁止を含む |
| `npm run sim -- [ゲーム数]` | ヘッドレスシミュレーション（既定1000ゲーム×3方策）。A-02 の合否（ヒューリスティック到達率）を PASS/FAIL で出し、建物利用エントロピー・新聞の検閲削除率・イベント解決率なども出す。結果は `docs/BALANCE.md` §11・§28 |
| `npx wrangler dev --port 8787` | LLM プロキシをローカルで起動 |
| `node scripts/fake-mistral.mjs [port]` | キーなしで試すための偽 Mistral |
| `node scripts/screenshots.cjs [URL]` | ブラウザで1ゲーム通しで遊び（三角測量の場面も作る）、`docs/screenshots/` を撮り直す。`npm run preview -- --port 4173` を起動した状態で。環境の Playwright を使用 |

## 5. 遊び方

画面は上から、**台帳** → 3列（**新聞** ／ **領地図・普請中の案件・勅令の巻物** ／ **側近**）です。

1. **台帳を見る**：人口・国庫・幸福度・インフラ・汚職率・政治資本の6項目だけが常時見えます。前年からの増減が添えられます。**住宅容量・食料・衛生・治安・行政能力・労働人口・資材は見えません。**新聞と側近報告から推し量ります。
2. **情報を読む**：
   - **新聞**：毎年5〜7記事（第一面・社会・経済・行政・治安・投書・広告・天候）。数値は「概ね」とぼかされ、都合の悪い記事は消され、婉曲に言い換えられます。**投書欄**は住民の声で、見かけ倒しの建物などを断言せずににおわせます。
   - **領地図**：区画は役人が自動で割り振ります（指定できません）。建物はカテゴリ別の色と1文字の記号、工事中は薄く表示されます。**見かけ倒しの建物も普通の建物に見えます。**
   - **側近報告**：側近ごとに、台帳の変化・発注の結果・工事の見積り・資材不足・イベントなどを報告します。野心の高い側近は都合の悪いことを隠し、能力の低い側近は見落とします。能力の高い側近は見かけ倒しを開示します。
3. **勅令を書く**：40字以内（例：「道を大いに造れ」「倉庫を二つ建てよ」「税を少し取れ」「祭を開け」）。
   - タグ（対象／規模／期限／優先度）を付けられます。**タグ1つにつき5字を消費**します。対象と規模は解釈の手がかりになります。期限と優先度は参謀への添え書きで、ゲームへの効果はありません。
   - 残りの字数は常に表示されます。超えると判を押せません。
4. **余白に意図を書き添える（任意）**：例は「人口を20増やす」です。達成すると褒賞として幸福度+5を得ます。未達でも罰はありません。
5. **判を押す**：政治資本が1、（執行されれば）国庫が10減ります。建物は**発注**になり、代金は今払い、**完成は数年後**です。完成までの年数は秘匿で、側近の見積りでしか分かりません。
6. **顛末を読む**：重なった書類を1枚ずつめくります。
   1. 参謀の解釈
   2. 側近による補正：選ばれた側近と選定理由。歪められた箇所や、国庫不足で棟数が縮んだ箇所は朱色の訂正線で示されます。
   3. 実際の結果：5項目の増減、完成した建物、イベント。
   4. 意図比較（宣言したときだけ）
7. **側近を任免する**：解任は無料、任命は政治資本1です。任命するときは候補2人から選びます。側近がいないと勅令は執行されません。
8. **イベントに備える**：疫病・凶作・盗賊が起きることがあります。対応する建物の発注や政策で解決でき、放置すると後遺症が残ります。
9. **目標**：50年以内に**人口300・インフラ25・役所の建設**を達成すると、村が町になって終わります。人口0・国庫がマイナス・幸福度0でゲームオーバーです。

![3段表示](docs/screenshots/06-result-sheet-2.png)

見かけ倒しの倉庫を突き止める場面（投書・側近報告・地図）は [14-triangulation-desk.png](docs/screenshots/14-triangulation-desk.png) にあります。

## 6. ゲーム仕様（要約）

**詳細・式・全定数は [docs/handoff/SPECIFICATION.md](docs/handoff/SPECIFICATION.md)**（コードから機械的に抜き出した値）にあります。ここは要約です。

### 6.1 ターンの流れ（1ターン＝1年）

1. 勅令の検証（文字数・タグ・政治資本）
2. 参謀が `DecreeIntent` に翻訳（失敗したらテンプレートパーサー）
3. 担当の側近を自動選択し、解釈を歪める
4. ルールエンジンが執行（建物は発注、政策は即時、イベントの解決）
5. 年次更新：工事の進行と完成 → 人口 → 税収と維持費 → 幸福度 → インフラ・汚職 → 資材 → イベント
6. 意図の判定 → 側近報告 → エンディング判定 → 新聞の生成 → セーブ

### 6.2 パラメータ

| 区分 | 項目 |
|------|------|
| 台帳（見える） | 人口・国庫・幸福度・インフラ・汚職率・政治資本 |
| 派生指標（見えない） | 住宅容量・食料・衛生・治安・行政能力（すべて max(0,…)） |
| 秘匿（見えない） | 労働人口（人口×0.5）、資材（木材・石材）、建材表、工期 |

### 6.3 勅令の語彙（LLM の出力形式）

`{ action, target, magnitude, budget, confidence }`

- `action`：`build` / `tax` / `invest` / `reform` / `appoint` / `dismiss`
- `target`（**20種**）：建物17（`residential tenement manor road well granary market farm workshop office taxoffice courthouse clinic school temple watchtower jail`）＋政策3（`tax_rate welfare_policy security_policy`）。許可リスト外は no-op。
- `magnitude`：−100〜100。建物は `n棟 → 34×n`（最大3棟）。
- 無効な組合せ・前提未達（役所なしの裁判所、見張り塔なしの牢屋、人口200未満の屋敷）は**国庫を消費せず** no-op になり、側近が理由を報告します。

### 6.4 側近と歪み

- 側近は最大2人。初期は「老練な代官」と「若い商人上がり」。候補は毎年2人。
- 担当は自動選択（専門一致 → 信頼 → 在任の長さ）。解釈精度は `0.3 + 能力/200 + 専門一致0.2 + 信頼0.1 − 野心と派閥対立0.2 ＋ 行政能力による加算（最大0.15）`。
- 歪み：**誤読**（規模が±30〜50%）、**取り違え**（専門外のとき別の target に）、**骨抜き**（派閥対立のとき建物の半数が見かけ倒しに）。
- 報告：**隠蔽**（野心高・忠誠低）、**欠落**（能力低）、信頼が低いと2項目まで。

### 6.5 建設・労働・資材（v3.3）

- 建物は**発注**。最短工期より早くは完成せず、完成した年から効果と維持費が始まる。
- 労働人口を、官僚が各案件の需要に比例して割り振る。**需要が労働人口の1.5倍を超える「無理な命令」**は、見かけ倒しになりやすく、汚職率も上がる。
- 建材（木材・石材）は秘匿。足りないと工事が遅れ、**ひどく足りないと手抜き**（見かけ倒し・汚職）になる。
- 見かけ倒し（空洞）の建物は、維持費を払い続けるが効果はゼロ。`invest`（整備せよ）で半額で修繕できる。

### 6.6 エンディング

人口0／国庫マイナス／幸福度0でゲームオーバー（優先）、人口300・インフラ25・役所で成功（町へ）、50年で時間切れ。

### 6.7 地図

10×10。道路は中央の十字（`floor(インフラ/5)` 本）、役所は中央、建物は中央から外へ育つ。区画は発注時に確保して保存。**空洞は地図に出ない。**

## 7. アーキテクチャ

```
src/
  domain/    純粋な型と純粋関数（Effect 非依存）。Buildings.ts が20 target の単一情報源、constants.ts がバランス値
  services/  LLMService / SaveService / LogService / Rng（Context.Tag）
  engine/    DecreeParser, AideInterpreter, RuleEngine, IntentEvaluator, MapUpdater,
             NewspaperGenerator, TurnMachine, LLMDiagnostics ...
  ui/        scenes(Phaser) と panels(React)。ロジックは持たない
  i18n/      messages.ts（全文言）
  content/newspaper/  記事テンプレート 28本（データ）
  proxy/     Mistral プロキシ（Cloudflare Workers）
docs/        SPEC*.md, DECISIONS.md, BALANCE.md, DEPLOY.md, ASSETS.md, handoff/（引き継ぎ文書）, screenshots/
scripts/     sim.ts, screenshots.cjs, fake-mistral.mjs
```

### 設計上の不変条件（要約。全文は [CLAUDE.md §4](CLAUDE.md)・[docs/handoff/DEV_RULES.md](docs/handoff/DEV_RULES.md) §3）

- 状態を変更できるのはルールエンジンだけ。LLM の出力は「提案」。
- LLM は翻訳層のみ（歪み・数値更新・新聞に使わない）。
- 乱数は `Rng` サービス経由（seed 付き）。同じ seed・入力・LLM 出力なら同じ結果。
- `domain/` は純粋。UI にゲームロジックを書かない。
- 文言は `i18n/messages.ts`（新聞テンプレートだけ `content/`）。バランス値は `constants.ts`。
- LLM 障害でもゲームは止まらない（5秒・リトライ2回・テンプレートへ）。API キーはフロントに置かない。
- target enum（20種）は `Buildings.ts` が単一情報源。
- UI に出さない値：派生指標・truthfulness・建材表・工期・資材・労働人口。

### 技術メモ

- 新聞の seed は `hash(saveId, turn)`（本系列の乱数を消費しない）。任命候補・区画の乱数も別系列。
- セーブは localStorage の1スロット（`schemaVersion=2`。不一致は読み込まない）。LLM の会話履歴は保存しない。

## 8. LLM 連携・セキュリティ・AI診断

### 8.1 経路

```
[ブラウザ] --POST /v1/decree (Bearer <PROXY_TOKEN>)--> [Workers: src/proxy/worker.ts] --chat/completions--> [Mistral: mistral-small-latest]
```

プロキシが JSON Schema を固定し（`json_schema` strict → だめなら `json_object`）、LLM の生の出力を `{output, mode}` で返します。**検証はクライアント**で行い、範囲外は clamp、未知の target は no-op にします。

### 8.2 守っていること

- API キーはプロキシの Secret にだけある。フロントが持つのは URL と簡易トークン。
- プロキシは Origin 制限・トークン照合（定数時間）・レート制限（毎分20）・本文200字／4KB の上限・リクエスト形式の固定（余計なキーは 400）。勅令本文はログに残さない。
- 勅令本文はシステムプロンプトに連結せず、ユーザーメッセージとして分離。メタ命令（「システムプロンプトを無視せよ」など）は削除してから参謀に渡す。

### 8.3 失敗したとき

1試行5秒、リトライ2回（500ms → 1000ms）。レート制限と 4xx は再試行せず、確定したらテンプレートパーサーで解釈します（3段表示に理由が出る）。失敗はログの `llm.attemptFailed` / `llm.fallback` に `reason` と `detail`（例 `proxy 401: unauthorized`）つきで残ります。

### 8.4 AI診断画面（`/?debug`）

「AI機能が上手くいかない」とき、**まずここを開きます**（ゲームのヘッダーにも「AI診断」リンクがあります）。ゲームの状態・設定には触れません。

1. ① 設定（URL・トークン・混在コンテンツ）
2. ② 到達（サーバーに接続できるか）
3. ③ 認証・CORS（間違ったトークンで 401 が読めるか）
4. ④ 呼び出し（プロキシ → Mistral）
5. ⑤ 検証（出力をゲームと同じスキーマにかける。出力を貼って検証もできる）
6. ⑥ ゲームと同じ経路（タイムアウト・リトライ・フォールバック込み）

失敗した段階で「考えられる原因」と「確かめること・直し方」を出します。「診断結果をコピー」でトークンを伏せたレポートを作れます。上部に「このビルドの参謀」（**モックなら LLM を呼んでいない**）、下部にゲーム中の失敗の集計が出ます。症状別の見方は [docs/DEPLOY.md §1.5](docs/DEPLOY.md) にあります。

## 9. テストとバランス検証

```sh
npm test            # 237件・24ファイル
npm run typecheck
npm run lint
npm run build
npm run sim         # 既定 各1000ゲーム
```

- `engine/` と `domain/` は単体テスト必須。LLM は必ずモック。property-based（fast-check）で派生指標の非負・新聞の5〜7本などを検査。プロキシの結合テストは本物の `handleRequest` を偽ブラウザ fetch の裏につなぐ。
- **sim の判定は「ヒューリスティック方策の到達率 70〜90%」**（A-02）。最新の結果（各1000ゲーム、`docs/BALANCE.md §28`）：ヒューリスティック **到達 82.8%**・ゲームオーバー 11.1%・平均到達 約31年。ゲームオーバー率（目標 20〜40%）は sim の合否に使わず、人間のプレイ（P4）で測ります（`P-08`）。ランダム勅令の結果は参考値です。
- バランス値は `src/domain/constants.ts` と `src/domain/Buildings.ts` に集約。変えたら `npm run sim` で再計測し、履歴を `docs/BALANCE.md` に残します。

## 10. 計測ログ（プロト KPI）

localStorage（`imperial-decree/log`、最大5000件）に記録し、ヘッダーの「記録を書き出す」で JSON を書き出せます。

| イベント | 目的 |
|----------|------|
| `game.start` / `game.restart` / `game.end` | 目標到達率・ゲームオーバー率・平均ターン数・自発的な再プレイ率 |
| `turn.submitted` | 勅令の文字数・タグ使用・熟考時間 |
| `turn.resolved` | 解釈の出どころ（LLM/テンプレート）、意図宣言の使用率とボーナス獲得率 |
| `result.closed` | 3段表示のめくり回数 |
| `newspaper.read` / `newspaper.letters` | 新聞の閲覧時間、投書欄の参照 |
| `target.used` | 建物種別の使用分布（歪み後の target と結果） |
| `aide.appointed` / `aide.dismissed` | 任免 |
| `llm.attemptFailed` / `llm.fallback` | LLM の失敗の原因（`reason`・`detail`） |

勅令の本文は記録しません（文字数のみ）。

## 11. ドキュメント一覧

| ファイル | 内容 |
|----------|------|
| [docs/handoff/README.md](docs/handoff/README.md) | **引き継ぎの入口**（読む順番・現状・文書の地図） |
| [docs/handoff/REQUIREMENTS.md](docs/handoff/REQUIREMENTS.md) | **機能要件書**（要件 ID・受け入れ基準・状態・KPI） |
| [docs/handoff/DEV_RULES.md](docs/handoff/DEV_RULES.md) | **製作ルール**（不変条件・作業ルール・規約・テスト・手順） |
| [docs/handoff/SPECIFICATION.md](docs/handoff/SPECIFICATION.md) | **実装仕様書**（実装準拠。式・全定数・建物表・テンプレート一覧） |
| [CLAUDE.md](CLAUDE.md) | 開発ルールとアーキテクチャ上の不変条件（Claude Code が読む指示書） |
| [docs/SPEC.md](docs/SPEC.md) | 仕様書 v3.0 FINAL（原典） |
| [docs/SPEC_AMENDMENT_v3.1.md](docs/SPEC_AMENDMENT_v3.1.md) | 差分仕様 A-01〜A-10（v3.0 を上書き） |
| [docs/SPEC_v3.2.md](docs/SPEC_v3.2.md) | 新聞 v2・20 target・派生指標（v3.1 を上書き） |
| [docs/DECISIONS.md](docs/DECISIONS.md) | 論点・決定・仕様変更提案の記録（v3.3 のユーザー指示は §12） |
| [docs/BALANCE.md](docs/BALANCE.md) | 全バランス値の式・根拠・シミュレーション結果と調整履歴 |
| [docs/DEPLOY.md](docs/DEPLOY.md) | プロキシとフロントの動かし方・AI診断・障害の模擬・本番デプロイ |
| [docs/ASSETS.md](docs/ASSETS.md) | 素材の出典とライセンス |
| [docs/screenshots/](docs/screenshots/) | 主要画面のスクリーンショット |

## 12. 現状と既知の制約

| フェーズ | 内容 | 状態 |
|----------|------|------|
| P0 | 仕様の論点整理・バランス初期案・雛形 | 完了 |
| P0.5 | v3.2 仕様の統合・v3.3 の設計 | 完了 |
| P1 | コアエンジン（v3.1 → v3.2＋v3.3：20 target・派生指標・新聞 v2・工期・労働・資材・イベント） | 完了 |
| P2 | UI（新聞パネル・テンプレート全文・台帳・建物タイル・タグ4種・計測ログ）＋AI診断画面 | 完了 |
| P3 | Mistral プロキシと接続 | 実装済み・**実 LLM での確認は未実施** |
| P4 | 人間のプレイテスト | 未着手 |

- **実 LLM での動作は未確認です**。Mistral API への接続は、プロキシ・クライアントとも単体テスト・偽 Mistral・実プロキシ（wrangler dev）までで検証しています。初回の確認手順は [docs/DEPLOY.md](docs/DEPLOY.md) §1 のチェックリストにあります。
- Mistral 側の仕様で**未確認**のもの：Structured Outputs で minimum/maximum が使えるか、現行の価格、実際の所要時間。今は範囲をスキーマに付けず、ゲーム側で clamp しています。
- 人間の初見到達率（目標50〜70%）とゲームオーバー率は**未測定**（P4）。
- レート制限は簡易版です（Worker の isolate ごとのメモリ）。公開範囲を広げるときは置き換えが必要です。
- `npm audit` の警告3件は wrangler のローカル開発サーバーの依存によるもので、配布物には含まれません（`DECISIONS L-07`）。
- 自己レビューで挙がった改善候補（側近報告の量と言い回し、新聞の重複、期限・優先度タグの意味、イベント収束の記事など）は [docs/handoff/REQUIREMENTS.md §6](docs/handoff/REQUIREMENTS.md) に一覧があります。
- 仕様・文書間の既知の食い違いは [docs/handoff/SPECIFICATION.md §19](docs/handoff/SPECIFICATION.md) に記録しています。
- ブランチ：最新は **`p2/v3.2-ui`**（それ以前の全ブランチを含む）。`main` は古く、PR は未作成です。
- **P0 のスコープ外**：複数の新聞、官僚機構（個別の官僚）、教育・監査・派閥工作、霧、Tauri/Steam、多言語、ローカル LLM、課金、区画の手動指定は作りません（ランダムイベント3種は対象です）。
- **言語**：日本語のみです。文言は `messages.ts` に集約してあるので、i18n に対応できる構造になっています。

## 13. 開発ルール

全文は [docs/handoff/DEV_RULES.md](docs/handoff/DEV_RULES.md) と [CLAUDE.md](CLAUDE.md) にあります。要点：

- 仕様が曖昧・矛盾・未定義のときは推測で実装しません。`docs/DECISIONS.md` に論点と推奨案を書き、承認を得てから進めます。
- フェーズごとに完了条件を満たしたら止まって報告します。次のフェーズに勝手に進みません。
- コミットは小さく、1コミット1目的にします。コメント・コミットメッセージ・ドキュメントは日本語、識別子は英語で書きます。
- 破壊的な操作（rm・強制上書き・`git reset --hard`・ブランチ削除）は、他のコマンドと混ぜず、承認を得てから実行します。
- 素材は **OFL または CC0 のみ**使います。出典は `docs/ASSETS.md` に記録します。
- シークレットは絶対にコミットしません。デプロイなど外部サービスの変更は、実行前にオーナーに確認します。
- 変更を出す前に `npm test` / `npm run typecheck` / `npm run lint` / `npm run build` を通します。バランス値を変えたら `npm run sim` を流し、結果を `docs/BALANCE.md` に残します。
