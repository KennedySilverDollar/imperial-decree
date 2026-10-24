# DECISIONS.md — 論点と決定記録

| 項目 | 内容 |
|------|------|
| 対象 | SPEC v3.0 FINAL を P0 で実装するにあたっての未定義・曖昧・矛盾点 |
| ステータス凡例 | **未承認**（ユーザー判断待ち）／**承認**／**記録のみ**（軽微。推奨案で進め、異論があれば差し戻し） |
| 数値の詳細 | `docs/BALANCE.md` |

- 「CLAUDE#n」は CLAUDE.md §6 の既知論点番号。
- **v3.1 AMENDMENT（`SPEC_AMENDMENT_v3.1.md`）で決定済みの行は状態欄に「承認（A-xx）」と書いた。その行の「推奨案」欄が AMENDMENT と食い違う場合は AMENDMENT を優先する**（例：D-01 は +1/上限5、D-32 のタグは対象/規模の2種で3文字）。AMENDMENT の矛盾・新規論点は §6。
- 仕様変更提案は末尾の「仕様変更提案」セクションに分けた（P-xx）。本表（D-xx）は**仕様の範囲内での解釈・補完**。

---

## 1. ゲームルール

| ID | 論点 | 選択肢 | 推奨案 | 影響範囲 | 状態 |
|----|------|--------|--------|----------|------|
| D-01 | 政治資本の初期値・収入・上限・繰越（SPEC §7.1「3/ターン」が初期値欄にある）CLAUDE#1 | (a) 初期3・毎ターン+3・上限10・繰越あり (b) 初期3・毎ターン**+1**・上限10・繰越あり (c) 毎ターン3にリセット | **(a)** を CLAUDE#1 どおり採用。ただし (a) では収入3＞消費1で常に余り、任命コストと意図ボーナスが空振りする点を明記。資源として効かせたいなら (b)（→D-02, 質問対象） | domain/constants, RuleEngine, TurnMachine, 意図ボーナスの価値 | 承認（A-01） |
| D-02 | 意図達成ボーナスの種類 CLAUDE#2 | (a) 政治資本+1 (b) 幸福度+5 (c) 定数で切替 | **(c) 既定は (a)**。ただし D-01 が (a) のままなら実質無価値なので、その場合は既定を (b) 幸福度+5 にすることを推奨 | constants, IntentEvaluator | 承認（A-01） |
| D-03 | 意図達成の判定 CLAUDE#3 | — | increase: `after - before >= targetValue`／decrease: `before - after >= targetValue`／absolute: `after >= targetValue`（※下降目標の absolute は扱わない）。比較はボーナス適用前・**自然変化込みのターン全体の変化量**。targetValue は正の数のみ受け付ける | IntentEvaluator, IntentPanel（入力検証） | 未承認 |
| D-04 | LLM スキーマの `appoint` / `dismiss` CLAUDE#4 | (a) no-op (b) スキーマから削除 | **(a) no-op＋側近報告「任免は勅令ではなく御自らお決めください」**。スキーマはSPECどおり残す（削除は P-02 で提案） | RuleEngine, messages | 未承認 |
| D-05 | 勝敗同時成立 CLAUDE#10 | ゲームオーバー優先／成功優先 | **ゲームオーバー優先**。判定順：人口0 → 国庫<0 → 幸福度0 → 成功 → 時間切れ（50ターン目の結果処理後） | domain/Ending, TurnMachine | 未承認 |
| D-06 | 勅令を処理する側近の選び方（SPEC §11.5 `selectAide` が未定義） | (a) 専門一致→信頼順で自動 (b) プレイヤーが宛先を選ぶ (c) 交互 | **(a) 自動**。SPEC §5.4「手動介入は任命/解任のみ」と整合。選ばれた側近と理由は3段表示に出す | AideInterpreter, 3段表示 | 承認（A-05） |
| D-07 | 精度式 §7.6 の境界 `信頼 > 70` / `野心 > 70` が初期値（A 信頼70、B 野心70）とちょうど一致し、両項が初期状態で死ぬ | (a) SPEC どおり `>` (b) `>=` | **(b) `>=`**。初期の側近で式の全項が効くようにする（意図した設計だと推測）。定数化して切替可 | AideInterpreter, テスト | 承認（A-04） |
| D-08 | `budget` の使い方 | (a) budget をそのまま国庫から引く (b) コストはエンジンが規模から計算し、budget は上限としてのみ使う (c) 無視 | **(b)**。LLM の数値で直接国庫を動かさない（CLAUDE.md §4-1,2） | RuleEngine | 未承認 |
| D-09 | `confidence` の使い方 | (a) 表示のみ (b) 閾値未満は no-op | **(b) 0.3未満は no-op＋「意味が取れなかった」**。3段表示でも数値を見せる | RuleEngine, DecreeParser | 記録のみ |
| D-10 | `magnitude` の意味・単位 | — | 無次元の「規模」。action×target ごとの係数で効果とコストに換算（BALANCE §3）。負値は action により「減税・施し」等、多くは no-op | RuleEngine | 記録のみ |
| D-11 | 国庫を超える支出 | (a) そのまま引いて破綻 (b) 国庫に合わせて規模縮小 (c) 不成立 | **(b)**（役所のみ (c)）。破綻は維持費・給与の累積で起きるようにし、1手の誤りで即死させない | RuleEngine | 承認（A-07） |
| D-12 | 役所の建築条件・費用 CLAUDE#11 | — | 人口200以上・インフラ15以上・国庫400。不成立時は理由を側近報告で返す（BALANCE §5） | RuleEngine, constants | 未承認 |
| D-13 | 汚職率の村での効果 CLAUDE#6 | — | 税収を `corruption%` 目減り＋幸福度平衡点を下げる。毎年+0.3 で自然上昇（BALANCE §2） | RuleEngine | 未承認 |
| D-14 | 人口・税収・幸福度・インフラ・汚職率の更新式 CLAUDE#7 | — | BALANCE §2 の式 | RuleEngine, sim | 未承認 |
| D-15 | 1ターン内の処理順（SPEC §11.5 は骨子のみ） | — | ①エンディング確認 ②勅令検証（文字数・政治資本） ③政治資本-1・国庫-`DECREE_BASE_COST` ④LLM解釈（失敗時テンプレート） ⑤サニタイズ・target 検証 ⑥側近選択・歪み ⑦効果適用 ⑧自然変化 ⑨clamp ⑩意図判定・ボーナス ⑪地図導出 ⑫新聞・側近報告生成 ⑬エンディング判定 ⑭政治資本収入 ⑮ターン+1・保存 | TurnMachine | 未承認 |
| D-16 | ゲームオーバーの境界 | — | 人口 `<= 0`、国庫 `< 0`（0ちょうどは存続）、幸福度 `<= 0`（clamp 後） | domain/Ending | 記録のみ |
| D-17 | 時間切れの判定タイミングと「ターン番号」 | — | ターンは1始まり。50ターン目の結果処理後に成功でなければ時間切れ（=勅令は最大50回） | TurnMachine | 記録のみ |
| D-18 | 側近パラメータは変化するか（忠誠・信頼の推移が未定義） | (a) P0 では固定 (b) 勅令結果で増減 | **(a) 固定**。変化は製品版のナラティブと一緒に設計する。P0 で変わるのは任命/解任による入れ替えのみ | domain/Aide | 未承認 |
| D-19 | 「到達率30〜50%」はランダム方策の sim の目標か、テスターの目標か | — | 両者は別物。`pnpm sim` は (1) ランダム方策で30〜50%（今回の試算で達成）、(2) 半合理方策の数値も併記して人間の上限の目安にする。テスター目標は P4 で測る | sim スクリプト, BALANCE | 承認（A-02） |
| D-20 | ゲームオーバーの内訳が財政破綻に偏る（試算で幸福度0・人口0は ≈0%） | (a) 許容 (b) 幸福・人口でも終わり得るよう調整 | **(a) P0 はまず許容**し、P1 の sim で内訳を出す。3種の終わり方を体験させたいなら徴税の幸福ペナルティ強化で調整 | BALANCE | 承認（A-08） |
| D-21 | 側近0人のとき | — | 勅令は実行されず政治資本・国庫も消費しない。自然変化は進む。勅令入力欄に警告（SPEC §5.4） | TurnMachine, UI | 記録のみ |
| D-22 | 任命候補2人の生成と任命の上限 | (a) 固定プール（4〜6人）から seed で2人 (b) パラメータを乱数生成 | **(a) 固定プールから2人**（名前・性格文はi18n）。側近の上限は2人。任命は勅令より前に行い、同ターンの勅令から有効 | domain/Aide, i18n, UI | 未承認 |
| D-23 | 歪みの確率・係数・「派閥対立」の定義 CLAUDE#8 | — | BALANCE §4（精度式ベース。派閥対立は派閥×勅令の表で定義） | AideInterpreter | 未承認 |
| D-24 | 新聞の偏向度30 CLAUDE#9 | — | 数値に ±30% の対称ノイズ＋論調語は政府寄り（悪化を控えめ、改善を誇張）（BALANCE §7） | Newspaper, messages | 未承認 |
| D-25 | `visual_state` / `actual_state`（稼働中/空洞/塩漬け）の P0 での発生源 | (a) P0 は常に一致 (b) 骨抜きされた建設分を「空洞」として記録 | **(b)**。「塩漬け」は P0 では使わない。能力70以上の側近が開示し、亀裂アイコンを表示（BALANCE §6） | MapUpdater, AideInterpreter | 未承認 |
| D-26 | 地図の配置アルゴリズム（「優先順位：役所→道路→住宅」の幾何が未定義）と 100区画を超える場合 | — | 中心から螺旋順に役所→道路→住宅→空き地。空き地を最低10確保し、超過する住宅は描かない（BALANCE §6） | MapUpdater | 記録のみ |
| D-27 | SPEC §12.7 のタイル種別「市場」 | — | §8.2 に導出式がないため **P0 では描かない** | MapUpdater, アセット | 記録のみ |
| D-28 | 側近報告の内容と数値の正確さ | — | 側近報告は**実数値の変化量**を報告（新聞はノイズあり、側近は欠落・隠蔽あり、という対比）。項目欠落と隠蔽は BALANCE §4.5 | AideInterpreter（報告生成）, messages | 未承認 |

## 2. 勅令入力・LLM

| ID | 論点 | 選択肢 | 推奨案 | 影響範囲 | 状態 |
|----|------|--------|--------|----------|------|
| D-30 | `target` が自由文字列 CLAUDE#5 | — | 仕様変更提案 **P-01** を参照。承認されるまでは「フロント/プロキシで許可リスト検証、未知は no-op」で実装 | DecreeParser, proxy | 承認（A-03。enum は P-01 と別内容） |
| D-31 | 文字数の数え方（`text.length` は UTF-16 単位で絵文字等が2になる） | (a) `text.length` (b) コードポイント数 (c) 書記素数（Intl.Segmenter） | **(b) コードポイント数**（`[...text].length`）。前後の空白は trim して数える。日本語ではほぼ差がない | domain/Decree, DecreePanel | 記録のみ |
| D-32 | タグ（対象/規模/期限/優先度）の値域と効果 | (a) 選択式（対象=target enum、規模=小/中/大、期限・優先度=選択肢） (b) 自由記述 | **(a) 選択式**。タグは LLM とテンプレートパーサーへの構造化ヒントとして渡す。**期限・優先度は P0 では機械的効果なし**（DecreeIntent に対応する項目がない。→質問） | domain/Decree, DecreeParser, DecreePanel | 承認（A-06） |
| D-33 | 「規模」タグと LLM の magnitude の関係 | — | タグがあれば magnitude の既定値（小=25/中=50/大=80）としてプロンプトとテンプレートパーサーに渡す。LLM の出力が優先 | DecreeParser, constants | 記録のみ |
| D-34 | メタ命令のサニタイズ方法 | (a) 禁止語リストで該当部分を除去して解釈 (b) 該当したら勅令全体を no-op | **(a) 除去して残りを解釈**し、側近報告で「不遜な文言は聞かなかったことにいたします」と返す。禁止パターンは定数（文言は i18n） | DecreeParser, constants, messages | 未承認 |
| D-35 | テンプレートパーサー（LLM失敗時）の仕様 | — | キーワード辞書（例：「道」→road、「税」→tax×treasury、「祭」→reform×happiness）＋数字抽出で magnitude。マッチなしは confidence 0 → no-op。辞書は i18n 側に置く | DecreeParser, i18n | 記録のみ |
| D-36 | JSONモード（フォールバック①）時の検証 | — | json_schema が使えない／失敗した場合は json_object で再試行し、**プロキシとフロントの両方で Effect Schema 検証**。違反はテンプレートへ | proxy, DecreeParser | 記録のみ |
| D-37 | リトライの対象とバックオフ | — | タイムアウト・5xx・429・スキーマ違反をリトライ対象。待機 500ms→1000ms。合計の最悪待ちは約16秒になるので UI は「参謀が思案中」表示 | LLMService, constants | 記録のみ |
| D-38 | 決定論性と LLM | — | seed 再現は「同じ LLM 出力なら同じ結果」を保証。TurnRecord に LLM 出力（DecreeIntent）とその取得経路（llm/json_mode/template）を残し、リプレイ時はそれを使う | TurnRecord, TurnMachine | 記録のみ |
| D-39 | プロキシの「簡易トークン」 | — | ビルド時の環境変数で埋め込む（フロントに見えることは許容）。プロキシ側でトークン検証＋IP 単位のレート制限（例：1分10回）。APIキーは Workers の secret | proxy | 記録のみ |
| D-40 | LLM へ渡すゲーム状態 | — | SPEC §11.5 は `parseDecree(decree, state)`。**状態は渡さない**（翻訳層に限定、トークン節約、インジェクション面の縮小）。渡すのは勅令本文・タグのみ | LLMService, proxy | 承認（A-09） |

## 3. 型・実装上の注意（SPEC §11 との差分）

| ID | 論点 | 推奨案 | 影響範囲 | 状態 |
|----|------|--------|----------|------|
| D-50 | `IntentDeclaration.declared: boolean` と `Option<IntentDeclaration>` が冗長 | `declared` を削除し `Option` のみで表す | domain/IntentDeclaration | 記録のみ |
| D-51 | SPEC §11.5 の `Effect.gen(function* (_) { yield* _(...) })` はアダプタ形式（Effect 3.x では非推奨） | `Effect.gen(function* () { yield* ... })` で書く。Schema は `effect` パッケージ同梱の `effect/Schema` を使う | engine 全般 | 記録のみ |
| D-52 | `GameState` に地図状態・新聞履歴・側近報告・空洞量・seed/Rng状態がない | `GameState` に `rngState`, `hollowInfrastructure`, `nextAideId` 等を追加。地図は params から**毎回導出**（保存しない）。新聞・報告は TurnRecord に入れる | domain/GameState, SaveService | 記録のみ |
| D-53 | セーブ形式のバージョン | `schemaVersion` を持たせ、不一致なら読み込まずに新規開始 | SaveService | 記録のみ |
| D-54 | 「参謀」の用語（SPEC §5.1 は側近＝参謀、§6.3/§6.5 は参謀＝Mistral） | **参謀＝LLM（翻訳層）、側近＝A/B** で統一。UI 文言もこれに従う | messages, ドキュメント | 記録のみ |
| D-55 | Lint で不変条件を機械的に守る | ESLint で `Math.random` 禁止、`src/domain` から `effect`/`phaser`/`react` の import 禁止を設定済み（雛形） | eslint.config.js | 記録のみ |
| D-56 | 依存のメジャーバージョン（2026-10 時点の latest は effect 4.0.6 / TypeScript 7.0.2 / Phaser 4.2.1） | **effect は 3.22.x に固定**：4.x では `Context.Tag` が廃止（`Context.Service` へ）され、CLAUDE.md §2 の前提と合わない。**TypeScript は 5.9.x に固定**：typescript-eslint 8.x が `<6.1` のみ対応。**Phaser は 4.x（latest）**を採用：P0 の用途は 10×10 グリッド描画だけで、v3 との差の影響は小さい。Effect 4 への移行は製品版で再検討 | package.json, CLAUDE.md §2 | 承認（A-10） |

---

## 4. Mistral API 調査結果（CLAUDE#12, SPEC §18.2）

**調査日**：2026-10-24

**結論：未確認。** この作業環境のネットワークポリシーで `docs.mistral.ai` と `mistral.ai` への接続が遮断され（プロキシが 403）、公式ドキュメントを直接読めなかった。以下は Web 検索で得た**第三者情報**であり、正典として使わない。

### 4.1 Structured Outputs の `minimum` / `maximum`
- **未確認**。検索では対応キーワード一覧を見つけられなかった。
- 分かったこと（第三者情報）：`response_format: { type: "json_schema", json_schema: { name, schema, strict } }` 形式。`strict` は既定 false（Vercel AI SDK の Mistral プロバイダ文書より）。
- **実装上の方針（確認結果に関係なく）**：スキーマで範囲を強制できなくても困らないよう、`magnitude ∈ [-100,100]`、`confidence ∈ [0,1]`、`budget >= 0` を**プロキシとフロントの Effect Schema で検証し、範囲外は clamp**（clamp したことは3段表示に出す）。`minimum`/`maximum` が非対応でエラーになる場合に備え、プロキシの固定スキーマは「範囲キーワードあり／なし」を定数で切り替えられるようにする。
- **P3 でやること**：公式ドキュメント（Custom Structured Outputs のページと API リファレンスの `response_format`）を確認するか、実 API に `minimum`/`maximum` 付きスキーマを投げて挙動を確かめる。

### 4.2 `mistral-small-latest` の価格
- **未確認**（公式価格ページに到達できず）。
- 第三者の価格まとめでの記載（2026年10月時点、いずれも米ドル／100万トークン）：
  - 入力 $0.15 / 出力 $0.60（Mistral Small 4 として。複数サイトが一致。キャッシュ入力 $0.015 の記載もあり）
  - 入力 $0.10 / 出力 $0.30（別のまとめサイト。古い可能性）
- SPEC §11.2 の「入力0.60 per M tokens」は、上記の**出力単価**と一致しており、入力・出力の取り違えの可能性がある。
- 規模感：勅令1回 ≈ 入力500＋出力100トークンと仮定すると、$0.15/$0.60 で1回約 $0.000135。50ターン×100プレイでも $1 未満。P0 のコストリスクは小さい。
- `mistral-small-latest` は**エイリアスで中身が更新される**ため、再現性を重視するならプロキシで日付付きモデル ID に固定することを P3 で検討する。

参照（第三者・未検証）：
- https://ai-sdk.dev/providers/ai-sdk-providers/mistral
- https://www.aipricing.guru/mistral-pricing/
- https://openrouter.ai/mistralai/mistral-small-2603
- https://developer.puter.com/tutorials/mistral-api-pricing/

---

## 5. 仕様変更提案（承認制。SPEC は変更していない）

| ID | 提案 | 理由 | 影響範囲 | 状態 |
|----|------|------|----------|------|
| P-01 | **`target` を enum 化**：`population / treasury / happiness / infrastructure / corruption / office / housing / road`（CLAUDE#5） | 自由文字列では許可リスト検証の前に LLM が表記ゆれを出す。enum ならスキーマで強制でき、プロキシ固定スキーマの意義が増す | SPEC §11.2/§11.4, proxy, DecreeParser, RuleEngine | 置換（A-03 が別の8種で確定） |
| P-02 | **`action` から `appoint` / `dismiss` を削除**（A-09 が action 6種の固定を前提にしているため、見送りと解釈。N-07） | P0 では勅令経由の任免を扱わない（D-04）。残すと LLM が選びうる無意味な選択肢になる。製品版で必要なら戻す | SPEC §11.2/§11.4 | 未承認 |
| P-03 | **`magnitude` の範囲をスキーマ外でも保証**（範囲外は clamp と明記） | `minimum/maximum` の対応が未確認（§4.1）。仕様として「エンジンが clamp する」を正にする | SPEC §11.2 | 未承認 |
| P-04 | **期限・優先度タグを P0 では外す**（または UI に出すが効果なしと明記） | DecreeIntent に対応項目がなく、効果のないタグに5文字を払わせるのは不誠実 | SPEC §6.1, DecreePanel | 承認（A-06） |
| P-05 | **精度式の境界を `>=` にする**（D-07） | 初期値で全項が効くように | SPEC §7.6 | 承認（A-04） |
| P-06 | **政治資本の収入を +1/ターンにする**（D-01 (b)） | +3 では政治資本が制約として機能せず、任命コストと意図ボーナスが空振りする | SPEC §7.1, BALANCE | 承認（A-01） |
| P-07 | **SPEC §11.5 で LLM に `state` を渡さない**（D-40） | 翻訳層の責務に限定、インジェクション面とトークンの削減 | SPEC §11.5, LLMService | 承認（A-09） |

---

## 6. v3.1 AMENDMENT の反映結果と新規論点

AMENDMENT の10項目は `docs/SPEC_AMENDMENT_v3.1.md` に保存し、BALANCE.md・CLAUDE.md・package.json に反映した（A-10 は `~`/完全固定で適用済み）。反映中に見つかった矛盾・未定義を以下にまとめる。

| ID | 論点 | 選択肢 | 推奨案 | 影響範囲 | 状態 |
|----|------|--------|--------|----------|------|
| N-01 | **A-08「住宅不足（人口 > 住宅区画数×20）」は、SPEC §8.2 の住宅区画 = `floor(人口/20)` と両立しない**（区画数が人口から導出されるため、常に人口≦区画数×20+19 となり、不足が構造的に起きない） | (a) 住宅区画数を独立した状態 `housingUnits` にし、住宅を建てる勅令（target=residential）で増やす。住宅タイルも `housingUnits` で描く (b) A-08 の住宅ペナルティを削除 (c) インフラから導出（`HOUSING_BASE + infrastructure*k`） | **(a)**。SPEC §8.2 の導出式を変える**仕様変更**だが、A-03 に residential が入った意図（住宅を建てる勅令）と一致する。BALANCE は (a) で試算済み（初期8区画＝容量160） | domain/GameState, MapUpdater, RuleEngine, SPEC §8.2 | **未承認（要判断）** |
| N-02 | **A-03 の8種 target だと、SPEC §7.1 のパラメータ（人口・国庫・幸福度・インフラ・汚職）に直接対応しない。** well/market/welfare/security の効果と、action × target の組み合わせの有効範囲が未定義 | — | BALANCE §3 の表（効果は target で決まる。action は許可リストにあるときだけ有効。tax は action=tax なら target 不問）。市場は税収倍率（上限3）、治安は汚職抑制、福祉は幸福、井戸はインフラ＋幸福。市場は固定コストで縮小不可 | RuleEngine, DecreeParser のテンプレ辞書, LLM システムプロンプト | 未承認 |
| N-03 | **A-02 の「到達70〜90%」と「GO 20〜40%」は同時に満たせる範囲が狭い**（時間切れを除くと到達≦約80%）。また「ヒューリスティック方策」の定義がない。さらにヒューリスティックでは GO のほぼ全てが財政破綻で、A-08 の幸福度・人口経路は（ランダム方策でのみ ≒10%）ほとんど発生しない | — | (1) 方策を BALANCE §9 のとおり定義（優先順位ルール＋ノイズ0.35）。(2) 到達70〜80%・GO 20〜25%・時間切れ≦8% を合否帯とする。(3) 幸福度・人口の経路は sim の内訳ではなく **P4 の人間プレイで確認**する | sim, BALANCE | 未承認 |
| N-04 | A-01 の政治資本：**初期値**が書かれていない。また、残高0で任命すると勅令が出せなくなる／勅令に残高が足りないときの扱い | — | 初期3（上限5以下）。残高<1 の年は勅令を発行できない（入力欄で警告）。任命は勅令の前に行い、残高が足りなければ不可 | domain/GameState, TurnMachine, UI | 未承認 |
| N-05 | A-01 によりボーナス種別の切替定数（D-02 の (c)）が不要に | — | `INTENT_BONUS_KIND` は作らない。幸福度+5 は上限100で clamp（ボーナス適用後に clamp） | constants, IntentEvaluator | 記録のみ |
| N-06 | A-06 のタグ：「対象」タグの値と「規模」タグの値が未定義 | — | 対象タグ＝A-03 の target 8種から選択。規模タグ＝小/中/大（magnitude 既定 25/50/80）。各タグは最大1個（計2個、本文34文字）。タグの値は LLM とテンプレートパーサーに渡す（D-33） | domain/Decree, DecreePanel, DecreeParser | 未承認 |
| N-07 | A-09 は action 6種（appoint/dismiss 含む）を維持する前提。LLM が appoint/dismiss を返した場合の扱い | — | D-04 のとおり no-op＋側近報告。P-02（削除案）は見送り | RuleEngine | 記録のみ |
| N-08 | A-08「汚職>50」は、汚職が初期5＋0.3/年では最大約20にしかならず**通常プレイでは発動しない** | (a) 安全網として許容 (b) `CORRUPTION_DRIFT_PER_TURN` を上げる（税収目減りが同時に強まるため難度が大きく変わる） | **(a)**。発動させたい場合は別途再調整 | BALANCE | 未承認 |
| N-09 | A-05「選定理由」の文言と、同点（市場など複数の専門に一致する target）の扱い | — | 理由は「専門が一致」「信頼関係が高い」「専門外のため信頼順で選定」の3種（messages.ts）。同点は在任が長い方 | AideInterpreter, messages, 3段表示 | 記録のみ |
| N-10 | A-07：縮小率の表示と、縮小後の効果が1未満になる場合 | — | 縮小率は整数%で表示。縮小後の効果量が最小単位（0.01）未満なら「予算不足で何もできなかった」と報告 | RuleEngine, messages | 記録のみ |
| N-11 | A-10：Phaser の範囲 | — | `~4.2.1`、Effect `~3.22.4`、TypeScript `5.9.2`（完全固定）で適用済み。D-56 の記述は A-10 に合わせて承認済みとした | package.json | 記録のみ |
| N-12 | A-02：試算で、歪みを無効にすると到達率が下がる（73%→56%）。現在の歪み式は平均難度を上げず、ばらつきを作る側に効く | — | 現状のまま P1 の sim で再検証。歪みを難度の主レバーにする必要はない（難度の主レバーは `TAX_PER_CAPITA` と `INFRA_UPKEEP_PER_POINT`） | AideInterpreter, BALANCE | 記録のみ |
