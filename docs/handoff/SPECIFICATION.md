# SPECIFICATION.md — 勅令都市（仮）実装仕様書（実装準拠）

> **本書は「今のコードが何をするか」を記録した仕様書です。** 他の Claude Code がコードを読まずに挙動を把握・再現・修正できることを目的とします。
> 数値は `src/domain/constants.ts` と `src/domain/Buildings.ts` から機械的に抜き出した値（2026-10-26 時点、ブランチ `p2/v3.2-ui`）です。コードと食い違ったら **コードが正**で、本書を直してください。
> 設計意図・経緯・却下案は `docs/DECISIONS.md`、バランスの根拠は `docs/BALANCE.md`、原典の仕様は `docs/SPEC.md`（v3.0）・`docs/SPEC_AMENDMENT_v3.1.md`・`docs/SPEC_v3.2.md` にあります。
> 関連: 機能要件 `REQUIREMENTS.md` ／ 製作ルール `DEV_RULES.md` ／ 入口 `README.md`（このディレクトリ）。

---

## 0. 正典の優先順位

`DECISIONS.md §12（v3.3：ユーザー指示）` ＞ `SPEC_v3.2.md` ＞ `SPEC_AMENDMENT_v3.1.md`（A-01〜A-10） ＞ `SPEC.md`（v3.0）。
上位が明示的に上書きしていない下位の決定は有効です。以後に改定された項目（例：タグ仕様 A-06 → `DECISIONS I-30`）は `DECISIONS.md` の該当 ID が最新です。

---

## 1. ゲームの概要

- **ジャンル**: 都市開発シム × 官僚マネジメント × AI解釈ゲーム。ブラウザ向け P0 プロトタイプ（村 → 町、最大50ターン）。
- **検証したい仮説**: 「信頼性が曖昧な情報（新聞・側近報告・地図）を突き合わせて勅令を出す難しさは面白いか」。
- **プレイヤーは都市を直接操作できない。** 干渉できる経路は次の1本だけ。

```
勅令（自然言語、40文字以内）
  → 参謀（LLM。失敗時はテンプレートパーサー）が DecreeIntent（JSON）に翻訳
  → 担当の側近が解釈を歪める（誤読・取り違え・骨抜き）／報告で隠す・欠かす
  → ルールエンジンが決定論的に状態を更新（建物は「発注」、効果は完成後）
```

- 1ターン＝1年。勅令は1ターン1つ。手動で行える介入は側近の**任命／解任**のみ。
- 勝利: 人口300以上・インフラ25以上・役所が建っている（村 → 町）。敗北: 人口0／国庫マイナス／幸福度0（ゲームオーバー）、または50ターン経過（時間切れ）。
- 情報源は3つ（どれも単独では真実を語らない）：**新聞**（偏向・検閲・婉曲）、**側近報告**（隠蔽・欠落・能力差）、**地図**（空洞は見えない）。

### 1.1 プレイヤーに見える値／見えない値

| 区分 | 項目 | 見え方 |
|------|------|--------|
| **台帳（常時表示・6項目）** | 人口・国庫・幸福度・インフラ・汚職率・政治資本 | 画面上部の台帳。前年からの増減を添える（`DECISIONS I-31`） |
| 非表示（派生指標） | 住宅容量・食料・衛生・治安・行政能力 | 新聞と側近報告でしか知れない |
| 非表示（v3.3 秘匿値） | 資材（木材・石材）の在庫、建材表、工期、**労働人口** | 側近報告（工期の見積り・資材不足・無理な命令）と新聞（経済面）から推測する |
| 非表示（内部） | `NewspaperArticle.truthfulness`、偏向の内訳、建物の空洞（hollow）フラグ、`TurnRecord` の分析用フィールド | UI に出さない。`TurnRecord` から取り出せる（分析・sim 用） |

> 注意: `CLAUDE.md` の古い記述に「労働人口を台帳に表示」とあった場合は `DECISIONS I-31` が優先（**表示しない**）。

---

## 2. データモデル

### 2.1 台帳 `Params`（`domain/GameState.ts`）

`population`（人口）／`treasury`（国庫。**負も許す**。負になるとゲームオーバー）／`happiness`（0–100）／`infrastructure`（0–100）／`corruption`（汚職率 0–100）。
年次処理の最後に `clampParams`：幸福度・インフラ・汚職率を [0,100]、人口を 0 以上の整数に丸める。国庫は丸めない。

**初期値**: 人口120・国庫500・幸福度50・インフラ10・汚職率5・政治資本3・木材60・石材40。

**初期建物**（`INITIAL_BUILDINGS`）: 住宅（`residential`）×7、農地（`farm`）×3、井戸（`well`）×1、見張り塔（`watchtower`）×1。開始時に `placeInitialBuildings(saveId)` が区画を割り振る。

### 2.2 `GameState`（セーブの単位。不変オブジェクト）

| フィールド | 内容 |
|------------|------|
| `schemaVersion` | `2`（不一致のセーブは読み込まない。`DECISIONS D-53`） |
| `seed` / `saveId` | 乱数の種。`saveId = "save-" + seed.toString(36)`。新聞の seed と地図の配置に使う |
| `rngState` | 本系列の乱数の状態（毎ターン `playTurn` が復元・保存） |
| `turn` | 次に処理するターン番号（1始まり） |
| `stage` | `"village"` / `"town"`（成功時に town） |
| `params` | 台帳（上記） |
| `buildings[]` | `BuildingInstance { serial, kind, builtTurn, hollow, disclosed, tile:[x,y]\|null }` |
| `nextSerial` | 建物の通し番号 |
| `projects[]` / `nextProjectId` | 工事台帳（§9） |
| `policies` | `{tax_rate, welfare_policy, security_policy}: { level(−2〜+2), turnsLeft }` |
| `materials` | `{ wood, stone }`（秘匿） |
| `event` / `eventCooldown` | 発生中のイベント／次が起きうるまでの年数（初期3） |
| `newspaperState` | `{ threads[], recentTemplates[] }`（継続スレッドと直近3年の使用テンプレート。決定論のため保存） |
| `aides[]` | 在任の側近（最大2） |
| `politicalCapital` | 政治資本 |
| `history[]` | `TurnRecord` の配列（毎ターン1件） |
| `ending` | `null` または `Ending` |

保存しないもの: LLM の会話履歴。

### 2.3 `TurnRecord`（1ターンの記録。3段表示・分析の材料）

`turn, decree, intentDeclaration, interpretation(参謀の解釈), aideAdjustment(側近の補正), execution(notes, cost, baseCostCharged), before, after, actualResult(差分), construction(laborForce, laborDemand, overload, materialShortage, completions[], materialsAfter), events[], derived(年末の派生指標), finance{taxRevenue, upkeep}, intentEvaluation, bonusHappiness, newspaper, aideReports[], ending`。

---

## 3. ターンの流れ（`engine/TurnMachine.playTurn`）

順序は固定です。

1. **エンディング確認**（`ending !== null` なら `GameOverError`）
2. **検証**: 勅令（空・文字数超過・タグ数・タグ重複）、意図宣言、**側近がいる場合のみ政治資本 ≥ 1**（足りなければ `ValidationError`）
3. 乱数状態を `state.rngState` から復元
4. **側近がいる場合のみ**（いなければ勅令は執行されず、政治資本も国庫も消費しない。`D-21`）:
   1. 政治資本 −1
   2. `parseDecree`（参謀の解釈。§5）
   3. `interpret`（担当側近の選択と歪み。§6）。精度に行政能力の加算（`adminBonusOf`：**勅令の時点の建物で計算**＝建てた翌年から効く）
   4. `executeDecree`（発注・政策・イベント解決。§7）
   5. 執行されたとき（`baseCostCharged`）だけ基本コスト **10** を国庫から引く
5. **年次更新** `naturalUpdate`（§8）→ `clampParams`
6. **意図判定とボーナス**（§14）→ 確定した `params`
7. **側近報告**の生成（§6.5）。能力の高い側近が空洞を開示した種類は `disclosed = true`
8. **エンディング判定**（§15）。役所は「建っていれば空洞でも可」（`I-13`）
9. **新聞の生成**（§12）。**開示前の建物で作る**（同じ年に「投書が匂わせ、能力の高い側近が言及する」＝三角測量。`I-36`）。前年の税収は `history.at(-1).finance.taxRevenue`
10. `TurnRecord` を作り、`turn+1`、政治資本 `+1`（上限5）、`history` に追加、`ending` 確定、**セーブ**

任命・解任は `playTurn` の外（別関数 `appoint` / `dismiss`）。

---

## 4. 勅令入力（`domain/Decree.ts`）

- 構造: `{ text: string, tags: DecreeTag[] }`
- **タグは4種・各1個まで**（`I-30`。A-06 を改定）:

| 種類 `kind` | 値 | 効果 |
|-------------|----|------|
| `target`（対象） | 20種の target | 参謀・テンプレートパーサーが target を固定 |
| `scale`（規模） | `small`=25 / `medium`=50 / `large`=80 | magnitude の既定値 |
| `deadline`（期限） | `thisYear` / `fewYears` / `noRush` | **効果なし**（参謀への添え書き） |
| `priority`（優先度） | `high` / `normal` / `low` | **効果なし**（参謀への添え書き） |

- **文字数式**: `text(コードポイント数, 前後の空白除く) + タグ数 × 5 ≦ 40`。`DECREE_CHAR_LIMIT=40, TAG_CHAR_COST=5, MAX_TAGS=4`。残り文字数を常時表示し、超過すると判を押せない。
- 検証エラー: `empty` / `tooLong` / `tooManyTags` / `duplicateTag`（＋ターン処理時の `noPoliticalCapital` / `invalidIntent` / `aidesFull` / `unknownCandidate` / `unknownAide`）。

---

## 5. 参謀（LLM）層 — 翻訳だけを担当

### 5.1 契約

- 入力: **勅令本文（メタ命令除去後）とタグだけ**。`GameState` は一切渡さない（`A-09`）。
- 出力 `DecreeIntent`: `{ action, target|null, magnitude, budget, confidence }`
  - `action ∈ build / tax / invest / reform / appoint / dismiss`
  - `target` は20種の許可リスト。**未知の値は `null`**（＝「意味が取れなかった」no-op）
  - `magnitude` は [−100,100]、`budget` ≥ 0、`confidence` は [0,1] に clamp（clamp した項目は3段表示の1枚目に出す）
  - 建物の個数: 「n 棟」→ magnitude = `34 × n`（最大3棟）
- **LLM の責務は翻訳のみ。** 数値更新・歪み・新聞に LLM は使わない。LLM 出力は「提案」で、検証後にだけ使う。

### 5.2 サニタイズ（`sanitizeDecreeText`）

勅令本文から次の正規表現にマッチした部分を**削除**してから参謀に渡す（削除した場合、3段表示に「メタ命令を無視した」と出る）。システムプロンプトには勅令を連結しない（ユーザーメッセージとして別に渡す）。

- `(官僚|側近|参謀|指示|命令|ルール|規則|設定|プロンプト)を?(無視|忘れ)`
- `ignore\s+(all|previous|the)`
- `system\s*prompt`
- `あなたは.{0,10}(AI|アシスタント|モデル)`
- `JSON(を|で)?(出力|返)`

### 5.3 失敗時の挙動（ゲームを止めない）

`parseDecree` は1試行を **5秒でタイムアウト**、**最大2回リトライ**（指数バックオフ 500ms → 1000ms、**計3試行**）。試行ごとにサービスを呼び直す。

| 失敗理由 `LLMFailureReason` | 再試行 |
|-----------------------------|--------|
| `timeout` / `network` / `invalidJson` / `schemaViolation` | する |
| `rateLimited`（429）/ `rejected`（その他の 4xx） | **しない**（再試行しても変わらず、制限を余計に消費するだけ） |

失敗が確定したら **テンプレートパーサー**で解釈する（`source: "template"`、`fallbackReason` を記録。3段表示の1枚目に理由が出る）。試行失敗は `llm.attemptFailed`、確定は `llm.fallback` としてログに残る（`data: { reason, detail }`。detail は例 `proxy 401: unauthorized`）。

### 5.4 検証（`decodeLLMOutput`）

JSON 文字列またはオブジェクトを受け、`{action, target(string), magnitude, budget, confidence}` の Effect Schema で検証（**余分なキーはスキーマ違反**）。JSON として読めなければ `invalidJson`、スキーマに合わなければ `schemaViolation`。target の許可リスト判定は検証後（`isTarget`）。

### 5.5 テンプレートパーサー（`templateParse`、辞書は `i18n/messages.ts` の `parser`）

優先順位: target ＝ 対象タグ → キーワード辞書。見つからなければ `confidence 0`（no-op）。
action ＝ 辞書 → 無ければ `defaultActionFor(target)`（税率→`tax`、建物→`build`、福祉/治安政策→`invest`）。
magnitude ＝ 規模タグ → 「n棟」→ `34×n` → 文中の数字 → 大/小キーワード（80/25）→ 既定50。負の語があれば符号を負に。確信度は一致時 **0.6**。

- **target キーワード**（上から順に最初に含まれたもの）: `徴税所`→taxoffice、`税率`→tax_rate、`裁判`→courthouse、`診療`→clinic、`医`→clinic、`学校`→school、`寺`→temple、`見張`→watchtower、`塔`→watchtower、`牢`→jail、`役所`→office、`庁舎`→office、`市場`→market、`工房`→workshop、`倉`→granary、`蔵`→granary、`畑`→farm、`農`→farm、`井戸`→well、`水`→well、`長屋`→tenement、`屋敷`→manor、`住宅`→residential、`住居`→residential、`家`→residential、`道`→road、`橋`→road、`税`→tax_rate、`年貢`→tax_rate、`福祉`→welfare_policy、`施し`→welfare_policy、`祭`→welfare_policy、`治安`→security_policy、`汚職`→security_policy、`取締`→security_policy
- **action キーワード**: `減税`→tax、`免除`→tax、`徴`→tax、`増税`→tax、`改革`→reform、`粛正`→reform、`改め`→reform、`投資`→invest、`整備`→invest、`支援`→invest、`建`→build、`築`→build、`造`→build、`作`→build
- **負の規模**: `減税`、`免除`、`軽く`、`下げ`、`緩め`
- **大**: `大いに`、`大規模`、`多く`、`盛大` ／ **小**: `少し`、`わずか`、`小規模`
- **数え方**: `一`→1、`二`→2、`三`→3 ＋ 助数詞 `つ`、`棟`、`軒`、`か所`

### 5.6 モック参謀

`.env.local` の `VITE_LLM_PROXY_URL` と `VITE_LLM_PROXY_TOKEN` の**両方**が無いとき、`LLMServiceTemplateMock`（テンプレートパーサーの結果を600ms遅延して返す）で動く。**このとき LLM は一切呼ばれない。**

### 5.7 LLM プロキシ（Cloudflare Workers、`src/proxy/worker.ts`）

```
[ブラウザ] --POST /v1/decree (Authorization: Bearer <PROXY_TOKEN>)--> [Workers] --POST /v1/chat/completions--> [Mistral: mistral-small-latest]
```

- **API キーはプロキシの Secret にだけ**ある。フロントが持つのは URL と簡易トークン（ビルドに埋め込まれて公開されるので秘密ではない）。**JSON Schema はプロキシ側で固定**（リクエストから受け取らない）。
- リクエスト: `POST /v1/decree`、ボディは `{ "text": string, "tags": DecreeTag[] }` のみ（他のキーは 400 `unexpected_field`）。本文200字・ボディ4096バイト・タグ4個まで。
- レスポンス: 200 `{ "output": <LLM の生の文字列>, "mode": "json_schema" | "json_object" | "fault" }`。エラーは `{ "error": <コード> }`。**出力の検証はクライアント**（`decodeLLMOutput`）。
- 上流への要求: `temperature 0.2`、`max_tokens 200`、システムプロンプト（`src/proxy/prompt.ts`。英語。20種の target の説明と「n棟→34×n」を含む）＋ユーザーメッセージ `{"decree": ..., "tags": [...]}`。`response_format` は **json_schema（strict）→ 400/422 なら json_object** の順に試す（上流タイムアウト 4.5秒、クライアントの5秒より短く）。
- 処理の順序: Origin 検査（許可外は 403 `forbidden_origin`・**CORS ヘッダーなし**）→ ルート（`/v1/decree` 以外 404 `not_found`）→ `OPTIONS` は 204 → `POST` 以外 405 → Secret 未設定は 500 `proxy_misconfigured` → トークン照合（定数時間比較、不一致 401 `unauthorized`）→ レート制限（IP ごと毎分20回、429 `rate_limited` ＋ `Retry-After`）→ サイズ（413 `body_too_large`）→ ボディ検証（400 `invalid_json` / `invalid_body` / `unexpected_field` / `invalid_text` / `text_too_long` / `invalid_tags`）→ 上流呼び出し。
- 上流エラー: 504 `upstream_timeout` / 502 `upstream_unreachable` / 429 `upstream_rate_limited` / 502 `upstream_<status>` / 502 `upstream_no_content` / 502 `upstream_rejected_both_modes`。
- 環境変数（`ProxyEnv`）: `MISTRAL_API_KEY`(Secret)・`PROXY_TOKEN`(Secret)・`ALLOWED_ORIGINS`（カンマ区切り。空なら Origin 付きは全拒否）・`MISTRAL_BASE_URL`・`MISTRAL_MODEL`・`RATE_LIMIT_PER_MINUTE`・`SCHEMA_INCLUDE_RANGES`（`"true"` で minimum/maximum を付ける。Mistral の対応は**未確認**のため既定 false）・`ENVIRONMENT`・`FAULT_MODE`（`ENVIRONMENT=development` のときだけ有効：`timeout` / `invalid_json` / `schema_violation` / `upstream_error`）。
- ログ（`console.log` の JSON）: ステータス・所要時間・文字数・タグ数・モードのみ。**勅令本文は記録しない**。

---

## 6. 側近（`domain/Aide.ts`、`engine/AideInterpreter.ts`）

### 6.1 プロファイル（固定。`DECISIONS D-18`）

| id | 名前 | 区分 | 忠誠 | 能力 | 野心 | 信頼 | 派閥 | 専門 | 紹介文 |
|---|---|---|---|---|---|---|---|---|---|
| `elderSteward` | 老練な代官 | 初期 | 80 | 60 | 30 | 70 | 開発派（development） | インフラ（infrastructure） | 先代から仕える代官。堅実だが新しいことを好まない。 |
| `youngMerchant` | 若い商人上がり | 初期 | 60 | 75 | 70 | 50 | 商業派（commerce） | 経済（economy） | 商才で取り立てられた若者。野心を隠さない。 |
| `retiredCaptain` | 退役した隊長 | 候補 | 75 | 55 | 40 | 55 | 軍事派（military） | 治安（security） | 規律を重んじる元兵士。施しを嫌う。 |
| `templeScribe` | 寺院の書記 | 候補 | 70 | 70 | 20 | 45 | 保守派（conservative） | 経済（economy） | 帳簿に明るい。急な変化を好まない。 |
| `forestWarden` | 森の番人 | 候補 | 65 | 60 | 35 | 60 | 環境派（environment） | 環境（environment） | 水と森を守ってきた。道を通すのを嫌う。 |
| `masonForeman` | 石工の親方 | 候補 | 55 | 80 | 65 | 40 | 開発派（development） | インフラ（infrastructure） | 腕は確かだが、出世を狙っている。 |
| `guildTreasurer` | 組合の会計役 | 候補 | 50 | 85 | 80 | 35 | 商業派（commerce） | 経済（economy） | 数字に強く、野心はさらに強い。 |
| `villageElder` | 村の長老 | 候補 | 85 | 45 | 15 | 75 | 保守派（conservative） | 治安（security） | 村人の信望が厚い。物覚えは衰えてきた。 |

- 任命候補: `ALL_AIDE_PROFILES` から**現職を除いた**中から、`deriveSeed(seed, turn)` 由来の別系列の乱数で**2人**（何度呼んでも同じ。本系列を消費しない）。最大2人まで。任命は政治資本 −1、解任は 0。

### 6.2 担当側近の自動選択（`selectAide`）

①専門一致の側近 → ②**信頼が高い**方 → ③在任が長い方。専門一致が1人なら理由 `specialty`、複数で信頼により決まれば `trust`、誰も一致しなければ全員から信頼順で `offSpecialty`。側近が0人なら `null`（勅令は執行されない）。

**専門一致**（`isSpecialtyMatch`）: `action === "tax"` かつ経済専門、または target が下表に含まれる。表にない target（学校・寺院・福祉政策）は誰とも一致しない。

| 専門 | 一致する target |
|------|-----------------|
| infrastructure | residential, tenement, manor, road, well, granary, office |
| economy | market, farm, workshop, taxoffice, tax_rate |
| security | courthouse, watchtower, jail, security_policy |
| environment | well, farm, granary, clinic |

### 6.3 解釈精度（`computeAccuracy`、0〜1 に clamp）

```
accuracy = adminBonus
         + 0.3
         + ability / 200
         + (専門一致 ? 0.2 : 0)
         + (trust >= 70 ? 0.1 : 0)
         − (野心 >= 70 かつ 派閥対立 ? 0.2 : 0)
adminBonus = min(0.15, 0.05 × 行政能力)
```

**派閥対立**（`isFactionConflict`）:

| 派閥 | 対立する指示 |
|------|--------------|
| development（開発） | 規模が負（縮小） |
| commerce（商業） | 増税（action=tax かつ m>0、または tax_rate で m>0）、徴税所、治安政策、裁判所 |
| conservative（保守） | 大事業（action=build かつ m>60）、長屋、工房 |
| military（軍事） | 福祉政策 |
| environment（環境） | 道路・工房（m>0） |

### 6.4 歪み（`interpret`。次の順に**独立に**判定。任免・target=null は歪めない）

| 歪み | 条件・確率 | 効果 |
|------|-----------|------|
| **誤読**（misread） | 確率 `(1 − accuracy) × 1.0` | magnitude を ×(1 ± U(0.3, 0.5))（過大／過小は等確率） |
| **取り違え**（targetSwap） | **専門外のときだけ**、確率 `(1 − accuracy) × 0.5` | 同じ action で取り違えうる別の target に差し替え（`SWAPPABLE_TARGETS`：build→建物17種、invest→建物＋福祉・治安政策、reform→政策3種） |
| **骨抜き**（waterDown） | **補正後の指示が派閥対立のときだけ**、確率 `0.4 + (100 − loyalty)/200` | effectFactor 0.5。**建物の発注にだけ効き、完成時に半数が空洞になる**（棟数が1なら50%で1棟が空洞）。政策には効かない |

### 6.5 側近報告（`buildAideReports`。在任の**全員**が毎ターン出す）

- **項目**（台帳の変化）: |変化| ≥ 0.5 の台帳項目が候補。
  - **隠蔽**: `野心 ≥ 60 かつ 忠誠 ≤ 60` の側近は、確率 `0.3 + (野心 − 忠誠)/100` で隠蔽状態になり、**悪化した項目**（汚職率は増加、他は減少）を報告から消す。
  - **欠落**: 各項目を確率 `(100 − 能力)/400` で落とす。
  - **信頼 < 40** の側近は報告が**2項目まで**。
- **メモ**（notes）:
  - 担当側近だけ: メタ命令を無視した旨、執行メモ（発注・縮小理由・前提未達・政策変更・no-op）
  - 全員: イベントの発生・継続・解決・自然終了、その年に完成した建物、**工事中の案件の工期の見積り**（真の残り年数に `±(100−能力)/200` の誤差、四捨五入・最小1。進まない工事は「いつ終わるとも知れない」）
  - **隠蔽していない側近だけ**: 資材不足（不足率 > 0.05。> 0.5 なら深刻）、無理な命令（超過率 > 1.5）、**空洞の開示**（能力 ≥ 70 の側近が、未開示の空洞の種類ごとに「○○のうち◯棟は、見かけ倒しで中身がございません」。開示した種類は `disclosed=true` になり、新聞の投書スレッドが終わる）
- 隠蔽・欠落で消えた項目は `AideReport.hiddenItems` / `concealed` に分析用として残る（UI に出さない。`I-02`）。

---

## 7. 執行（`engine/RuleEngine.executeDecree`）

### 7.1 チェックの順序

1. `appoint` / `dismiss` → no-op（`appointDismiss`：任免は勅令でなく御自らお決めください）
2. `target === null` → no-op（`unknownTarget`）
3. `confidence < 0.3` → no-op（`lowConfidence`）
4. magnitude を [−100,100] に clamp → **組合せ表**（`resolveCombination`）

**no-op・前提未達・不成立は国庫を消費しない（基本コスト10も取らない）**。側近報告で理由を返す。

### 7.2 action × target の有効組合せ

| action | 建物（17種） | 政策（3種） |
|--------|--------------|-------------|
| `tax` | `tax_rate` の上げ下げ（target に関わらず。m=0 は no-op） | 同左 |
| `build` | 新築（m ≦ 0 は no-op `nonPositive`） | `reform` と読み替え |
| `invest` | **空洞の建物があれば修繕を優先**、なければ新築（m ≦ 0 は no-op） | 符号どおり（m>0 で上げ、m<0 で下げ。m=0 は no-op） |
| `reform` | **無効**（no-op `invalidCombination`） | 符号どおり |

### 7.3 建物の発注（`orderConstruction`）

1. **前提・上限**を検査（満たさなければ `orderFailed`）:
   - 人口 ≥ 200（屋敷）→ `population`
   - 前提建物が**存在**（役所→裁判所、見張り塔→牢屋。空洞でも存在すればよい）→ `prerequisite`
   - 最大棟数（役所は1。**工事中の分も数える**）→ `maxCount`
2. **要求棟数** = `min(3, max(1, ceil(m / 34)))`（1〜34→1棟、35〜68→2棟、69〜100→3棟）。修繕なら空洞の棟数まで、新築で上限があればその上限まで。
3. **縮小**（A-07）: 買える棟数 = `min(区画の空き, floor((国庫 − 10) / 単価), budget>0 なら floor(budget / 単価))`。一番小さい制約が理由（`tiles` / `treasury` / `budget`）。0なら不成立。縮小したら「要求 → 実際」を3段表示の朱色の訂正線で出す。
4. **単価** = `建設費 × 1.0`（修繕は ×0.5）。**代金は発注時に支払う**（`cost × 棟数`）。維持費は**完成してから**。
5. **区画の確保**: 区画を占める建物は発注時に `chooseTile` で確保して保存（毎年再計算しない。§10）。道路・修繕は区画を取らない。
6. 工事台帳に案件を追加（§9）。発注が成立すれば、そのイベントを解決しうる（§11）。

### 7.4 政策の変更（`changePolicy`）

- 段階: `|m| ≥ 60` なら ±2、それ未満は ±1。水準は −2〜+2 に clamp。**変更した年から** `turnsLeft = 4`。
- **税率を上げた瞬間**は幸福度が `2 × 上げた段階数` 下がる（A-08）。下げたときは落ち込まない。
- 政策は即時（工期なし）。国庫は消費しない（基本コスト10は取る）。
- 効き続ける期間: 決定した年を含め **5回の年次更新**で同じ水準が効き、その後は**1年に1段ずつ 0 へ戻る**（`tickPolicies`：`turnsLeft>0` なら減らすだけ、0 なら水準が1段戻る。`DECISIONS I-27` は「4年」と書いているが**実装は5回**。§19 参照）。

| 政策 | 効果（1段あたり） |
|------|-------------------|
| `tax_rate` | 人頭税収入 `×(1 + 0.15 × 水準)`、幸福の平衡点 `−3 × 水準` |
| `welfare_policy`（福祉） | 幸福の平衡点 `+3 × 水準`、水準>0 のとき毎年 `0.12 × 人口 × 水準` の支出 |
| `security_policy`（治安） | 治安 `+2 × 水準`、幸福の平衡点 `−1.5 × 水準`、水準>0 のとき毎年 `10 × 水準` の支出 |

---

## 8. 年次更新（`naturalUpdate`。式はコードどおり）

記号: `p0` = ターン開始時の台帳、`d` = 派生指標、`f(kind)` = 機能している（空洞でない）棟数、`taxLv/welfareLv/securityLv` = 政策水準。

1. **工事**: `labor = floor(人口 × 0.5)`。`advanceConstruction`（§9）で案件を進め、完成を処理（空洞化判定。§9.4）。`corruption += 工事による上昇`。道路の完成でインフラ加算。
2. **派生指標** `d`（完成後の建物で、年初の人口で。§10.1）。凶作中は食料 ×0.5。
3. **人口**:
   ```
   shortfall = max(0, 食料需要 − 食料) / max(1, 食料需要)
   rate = h ≥ 50 ? 0.04 + (h − 50) × 0.002 : (h − 50) × 0.004          // h = 年初の幸福度
   blocked = 人口 > 住宅容量 || shortfall > 0 || 疫病中
   if (blocked && rate > 0) rate = 0
   rate −= 0.15 × shortfall + (衛生 < 3 ? 0.02 : 0) + (疫病中 ? 0.04 : 0)
   人口' = p0.人口 × (1 + rate)
   過密（人口' > 住宅容量）なら 人口' −= (人口' − 住宅容量) × 0.15
   人口 = floor(max(0, 人口'))   // 浮動小数の誤差を補正した切り捨て（stableFloor）
   ```
4. **国庫**:
   ```
   roadTiles = floor(インフラ / 5)（最大19）
   建物税 = Σ f(kind)×税 + 2 × roadTiles
   税収 = (人口 × 1.45 × (1 + 0.15 × taxLv) + 建物税) × (1 − min(100, 汚職率)/100)
   維持費 = (Σ 全棟(空洞も)×維持費 + 1 × roadTiles) × 1.5 + 15 × 側近数
          + max(0,welfareLv)×0.12×人口 + max(0,securityLv)×10 + (盗賊中 ? 25 : 0)
   国庫 = 国庫 + 税収 − 維持費
   ```
   **空洞の建物は維持費を払い続け、効果はゼロ**（税・幸福・派生指標への寄与なし）。
5. **幸福度**:
   ```
   建物幸福 = Σ f(kind)×幸福 × (120 / max(120, 人口))      // 人口が基準120を超えると効き目が薄まる
   ペナルティ = (過密 ? 3 : 0) + (汚職率 > 50 ? 3 : 0) + (衛生 < 3 ? 3 : 0) + (治安 < 3 ? 3 : 0)
              + 15 × shortfall + (疫病中 ? 6 : 0) + (盗賊中 ? 4 : 0)
   平衡点 = 45 + 建物幸福 + 0.2 × インフラ − 0.2 × 汚職率 − 3×taxLv + 3×welfareLv − 1.5×securityLv − ペナルティ / 0.1
   幸福度 = h + (平衡点 − h) × 0.1
   ```
6. **インフラの劣化・汚職**: 確率 0.3 でインフラ −1。`汚職率 += 0.3 + Σ f(kind)×汚職/年`（裁判所 −3）。
7. **資材**: `木材 += 20 + 3×工房数`、`石材 += 16 + 2×工房数`（上限200）。盗賊中は木材 −20%。
8. **イベント**（§11）。
9. 政策の `tickPolicies`。

この後 `clampParams`、意図判定（§14）。

---

## 9. 工事・労働・資材（v3.3。`domain/Construction.ts`。乱数を使わない純粋関数）

### 9.1 概念

- 勅令は**発注**。効果と維持費は**完成した年から**。取り消しはできない（返金なし）。台帳の案件数に上限は無い（詰め込みすぎは「無理な命令」で罰せられる）。
- 労働人口 `labor = floor(人口 × 0.5)`。割り振りは「担当側近の配下の役人たち」が行う抽象的な仕組み（個別の官僚は作らない）。
- 案件 `Project`: `kind, count, repair, repairSerials, tiles, orderedTurn, work, wood, stone, minTurns, progress, elapsed, worstOverload, worstShortage, waterDown`。仕事量・資材 = 建材表 × 棟数 × （修繕は 0.5）。

### 9.2 1年分の進め方（`advanceConstruction`）

```
需要_i = work_i / minTurns_i            // 最短工期で終えるのに要る労働
総需要 = Σ 需要_i;   超過率 = 総需要 / max(1, labor)
労働割当_i = 総需要 ≤ labor ? 需要_i : labor × 需要_i / 総需要        // 全案件を同じ割合で遅らせる（バランスよく）
必要木材 = Σ wood_i × 割当_i / work_i;  必要石材も同様
比 = min(1, 在庫 / 必要)（木材・石材それぞれ）;  不足率 = 1 − min(木材比, 石材比)
深刻 = 不足率 > 0.5
進捗_i += 深刻 ? 割当_i : 割当_i × (1 − 不足率)      // 軽い不足は「待つ」＝遅れる、深刻なら足りないまま進む＝手抜き
資材 −= 必要 × 比
elapsed_i += 1
worstOverload_i = max(それまで, max(0, 超過率 − 1.5))
worstShortage_i = max(それまで, 深刻 ? 不足率 : 0)
完成 = 進捗 ≥ work かつ elapsed ≥ minTurns        // 最短工期より早くは終わらない
汚職の上昇 = 1.0 × max(0, 超過率 − 1.5) + (深刻 ? 2.0 × 不足率 : 0)     // その年
```

### 9.3 無理な命令と手抜き（まとめ）

| 状態 | 閾値 | 空洞化確率への加算 | 汚職率への加算（毎年） |
|------|------|--------------------|------------------------|
| 無理な命令 | 総需要/労働 > 1.5 | `+0.3 × (超過率 − 1.5)` | `+1.0 × (超過率 − 1.5)` |
| 資材の深刻な不足（手抜き） | 不足率 > 0.5 | `+0.6 × 不足率` | `+2.0 × 不足率` |

### 9.4 完成時の空洞化（`hollowChance` と `completeProjects`）

```
base = 建物が「汚職で空洞化」の対象 ? min(0.3, 汚職率/100) : 0     // 対象: granary / market / workshop / clinic / school
確率 = min(0.9, base + 0.3 × worstOverload + 0.6 × worstShortage)
```

- 棟ごとに `chance(確率)` で空洞を判定（Rng 経由）。**骨抜き**の案件は、棟数>1なら `floor(棟数/2)` 棟以上、1棟なら 50% で1棟を空洞にする。
- **道路**は空洞でもインフラは入る: `+3 × (健全棟数 + 空洞棟数 × 0.5)`。道路は区画を占めず建物インスタンスにならない。
- **修繕**の完成: 対象の建物の `hollow=false`、`disclosed=false` に戻す。
- 空洞の建物は `hollow=true`、`disclosed=false`（側近が開示するまで）。

---

## 10. 派生指標・建物

### 10.1 派生指標（`domain/DerivedStats.computeDerived`、**すべて max(0, …)**）

```
住宅容量 = max(0, Σ f(kind) × 容量)
食料     = max(0, Σ f(kind) × 食料 × (凶作 ? 0.5 : 1));  食料需要 = max(0, 人口 / 12)
過密度   = max(0, (人口 − 住宅容量) / 50)
衛生     = max(0, Σ f(kind) × 衛生 − 過密度)
治安     = max(0, Σ f(kind) × 治安 + 2 × 治安政策水準 − 過密度)
行政能力 = max(0, Σ 機能している建物の行政能力)   // 学校は建ててから5年経つまで 0
```
側近の精度への加算 `min(0.15, 0.05 × 行政能力)`。労働人口 `floor(人口 × 0.5)`。判定はクランプ後の値で行う。

### 10.2 建物一覧（17種。数値は `domain/Buildings.ts`。名称・記号は `i18n/messages.ts`）

「効果」は機能している1棟あたり。空洞は全て 0。

| id | 名称 | 記号 | カテゴリ | 建設費 | 維持費/年 | 効果（1棟・機能しているとき） | 前提 | 上限 | 汚職で空洞化 | 区画 |
|---|---|---|---|---|---|---|---|---|---|---|
| `residential` | 住宅 | 家 | 住宅 | 100 | 2 | 幸福 +1、住宅容量 +20 | — | — | — | 占める |
| `tenement` | 長屋 | 長 | 住宅 | 80 | 1 | 幸福 -2、住宅容量 +35、衛生 -2 | — | — | — | 占める |
| `manor` | 屋敷 | 邸 | 住宅 | 250 | 3 | 税収 +5、幸福 -3、住宅容量 +10 | 人口 200 以上 | — | — | 占める |
| `road` | 道路 | 道 | インフラ | 80 | 0 | インフラ +3 | — | — | — | 占めない（道路の十字） |
| `well` | 井戸 | 井 | インフラ | 60 | 1 | 幸福 +2、衛生 +3 | — | — | — | 占める |
| `granary` | 倉庫 | 倉 | インフラ | 120 | 2 | 食料 +2 | — | — | 対象 | 占める |
| `market` | 市場 | 市 | 経済 | 150 | 2 | 税収 +4、幸福 +1 | — | — | 対象 | 占める |
| `farm` | 農地 | 畑 | 経済 | 70 | 1 | 税収 +1、食料 +4 | — | — | — | 占める |
| `workshop` | 工房 | 工 | 経済 | 120 | 2 | 税収 +3、幸福 -1、衛生 -2 | — | — | 対象 | 占める |
| `office` | 役所 | 旗 | 行政 | 300 | 5 | 行政能力 +1 | — | 1 | — | 占める |
| `taxoffice` | 徴税所 | 徴 | 行政 | 100 | 1 | 税収 +5、幸福 -3 | — | — | — | 占める |
| `courthouse` | 裁判所 | 裁 | 行政 | 200 | 3 | 幸福 +2、汚職率/年 -3 | 役所が存在 | — | — | 占める |
| `clinic` | 診療所 | 医 | 社会 | 120 | 2 | 幸福 +2、衛生 +2 | — | — | 対象 | 占める |
| `school` | 学校 | 学 | 社会 | 180 | 3 | 幸福 +1、行政能力 +0.5 | — | — | 対象 | 占める |
| `temple` | 寺院 | 寺 | 社会 | 150 | 2 | 幸福 +3、治安 +2 | — | — | — | 占める |
| `watchtower` | 見張り塔 | 塔 | 治安 | 100 | 2 | 治安 +3 | — | — | — | 占める |
| `jail` | 牢屋 | 牢 | 治安 | 150 | 2 | 幸福 -2、治安 +4 | 見張り塔が存在 | — | — | 占める |

### 10.3 建材表（**秘匿**。UI に出さない。1棟あたり）

| id | 名称 | 仕事量 work | 最短工期 minTurns | 木材 | 石材 |
|---|---|---|---|---|---|
| `residential` | 住宅 | 40 | 2 | 20 | 5 |
| `tenement` | 長屋 | 30 | 2 | 20 | 0 |
| `manor` | 屋敷 | 90 | 4 | 30 | 30 |
| `road` | 道路 | 20 | 1 | 0 | 10 |
| `well` | 井戸 | 20 | 1 | 0 | 10 |
| `granary` | 倉庫 | 50 | 2 | 25 | 10 |
| `market` | 市場 | 60 | 3 | 25 | 15 |
| `farm` | 農地 | 25 | 1 | 10 | 0 |
| `workshop` | 工房 | 50 | 2 | 25 | 10 |
| `office` | 役所 | 120 | 4 | 30 | 40 |
| `taxoffice` | 徴税所 | 40 | 2 | 15 | 10 |
| `courthouse` | 裁判所 | 100 | 4 | 20 | 40 |
| `clinic` | 診療所 | 50 | 2 | 20 | 15 |
| `school` | 学校 | 80 | 3 | 25 | 25 |
| `temple` | 寺院 | 90 | 4 | 15 | 45 |
| `watchtower` | 見張り塔 | 40 | 2 | 15 | 15 |
| `jail` | 牢屋 | 60 | 3 | 10 | 30 |

### 10.4 target 一覧（20種。単一情報源は `domain/Buildings.ts` の `TARGETS`）

1. `residential`（住宅）
2. `tenement`（長屋）
3. `manor`（屋敷）
4. `road`（道路）
5. `well`（井戸）
6. `granary`（倉庫）
7. `market`（市場）
8. `farm`（農地）
9. `workshop`（工房）
10. `office`（役所）
11. `taxoffice`（徴税所）
12. `courthouse`（裁判所）
13. `clinic`（診療所）
14. `school`（学校）
15. `temple`（寺院）
16. `watchtower`（見張り塔）
17. `jail`（牢屋）
18. `tax_rate`（税率）
19. `welfare_policy`（福祉政策）
20. `security_policy`（治安政策）

Effect Schema・Structured Outputs の JSON Schema・プロキシ・UI のラベルは**ここから生成**する（`engine/IntentSchema.ts`。手書きで複製しない）。

---

## 11. ランダムイベント3種（`domain/Events.ts`、年次更新の最後）

- 同時に起きるのは1つまで。**終わった後3年間（`EVENT_COOLDOWN_TURNS`）は次が起きない。開始から3年間も起きない**（初期 `eventCooldown=3`）。
- 冷却が0のとき、`疫病 → 凶作 → 盗賊` の順に判定し、**最初に当たったものだけ**起きる（乱数は Rng 経由）。
- 継続は最大 **5年**（`EVENT_MAX_TURNS`）。放置して5年目に自然終了すると後遺症が出る。**勅令で解決すると幸福度 +3**（後遺症なし）。

| イベント | 発生確率/年 | 起きている間の効果（毎年） | 解決する勅令（側近の補正後の指示） | 放置の後遺症 |
|----------|-------------|----------------------------|-------------------------------------|--------------|
| 疫病 `epidemic` | 4%（衛生<3 なら +5%） | 人口 −4%・人口増加なし・幸福ペナルティ 6 | 診療所 or 井戸の発注、または福祉政策を上げる | 幸福度 −8 |
| 凶作 `famine` | 5%（機能する倉庫がなければ +3%） | 食料の産出 ×0.5 | 倉庫 or 農地の発注、または税率を下げる | 人口 −5% |
| 盗賊 `bandits` | 4%（治安<3 なら +5%） | 国庫 −25・木材の在庫 −20%・幸福ペナルティ 4 | 見張り塔 or 牢屋の発注、または治安政策を上げる | 汚職率 +5 |

解決の判定は**側近の歪みを受けた後の指示**で、発注または政策変更が**成立した時点**（前提未達・国庫不足の不成立は解決しない）。

---

## 12. 地図（`domain/Map.ts`、`engine/MapUpdater.ts`）

- 10×10 のグリッド。プレイヤーは**区画を指定できない**（自動配置）。地図は状態から毎回導出する（`deriveMap`）。
- **道路**: 中央の十字（行 y=4・列 x=4 の19区画）。`floor(インフラ / 5)` 本だけ、中心から外へ描く（最大19）。区画を占めない。
- **役所**: 中央に固定（区画 [5,5]）。
- **建物の区画**: 道路の十字と役所の区画を除いた80区画を**中央に近い順**に並べ、空き区画のうち、カテゴリの優先順位 `r`（0始まり）× 3 番目から**6区画の帯**を取り、その中から `placementUnit(saveId, serial)`（セーブ ID と通し番号から決まる乱数。本系列を消費しない）で選ぶ。町は中央から外へ育つ。
- カテゴリの優先順位（高いほど内側）:

1. 行政（administration）
2. 住宅（housing）
3. 経済（economy）
4. 社会（social）
5. 治安（security）
6. インフラ（infrastructure）

- **区画は発注時に確保して保存**する（毎年再計算しない。工事中も「普請中」として占有）。修繕の案件は区画を取らず、地図に描かない。
- **タイル種別**: `empty` / `road` / `building`（カテゴリ別の色＋建物の1文字記号）/ `construction`（薄い色＋記号）。**空洞は地図に一切出ない**（開示後も同じ見た目。`I-32`）。
- 地図の下に「普請中の案件」を一覧（建物名・棟数・修繕か・発注した年。工期・進捗・建材は出さない。`I-33`）。凡例はカテゴリ6色＋道路・普請中・空き地。
- 描画: Phaser（CANVAS）。`MapScene` は状態を持たず、`MapState` を受けて描くだけ。

---

## 13. 新聞（`engine/NewspaperGenerator.ts`、テンプレートは `content/newspaper/ja.ts`）

### 13.1 原則

- **LLM を使わない。** 決定論: `seed = hashString("${saveId}:${turn}")`（FNV-1a）で専用の `Rng` を作る（**本系列の乱数を消費しない**）。同じ saveId・turn・状態・`newspaperState` なら同一紙面。
- 紙面は**毎年5〜7記事**、1画面に収まる。セクション（`SECTIONS`）の順に並べる。

| セクション | 1年の枠 | 役割 |
|------------|---------|------|
| front（第一面） | 1 | その年の最大事件（人口・遷移・イベント） |
| social（社会面） | 2 | 幸福・住宅・衛生・教育・信仰・人口動態 |
| economy（経済面） | 1 | 税収・市場・農地・工事の遅れ |
| administration（行政面） | 1 | 汚職・裁判・役所 |
| security（治安面） | 1 | 治安・見張り塔・牢屋 |
| letters（投書欄） | 1 | 住民の声（空洞のにおわせ・側近への噂） |
| advertisement（広告） | 1 | フレーバー |
| weather（天候） | 1 | フレーバー |

### 13.2 生成手順

0. **空洞があれば投書を最優先**: 未開示の空洞の建物があり、`granary_hollow` スレッドが続いていなければ、N-16（投書）を `granary_hollow` スレッドとして最初に採用する。
1. **続報**: 続いているスレッドを（空洞を先に）最大2件まで、対応する記事タイプ（`corruption→N-11`、`granary_hollow→N-16`、`aide_ambition→N-17`、`housing_crisis→N-05`）の続報として載せる（見出しの前に「【続報】」）。解消条件を満たしたスレッドは終了。終わったスレッドは `THREAD_MAX_TURNS`（3）年は再開しない。
2. **セクションごとの抽選**: そのセクションの、**トリガー条件を満たす**未使用の記事タイプのテンプレートから**重み付き抽選**（直近3年に載ったテンプレートは重み ×0.3）。枠が尽きるか候補が尽きるまで繰り返す。**同じ記事タイプは1号に1本**。
3. **7本で打ち切り**（優先: スレッド → 第一面 → 負の記事 → その他 → フレーバー）。
4. **偏向の変換**（記事ごと）:
   - **検閲（削除）**: 負の記事（イベント記事を除く）を確率 `0.2 × 検閲感度` で削除。
   - **官僚圧力（称賛転換）**: 称賛版の文面を持つ記事を確率 `0.1 × 官僚感度` で称賛版に差し替え。
   - **思想的偏向（ヘッジ）**: 確率 `0.3 × max(思想感度, 数値スロットなしなら1)`。数値は10の位に丸めて「概ね／約／およそ」を前置、数値のない記事は「どうやら／噂では／聞くところでは」。
   - **婉曲化**: `{euphemism}` スロットに婉曲語（「一時的な調整」など）。
   - `truthfulness = max(0, 1 − 0.1×ヘッジ − 0.2×婉曲 − 0.5×称賛)`（**UI 非表示**）。
5. **5本未満なら**フレーバー（広告 N-18・天候 N-19・人口動態 N-20）で穴埋め。
6. **新しいスレッドを開始**: 汚職率 > 30（`corruption`）、未開示の空洞（`granary_hollow`）、野心 ≥ 70 の側近（`aide_ambition`）、人口 > 住宅容量（`housing_crisis`）。長さは `housing_crisis`＝解消まで、`aide_ambition`＝2、他は2〜3年（Rng）。
7. セクション順に並べ、`recentTemplates` を更新（直近3年分を保持）。

**スロット**（`SLOT_NAMES`）: `num, pct, place, aide, building, faction, season, hedge, euphemism, event`。文面の `{slot}` は `slots` に宣言したものと一致する必要があり、**未定義スロットは `Effect.die`**。季節は**号ごとに1つ**。

### 13.3 トリガー

`populationUp/Down`（人口の前年差が ±1 以上）／`nearTransition`（成功3条件のうち2つを満たし、残り1つが目標の90%以上。役所は発注済みなら可）／`lowHappiness`（<40）／`housingShortage`（人口>住宅容量）／`lowSanitation`（<3）／`educationBuilt`（学校・寺院が完成した年）／`taxUp`（前年より税収増）／`commerceBuilt`（市場・工房が完成）／`harvest`（食料>0）／`highCorruption`（>30）／`courtActive`（裁判所が完成した年、または機能中）／`officeActive`（機能する役所があり側近がいる）／`lowSecurity`（<3）／`securityBuilt`（見張り塔・牢屋が完成）／`hollowBuilding`（未開示の空洞がある）／`ambitiousAide`（野心≥70）／`constructionTrouble`（工事中で資材不足>0.05 または超過>1.5）／`epidemic` `famine` `bandits`（そのイベント中）／`always`。

### 13.4 テンプレート一覧（`28`本。Effect Schema で読み込み時に検証。`engine/NewspaperTemplates.ts`）

内訳: 記事タイプ N-01〜N-20（20種）＋バリエーション4本（N-01/09/16/18 に各+1）＝24本、イベント記事 E-01〜E-03 と工事の遅れ N-21（`Z-16`）を加えて計28本。検証内容は、形・感度が [0,1]・スロットの宣言と文面の一致・`num` と `numberSource` の対応・ID の重複なし。壊れていれば起動時に落ちる。

| id | 記事タイプ | セクション | トリガー | 重み | 負の記事 | スレッド | 検閲されない | 称賛版 | スロット | 数値の出所 | 偏向感度（思想/検閲/官僚） |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `N-01` | N-01 | 第一面 | `populationUp` | 3 | — | — | — | — | place, hedge, num | population | 1/0/0 |
| `N-01b` | N-01 | 第一面 | `populationUp` | 3 | — | — | — | — | place, hedge, num | population | 1/0/0 |
| `N-02` | N-02 | 第一面 | `populationDown` | 3 | ○ | — | — | — | hedge, num, euphemism | population | 0.5/1/0 |
| `N-03` | N-03 | 第一面 | `nearTransition` | 4 | — | — | — | — | hedge, num | population | 1/0/0.3 |
| `N-04` | N-04 | 社会 | `lowHappiness` | 2 | ○ | — | — | — | place, euphemism | — | 0.5/1/0 |
| `N-05` | N-05 | 社会 | `housingShortage` | 3 | ○ | housing_crisis | — | — | place | — | 0.5/1/0 |
| `N-06` | N-06 | 社会 | `lowSanitation` | 3 | ○ | — | — | — | place, hedge | — | 0.3/1/0 |
| `N-07` | N-07 | 社会 | `educationBuilt` | 3 | — | — | — | — | building, faction | — | 0.5/0/0 |
| `N-20` | N-20 | 社会 | `always` | 1 | — | — | — | — | place | — | 0/0/0 |
| `N-08` | N-08 | 経済 | `taxUp` | 2 | — | — | — | — | hedge, num | taxRevenue | 1/0/0 |
| `N-09` | N-09 | 経済 | `commerceBuilt` | 3 | — | — | — | — | building, faction | — | 0.5/0/0 |
| `N-09b` | N-09 | 経済 | `commerceBuilt` | 2 | — | — | — | — | building, faction | — | 0.5/0/0 |
| `N-10` | N-10 | 経済 | `harvest` | 1 | — | — | — | — | season, place | — | 0.5/0/0 |
| `N-21` | N-21 | 経済 | `constructionTrouble` | 3 | ○ | — | — | あり | building, euphemism | — | 0.3/1/0.5 |
| `N-11` | N-11 | 行政 | `highCorruption` | 3 | ○ | corruption | — | あり | euphemism | — | 0.3/0.5/1 |
| `N-12` | N-12 | 行政 | `courtActive` | 2 | — | — | — | — | faction | — | 0.5/0/0.3 |
| `N-13` | N-13 | 行政 | `officeActive` | 1 | — | — | — | — | aide | — | 0.3/0/1 |
| `N-14` | N-14 | 治安 | `lowSecurity` | 3 | ○ | — | — | — | place, hedge | — | 0.3/1/0 |
| `N-15` | N-15 | 治安 | `securityBuilt` | 3 | — | — | — | — | building, faction | — | 0.5/0/0 |
| `N-16` | N-16 | 投書 | `hollowBuilding` | 6 | ○ | granary_hollow | — | — | building, hedge | — | 0/1/0 |
| `N-16b` | N-16 | 投書 | `hollowBuilding` | 6 | ○ | granary_hollow | — | — | building, place | — | 0/1/0 |
| `N-17` | N-17 | 投書 | `ambitiousAide` | 2 | ○ | aide_ambition | — | — | aide, hedge | — | 0/1/0 |
| `N-18` | N-18 | 広告 | `always` | 1 | — | — | — | — | faction, building | — | 0/0/0 |
| `N-18b` | N-18 | 広告 | `always` | 1 | — | — | — | — | building, place | — | 0/0/0 |
| `N-19` | N-19 | 天候 | `always` | 1 | — | — | — | — | season, place | — | 0/0/0 |
| `E-01` | E-01 | 第一面 | `epidemic` | 10 | ○ | — | ○ | — | place, euphemism | — | 0.3/0/0 |
| `E-02` | E-02 | 第一面 | `famine` | 10 | ○ | — | ○ | — | season, place | — | 0.3/0/0 |
| `E-03` | E-03 | 第一面 | `bandits` | 10 | ○ | — | ○ | — | place, hedge | — | 0.3/0/0 |

### 13.5 UI 表示（`ui/panels/NewspaperPanel.tsx`）

第一面を大きく、他は2段組（投書は囲み、広告は枠）。真実度・偏向の内訳は出さない。創刊号（まだ年が無い）は固定文。末尾の注記「数値には誤差を含みます」。

---

## 14. 結果表示と意図宣言

### 14.1 結果の3段表示＋意図比較（`engine/ResultView.ts`、`ui/panels/ResultStack.tsx`）

書類が重なり、めくって下層を見る。順に:

1. **参謀の解釈**: 勅令の引用、解釈の出どころ（LLM／書記がテンプレートで解釈）、要約（action・target・magnitude・budget）、フォールバック理由、メタ命令の除去、clamp した項目。
2. **側近による補正**: 選ばれた側近と**選定理由**（専門一致／信頼／専門外）、解釈精度、歪み（誤読・取り違え・骨抜きを**朱色の訂正線**で）、執行メモ（発注した棟数、縮小の理由と「要求 → 実際」、不成立の理由、政策変更）。**隠蔽は出さない**（`I-02`）。
3. **実際の結果**: 5項目の増減表、その年に完成した建物、イベント。**空洞になった棟数は出さない**。
4. **意図比較**（宣言した場合のみ）: 宣言と実測、達成か、ボーナス。

めくった回数と最も深く見た枚数を `result.closed` に記録。

### 14.2 意図宣言（`engine/IntentEvaluator.ts`。任意）

`{ targetParam(5項目), direction(increase/decrease/absolute), targetValue(>0) }`。判定は**ターン全体の変化**（自然変化込み・ボーナス適用前）で単純比較: increase＝増加量、decrease＝減少量、absolute＝到達値が `targetValue` 以上。**達成時のみ幸福度 +5**（clamp後）。ペナルティなし。

---

## 15. エンディング（`domain/Ending.ts`）

判定順（**ゲームオーバー優先**）: 人口 ≤ 0 → 国庫 < 0 → 幸福度 ≤ 0 → 成功（人口 ≥ 300 かつ インフラ ≥ 25 かつ 役所が建っている）→ 時間切れ（処理し終えたターンが 50）。成功なら `stage = "town"`。

---

## 16. 永続化・計測・乱数

### 16.1 セーブ

localStorage の1スロット（キー `imperial-decree/save`）、JSON。`schemaVersion` が一致しなければ読み込まない。起動時、未終了のセーブがあれば続きから、無ければ新規。

### 16.2 乱数（決定論）

`mulberry32`（`domain/Prng.ts`）。乱数は必ず `Rng` サービス（`services/Rng.ts`）経由。`Math.random` は eslint で禁止。本系列は `GameState.rngState` に保存。**本系列を消費しない別系列**: 任命候補（`deriveSeed(seed, turn)`）、新聞（`hash(saveId, turn)`）、区画（`placementUnit`）。同じ seed・同じ入力・同じ LLM 出力なら同じ結果。

### 16.3 計測ログ（`engine/Telemetry.ts`、キー `imperial-decree/log`、最大5000件）

| イベント | 内容 |
|----------|------|
| `session.start` | sessionId, llmMode(`proxy`/`mock`) |
| `game.start` / `game.restart` / `game.end` | gameId, seed, restartIndex, resumed / turn, ended / turns, ending |
| `turn.submitted` | 文字数, タグ種別, 意図宣言の有無, 熟考時間(deliberationMs) |
| `turn.resolved` | 解釈の出どころ(llm/template), 意図宣言と達成, ボーナス |
| `result.closed` | めくった回数, 最も深い枚 |
| `aide.appointed` / `aide.dismissed` | aideId |
| `newspaper.read` | 号ごとの閲覧時間（ポインタかフォーカスが紙面にあった時間。タブを離れている間は数えない）, 記事数, 投書の有無 |
| `newspaper.letters` | 投書欄の記事に 1.2秒（`LETTERS_DWELL_MS`）以上とどまった号ごとに1回 |
| `target.used` | 側近が実際に執り行った target（歪み後）と結果（`ordered`/`repair`/`failed`/`policy`/`noop`）と棟数 |
| `llm.attemptFailed` / `llm.fallback` | `{reason, detail}`（エンジンが出す） |

「記録を書き出す」ボタンで JSON を書き出せる。書き込み失敗でゲームは止めない。

---

## 17. 画面（`ui/`）

- 世界観: 「机の上の書類と、広げた地図」。配色は SPEC 12.3（純色禁止、朱色のみアクセント）、フォントは Noto Serif JP / Noto Sans JP（OFL、`@fontsource`）。演出は判子アニメ（CSS transition 1秒）と紙のフェードのみ。素材は `docs/ASSETS.md`。
- 構成: ヘッダー（題・年・「新しく始める」・「AI診断」リンク・「記録を書き出す」）→ **台帳**（6項目）→ 3列（**新聞** ／ **地図・普請中の案件・勅令入力** ／ **側近**）。幅 1280px 未満は2列、1100px 未満は1列。結果は重なる書類のオーバーレイ、終了は終幕画面。
- 勅令入力: 本文、残り文字数、タグ4種（対象／規模／期限／優先度）、意図宣言（余白に鉛筆書きの体裁）、判子ボタン（押すと1秒のアニメののち送信）。Enter で押印。処理中は「参謀が考えている」。
- **UI にゲームロジックを書かない**。UI は `ui/runtime.ts` 経由で `TurnMachine` を呼び、状態を描画するだけ。

### 17.1 AI診断画面（`?debug`。`DECISIONS I-41`）

`/?debug` で開く（ゲームの状態には触れない）。URL・トークンはこの画面の入力で上書きできる（ゲームの設定は変わらない）。6段階を順に切り分ける。

| 段階 | 内容 | 主な結果コード |
|------|------|----------------|
| ① 設定 | URL・トークンの有無、URL に `/v1/decree` を含めていないか、https のページから http のプロキシ（混在コンテンツ） | `config.ok/noUrl/badUrl/noToken/hasPath/mixedContent` |
| ② 到達 | `no-cors` の fetch で「接続できるか」だけを見る | `reach.ok/unreachable/timeout` |
| ③ 認証・CORS | わざと間違ったトークンで POST。401 が読めれば CORS・Origin 許可・トークン検査が働いている | `auth.ok/blocked/misconfigured/forbiddenOrigin/rateLimited/open/unexpected` |
| ④ 呼び出し | 本物のトークンで POST（プロキシ → Mistral） | `call.ok/slow/blocked/timeout/http/<プロキシのエラーコード>` |
| ⑤ 検証 | ④の出力をゲームと同じスキーマにかける（手で貼った出力も可） | `validate.ok/invalidJson/schemaViolation` |
| ⑥ ゲームと同じ経路 | 5秒・リトライ2回・フォールバック込みで `parseDecree` を実行 | `pipeline.ok/retried/fallback.<理由>` |

前の段階が失敗すると、先へ進んでも意味のない段階は省略（skip）。各コードに「考えられる原因」と「確かめること・直し方」を出す（`ui/debugReport.ts`、文言は `messages.ui.debug.hints`）。「診断結果をコピー」で、トークンを伏せたレポート（先頭2文字と長さのみ）を作れる。画面下部に、ゲーム中の LLM 失敗の集計（`summarizeLlmLog`）。診断はプロキシのレート制限と Mistral を数回消費する。
**「このビルドの参謀」がモックと出ていれば、ゲームは LLM を呼んでいない。**

---

## 18. 付録

### 付録A. 定数一覧（`src/domain/constants.ts` を機械的に抜き出し）

バランス値は**すべてここ**に集約する（マジックナンバー禁止）。建物ごとの数値は §10.2。変更時は `docs/BALANCE.md` も更新する。

### 初期値・資源

| 定数 | 値 | 説明 |
|---|---|---|
| `INITIAL_POPULATION` | `120` |  |
| `INITIAL_TREASURY` | `500` |  |
| `INITIAL_HAPPINESS` | `50` |  |
| `INITIAL_INFRASTRUCTURE` | `10` |  |
| `INITIAL_CORRUPTION` | `5` |  |
| `INITIAL_POLITICAL_CAPITAL` | `3` |  |
| `POLITICAL_CAPITAL_INCOME` | `1` |  |
| `POLITICAL_CAPITAL_MAX` | `5` |  |
| `DECREE_POLITICAL_COST` | `1` |  |
| `APPOINT_POLITICAL_COST` | `1` |  |
| `DISMISS_POLITICAL_COST` | `0` |  |
| `DECREE_BASE_COST` | `10` |  |
| `MAX_TURNS` | `50` |  |
| `MAX_AIDES` | `2` |  |
| `APPOINT_CANDIDATE_COUNT` | `2` |  |

### 勅令入力

| 定数 | 値 | 説明 |
|---|---|---|
| `DECREE_CHAR_LIMIT` | `40` |  |
| `TAG_CHAR_COST` | `5` |  |
| `MAX_TAGS` | `4` |  |
| `SCALE_TAG_MAGNITUDE` | `{ small: 25, medium: 50, large: 80 } as const` |  |
| `DEFAULT_TEMPLATE_MAGNITUDE` | `50` |  |
| `TEMPLATE_MATCH_CONFIDENCE` | `0.6` |  |
| `INTENT_BONUS_HAPPINESS` | `5` |  |

### パラメータ範囲

| 定数 | 値 | 説明 |
|---|---|---|
| `PARAM_MIN` | `0` |  |
| `PARAM_MAX` | `100` |  |
| `MAGNITUDE_MIN` | `-100` |  |
| `MAGNITUDE_MAX` | `100` |  |
| `CONFIDENCE_MIN` | `0` |  |
| `CONFIDENCE_MAX` | `1` |  |
| `BUDGET_MIN` | `0` |  |
| `LOW_CONFIDENCE_THRESHOLD` | `0.3` |  |

### 人口（BALANCE §15, §26）

| 定数 | 値 | 説明 |
|---|---|---|
| `HAPPINESS_GROWTH_THRESHOLD` | `50` |  |
| `HAPPINESS_NEUTRAL` | `50` |  |
| `POPULATION_GROWTH_BASE` | `0.04` |  |
| `POPULATION_GROWTH_PER_HAPPINESS` | `0.002` |  |
| `POPULATION_OUTFLOW_PER_HAPPINESS` | `0.004` |  |
| `OVERCROWD_OUTFLOW_RATE` | `0.15` |  |
| `OVERCROWD_DIVISOR` | `50` | 過密の度合い = (人口 − 住宅容量) / この値（v3.2 §2.5） |
| `PEOPLE_PER_FOOD` | `12` |  |
| `FAMINE_HAPPINESS_PENALTY` | `15` |  |
| `FAMINE_OUTFLOW_RATE` | `0.15` |  |
| `SANITATION_LOW` | `3` |  |
| `SANITATION_PENALTY` | `3` |  |
| `DISEASE_OUTFLOW_RATE` | `0.02` |  |
| `SECURITY_LOW` | `3` |  |
| `SECURITY_PENALTY` | `3` |  |
| `SANITATION_BASE` | `0` | 予備のベースライン（既定0。BALANCE §13） |
| `SECURITY_BASE` | `0` |  |

### 税収と支出（BALANCE §12, §14, §26）

| 定数 | 値 | 説明 |
|---|---|---|
| `TAX_PER_CAPITA` | `1.45` |  |
| `AIDE_SALARY` | `15` |  |
| `UPKEEP_MULTIPLIER` | `1.5` |  |
| `BUILD_COST_MULTIPLIER` | `1.0` |  |
| `ROAD_TILE_TAX` | `2` |  |
| `ROAD_TILE_UPKEEP` | `1` |  |
| `PERCENT` | `100` |  |

### 幸福度（BALANCE §15）

| 定数 | 値 | 説明 |
|---|---|---|
| `HAPPINESS_EQUILIBRIUM_BASE` | `45` |  |
| `HAPPINESS_PER_INFRA` | `0.2` |  |
| `HAPPINESS_REF_POP` | `120` |  |
| `HAPPINESS_PENALTY_PER_CORRUPTION` | `0.2` |  |
| `HAPPINESS_REVERT_RATE` | `0.1` |  |
| `CROWDING_HAPPINESS_PENALTY` | `3` |  |
| `NEGLECTED_CORRUPTION_THRESHOLD` | `50` |  |
| `NEGLECTED_CORRUPTION_PENALTY` | `3` |  |

### インフラ・汚職

| 定数 | 値 | 説明 |
|---|---|---|
| `INFRA_DECAY_CHANCE` | `0.3` |  |
| `INFRA_DECAY_AMOUNT` | `1` |  |
| `CORRUPTION_DRIFT_PER_TURN` | `0.3` |  |

### 建設（BALANCE §14, §21）

| 定数 | 値 | 説明 |
|---|---|---|
| `MAGNITUDE_PER_BUILDING` | `34` |  |
| `MAX_BUILD_PER_DECREE` | `3` |  |
| `HOLLOW_ROAD_INFRA_FACTOR` | `0.5` | 道路を手抜きされたときに残るインフラの割合 |
| `SCHOOL_ADMIN_DELAY_TURNS` | `5` |  |
| `ADMIN_ACCURACY_PER_POINT` | `0.05` |  |
| `ADMIN_ACCURACY_MAX` | `0.15` |  |
| `HOLLOW_REPAIR_COST_RATIO` | `0.5` |  |

### 労働人口と資材（BALANCE §22〜§24、v3.3）

| 定数 | 値 | 説明 |
|---|---|---|
| `LABOR_RATIO` | `0.5` |  |
| `OVERLOAD_SEVERE` | `1.5` |  |
| `OVERLOAD_HOLLOW_GAIN` | `0.3` |  |
| `OVERLOAD_CORRUPTION_PER_TURN` | `1.0` |  |
| `INITIAL_WOOD` | `60` |  |
| `INITIAL_STONE` | `40` |  |
| `WOOD_INCOME` | `20` |  |
| `STONE_INCOME` | `16` |  |
| `WORKSHOP_WOOD` | `3` |  |
| `WORKSHOP_STONE` | `2` |  |
| `MATERIAL_CAP` | `200` |  |
| `SHORTAGE_SEVERE` | `0.5` |  |
| `SHORTAGE_HOLLOW_GAIN` | `0.6` |  |
| `SHORTAGE_CORRUPTION_PER_TURN` | `2.0` |  |
| `HOLLOW_CHANCE_CAP` | `0.9` | 完成時の空洞化確率の上限 |
| `HOLLOW_MAX_CHANCE` | `0.3` | 汚職率そのものによる空洞化確率の上限（v3.2 §2.8） |

### 政策（BALANCE §16）

| 定数 | 値 | 説明 |
|---|---|---|
| `POLICY_LEVEL_MAX` | `2` |  |
| `POLICY_DURATION_TURNS` | `4` |  |
| `POLICY_LARGE_MAGNITUDE` | `60` |  |
| `TAX_RATE_INCOME_PER_LEVEL` | `0.15` |  |
| `TAX_RATE_HAPPINESS_PER_LEVEL` | `3` |  |
| `TAX_RATE_SHOCK_PER_LEVEL` | `2` |  |
| `WELFARE_HAPPINESS_PER_LEVEL` | `3` |  |
| `WELFARE_COST_PER_CAPITA_PER_LEVEL` | `0.12` |  |
| `SECURITY_POLICY_SECURITY_PER_LEVEL` | `2` |  |
| `SECURITY_POLICY_HAPPINESS_PER_LEVEL` | `1.5` |  |
| `SECURITY_POLICY_COST_PER_LEVEL` | `10` |  |

### ランダムイベント（BALANCE §25、DECISIONS §12.4）

| 定数 | 値 | 説明 |
|---|---|---|
| `EVENT_COOLDOWN_TURNS` | `3` |  |
| `EVENT_MAX_TURNS` | `5` |  |
| `EVENT_RESOLVE_HAPPINESS` | `3` |  |
| `EPIDEMIC_CHANCE` | `0.04` |  |
| `EPIDEMIC_CHANCE_LOW_SANITATION` | `0.05` |  |
| `EPIDEMIC_POPULATION_LOSS` | `0.04` |  |
| `EPIDEMIC_HAPPINESS_PENALTY` | `6` |  |
| `EPIDEMIC_AFTERMATH_HAPPINESS` | `8` |  |
| `FAMINE_EVENT_CHANCE` | `0.05` |  |
| `FAMINE_EVENT_CHANCE_NO_GRANARY` | `0.03` |  |
| `FAMINE_EVENT_FOOD_FACTOR` | `0.5` |  |
| `FAMINE_EVENT_AFTERMATH_POPULATION` | `0.05` |  |
| `BANDIT_CHANCE` | `0.04` |  |
| `BANDIT_CHANCE_LOW_SECURITY` | `0.05` |  |
| `BANDIT_TREASURY_LOSS` | `25` |  |
| `BANDIT_WOOD_LOSS` | `0.2` |  |
| `BANDIT_HAPPINESS_PENALTY` | `4` |  |
| `BANDIT_AFTERMATH_CORRUPTION` | `5` |  |

### 側近の解釈精度（SPEC §7.6 / A-04）

| 定数 | 値 | 説明 |
|---|---|---|
| `ACCURACY_BASE` | `0.3` |  |
| `ACCURACY_ABILITY_DIVISOR` | `200` |  |
| `ACCURACY_SPECIALTY_BONUS` | `0.2` |  |
| `ACCURACY_TRUST_THRESHOLD` | `70` |  |
| `ACCURACY_TRUST_BONUS` | `0.1` |  |
| `ACCURACY_AMBITION_THRESHOLD` | `70` |  |
| `ACCURACY_AMBITION_PENALTY` | `0.2` |  |

### 歪み（SPEC §6.4）

| 定数 | 値 | 説明 |
|---|---|---|
| `MISREAD_CHANCE_SCALE` | `1.0` |  |
| `MISREAD_MIN` | `0.3` |  |
| `MISREAD_MAX` | `0.5` |  |
| `MISREAD_UPWARD_CHANCE` | `0.5` | 誤読が過大側に振れる確率（符号は等確率） |
| `TARGET_SWAP_CHANCE_SCALE` | `0.5` |  |
| `WATER_DOWN_BASE_CHANCE` | `0.4` |  |
| `WATER_DOWN_LOYALTY_DIVISOR` | `200` |  |
| `WATER_DOWN_EFFECT_FACTOR` | `0.5` |  |
| `CONCEAL_AMBITION_MIN` | `60` |  |
| `CONCEAL_LOYALTY_MAX` | `60` |  |
| `CONCEAL_BASE_CHANCE` | `0.3` |  |
| `CONCEAL_DIVISOR` | `100` |  |
| `CONSERVATIVE_LARGE_MAGNITUDE` | `60` | 保守派が「急な大事業」とみなす規模 |

### 側近報告

| 定数 | 値 | 説明 |
|---|---|---|
| `REPORT_OMIT_CHANCE_DIVISOR` | `400` |  |
| `REPORT_LOW_TRUST_THRESHOLD` | `40` |  |
| `REPORT_LOW_TRUST_MAX_ITEMS` | `2` |  |
| `REPORT_MIN_DELTA` | `0.5` | これ未満の変化は報告しない |

### 成功条件

| 定数 | 値 | 説明 |
|---|---|---|
| `SUCCESS_POPULATION` | `300` |  |
| `SUCCESS_INFRASTRUCTURE` | `25` |  |

### 地図（v3.2 §2.6 / BALANCE §14）

| 定数 | 値 | 説明 |
|---|---|---|
| `GRID_SIZE` | `10` |  |
| `INFRA_PER_ROAD_TILE` | `5` |  |
| `ROAD_TILE_MAX` | `19` | 道路に予約する区画（十字）の数。建物は残りの区画に置く |
| `HOLLOW_DISCLOSE_ABILITY_MIN` | `70` |  |

### 新聞 v2（v3.2 §1.5〜§1.7 / BALANCE §18）

| 定数 | 値 | 説明 |
|---|---|---|
| `NEWSPAPER_IDEOLOGICAL_BIAS` | `30` |  |
| `NEWSPAPER_CENSORSHIP` | `20` |  |
| `NEWSPAPER_BUREAUCRATIC_PRESSURE` | `10` |  |
| `NEWSPAPER_MAX_ARTICLES` | `7` |  |
| `NEWSPAPER_MIN_ARTICLES` | `5` |  |
| `NEWSPAPER_MAX_THREAD_ARTICLES` | `2` |  |
| `NEWSPAPER_RECENT_TURNS` | `3` |  |
| `NEWSPAPER_RECENT_WEIGHT` | `0.3` |  |
| `THREAD_MIN_TURNS` | `2` |  |
| `THREAD_MAX_TURNS` | `3` |  |
| `NEWS_LOW_HAPPINESS` | `40` |  |
| `NEWS_HIGH_CORRUPTION` | `30` |  |
| `NEWS_CORRUPTION_RESOLVED` | `20` |  |
| `NEWS_AMBITIOUS_AIDE` | `70` |  |
| `NEWS_NEAR_TRANSITION_RATIO` | `0.9` | 遷移間近：成功条件のうち2つを満たし、残り1つがこの割合以上（W-08。記事 N-03） |
| `NEWS_HEDGE_ROUNDING` | `10` | 数値をぼかすときの丸め単位 |
| `TRUTH_PENALTY_HEDGE` | `0.1` |  |
| `TRUTH_PENALTY_EUPHEMISM` | `0.2` |  |
| `TRUTH_PENALTY_PRAISE` | `0.5` |  |
| `ESTIMATE_ERROR_DIVISOR` | `200` | 側近報告での工期見積りの誤差（能力が低いほど大きい） |

### LLM

| 定数 | 値 | 説明 |
|---|---|---|
| `LLM_TIMEOUT_MS` | `5000` |  |
| `LLM_MAX_RETRIES` | `2` |  |
| `LLM_BACKOFF_BASE_MS` | `500` |  |
| `LLM_TEMPERATURE` | `0.2` |  |

### LLM プロキシ（src/proxy、SPEC §11.6）

| 定数 | 値 | 説明 |
|---|---|---|
| `LLM_MODEL` | `"mistral-small-latest"` |  |
| `PROXY_UPSTREAM_TIMEOUT_MS` | `4500` | プロキシから Mistral への待ち時間。クライアントの LLM_TIMEOUT_MS より短くして、先にプロキシが 504 を返す |
| `PROXY_MAX_OUTPUT_TOKENS` | `200` |  |
| `PROXY_MAX_TEXT_CHARS` | `200` | 本文の最大文字数（クライアント側の文字数制限より緩い安全網） |
| `PROXY_MAX_BODY_BYTES` | `4096` |  |
| `PROXY_RATE_LIMIT_PER_MINUTE` | `20` |  |
| `PROXY_RATE_LIMIT_WINDOW_MS` | `60_000` |  |
| `LLM_MOCK_DELAY_MS` | `600` | モック参謀の思案時間（P2：UI 確認用。P3 で本番 LLM に置き換える） |

### 計測ログ

| 定数 | 値 | 説明 |
|---|---|---|
| `LOG_STORAGE_KEY` | `"imperial-decree/log"` |  |
| `LOG_MAX_ENTRIES` | `5000` |  |

### UI 演出

| 定数 | 値 | 説明 |
|---|---|---|
| `STAMP_ANIMATION_MS` | `1000` | 判子アニメの長さ（SPEC §12.8：簡易1秒） |
| `PAPER_FADE_MS` | `400` |  |
| `LETTERS_DWELL_MS` | `1200` | 投書欄の記事にこれだけとどまったら「参照した」と数える（v3.2 §3.2 の計測） |

### セーブ

| 定数 | 値 | 説明 |
|---|---|---|
| `SAVE_SCHEMA_VERSION` | `2` |  |
| `SAVE_STORAGE_KEY` | `"imperial-decree/save"` |  |

### シミュレーション（npm run sim 専用）

| 定数 | 値 | 説明 |
|---|---|---|
| `SIM_GAMES` | `1000` |  |
| `HEURISTIC_NOISE` | `0.35` |  |
| `SIM_RANDOM_MAGNITUDE_MIN` | `10` |  |
| `SIM_RANDOM_MAGNITUDE_MAX` | `100` |  |
| `SIM_RANDOM_NEGATIVE_CHANCE` | `0.15` |  |

### 付録B. テスト一覧（237件・24ファイル、すべて通過）

| ファイル | テスト数 |
|---|---|
| `src/domain/Aide.test.ts` | 14 |
| `src/domain/Construction.test.ts` | 8 |
| `src/domain/Decree.test.ts` | 9 |
| `src/domain/DerivedStats.test.ts` | 5 |
| `src/domain/Ending.test.ts` | 7 |
| `src/domain/Map.test.ts` | 9 |
| `src/engine/AideInterpreter.test.ts` | 13 |
| `src/engine/DecreeParser.test.ts` | 28 |
| `src/engine/IntentEvaluator.test.ts` | 6 |
| `src/engine/IntentSchema.test.ts` | 5 |
| `src/engine/LLMDiagnostics.test.ts` | 20 |
| `src/engine/MockLLM.test.ts` | 2 |
| `src/engine/NewspaperGenerator.test.ts` | 8 |
| `src/engine/NewspaperTemplates.test.ts` | 11 |
| `src/engine/PromptInjection.test.ts` | 8 |
| `src/engine/RuleEngine.test.ts` | 20 |
| `src/engine/Telemetry.test.ts` | 2 |
| `src/engine/Triangulation.test.ts` | 1 |
| `src/engine/TurnMachine.test.ts` | 18 |
| `src/proxy/worker.test.ts` | 28 |
| `src/services/LLMServiceProxy.test.ts` | 8 |
| `src/services/LogService.test.ts` | 2 |
| `src/services/SaveService.test.ts` | 4 |
| `src/smoke.test.ts` | 1 |

---

## 19. 既知の差異・未確認・制約

仕様・文書間の食い違い、まだ確かめていないことを**隠さず**記録します（次に手を入れる人が最初に読む場所）。

| 項目 | 内容 |
|------|------|
| 政策の継続期間 | `DECISIONS I-27` は「勅令を出した年を1年目として4年間」と書くが、実装（`tickPolicies`）は **5回の年次更新で同じ水準**が効く（`turnsLeft=4` から毎年1減り、0 になった次の更新で水準が1段戻る）。どちらかに揃える判断待ち |
| Mistral の実機確認 | Structured Outputs（json_schema の strict、`minimum/maximum` の対応）、価格、実際の所要時間は**未確認**（`DECISIONS §4, L-01`）。`SCHEMA_INCLUDE_RANGES` は既定 false。検証は偽 Mistral（`scripts/fake-mistral.mjs`）と実プロキシ（wrangler dev）まで |
| ゲームオーバー率 | sim のヒューリスティックで約11%（目標 20〜40%）。承認済み方針（`P-08`/`W-15`）により sim の合否に使わず、人間のプレイ（P4）で測る。到達率は約83%（合否の基準 70〜90%） |
| 人間の初見到達率 | 目標 50〜70%。**未測定**（P4） |
| 称賛への反転（官僚圧力） | 称賛版の文面を持つのは N-11（汚職）と N-21（工事の遅れ）だけ。sim では反転率がほぼ0% |
| 側近報告の量 | 1人あたり8〜10行/年で、空洞の開示が下に埋もれる。報告の並び替え・軽い言い回しにする案が自己レビューで出ている（未対応） |
| タグ（期限・優先度） | 効果がなく5文字消費する（`P-04` の懸念）。プレイヤーが避ける可能性 |
| 新聞の繰り返し | 約30年プレイすると天候・人口動態の記事がほぼ毎号出る。同セクション内の重複（春の畑／春の便り）もある |
| イベントの収束記事 | 解決・自然終了を新聞は報じない（側近報告のみ） |
| セーブ互換 | `schemaVersion=2`。v1（P0 の8 target 時代）のセーブは読み込まない |
| ブランチ | `main`（ローカル）は古い。最新は `p2/v3.2-ui`（p0〜p3・p0.5・p1/v3.2-core を全て含む）。PR は未作成 |
