# BALANCE.md — P0 バランス初期案（v3.1 AMENDMENT 反映版）

| 項目 | 内容 |
|------|------|
| ステータス | §0〜§11 は **v3.1 モデル（実装済み）**。**§12〜§20 は v3.2 モデルの初期案（未承認・未実装）**。v3.2 承認後の P1 で §12 以降に置き換える |
| 対象 | SPEC v3.0 §7 / §6.4 / §8.2 ＋ `SPEC_AMENDMENT_v3.1.md` |
| 目標（A-02） | **ヒューリスティック方策 sim の到達率 70〜90%（主指標）**、ゲームオーバー率 20〜40%。ランダム勅令 sim は参考値（合否に使わない）。人間の初見到達率 50〜70% は P4 で実測 |

- 定数名は `src/domain/constants.ts` にそのまま置く想定（UPPER_SNAKE_CASE）。式の下の「根拠」は1行。
- 乱数はすべて `Rng` サービス経由。`rand()` は `[0,1)`、`randRange(a,b)` は `[a,b)` の一様乱数。
- 試算は使い捨ての Python スクリプト（リポジトリ外）によるもの。正式な検証は P1 の `npm run sim` で取り直す（§9）。

---

## 0. 状態変数（A-03・A-08 に伴う追加）

SPEC §7.1 の5パラメータ＋政治資本に加え、次の状態を持つ（DECISIONS N-01, N-02）。

| 状態 | 初期値 | 説明 |
|------|--------|------|
| `housingUnits`（住宅区画数） | `INITIAL_HOUSING_UNITS` = 8 | 住宅容量 = `floor(housingUnits) * RESIDENTS_PER_HOUSING_TILE`。初期容量160（人口120に対し余裕） |
| `marketCount`（市場数） | 0 | 税収倍率に効く。上限 `MARKET_MAX` |
| `officeBuilt` | false | SPEC §11.4 |

人口は整数（ターン末に `floor`）。幸福度・インフラ・汚職率は `[0,100]` に clamp。国庫は clamp しない。

## 1. 初期値・資源

| 定数 | 値 | 根拠 |
|------|----|------|
| `INITIAL_POPULATION` / `INITIAL_TREASURY` / `INITIAL_HAPPINESS` / `INITIAL_INFRASTRUCTURE` / `INITIAL_CORRUPTION` | 120 / 500 / 50 / 10 / 5 | SPEC §7.1 |
| `INITIAL_POLITICAL_CAPITAL` | 3 | SPEC §7.1 の「3」を初期値と解釈（上限5以下）。DECISIONS N-04 |
| `POLITICAL_CAPITAL_INCOME` | **1** | **A-01** |
| `POLITICAL_CAPITAL_MAX` | **5** | **A-01** |
| `DECREE_POLITICAL_COST` / `APPOINT_POLITICAL_COST` / `DISMISS_POLITICAL_COST` | 1 / 1 / 0 | A-01 |
| `INTENT_BONUS_HAPPINESS` | **5** | **A-01**（ボーナス種別の切替定数は廃止） |
| `DECREE_BASE_COST` | 10 | 勅令1回の国庫コスト（SPEC §7.4 の難度レバー）。年収の1割弱 |
| `MAX_TURNS` | 50 | SPEC §7.2 |
| `DECREE_CHAR_LIMIT` | 40 | SPEC §6.1（暫定） |
| `TAG_CHAR_COST` | **3** | **A-06**。タグは「対象」「規模」の最大2個 → 本文最大 40/37/34 文字 |

政治資本の収支：毎ターン勅令で-1、収入+1、上限5。**任命（-1）をするとその年は勅令が出せない場合がある**（残高0のとき）ので、任命は「勅令1回分を手放す」選択になる。※勅令に政治資本が足りないときは発行不可（DECISIONS N-04）。

## 2. ターン更新式（自然変化）

勅令の効果（§3）を適用した後に、次の順で計算する。

### 2.1 人口

```
capacity = floor(housingUnits) * RESIDENTS_PER_HOUSING_TILE
r = happiness >= HAPPINESS_GROWTH_THRESHOLD
      ? POPULATION_GROWTH_BASE + (happiness - 50) * POPULATION_GROWTH_PER_HAPPINESS
      : (happiness - 50) * POPULATION_OUTFLOW_PER_HAPPINESS      // 負＝流出
if (population > capacity && r > 0) r = 0                       // 住宅が無ければ増えない
population = population * (1 + r)
overcrowded = population > capacity                               // 成長後・流出前で判定
if (overcrowded) population -= (population - capacity) * OVERCROWD_OUTFLOW_RATE
population = floor(max(0, population))
```

| 定数 | 値 | 根拠 |
|------|----|------|
| `RESIDENTS_PER_HOUSING_TILE` | 20 | A-08 の「住宅区画数×20」、SPEC §8.2 |
| `INITIAL_HOUSING_UNITS` | 8 | 容量160。序盤は余裕、中盤（人口160超）から住宅の勅令が必要になる |
| `HAPPINESS_GROWTH_THRESHOLD` | 50 | SPEC §7.1「50未満で人口流出」 |
| `POPULATION_GROWTH_BASE` | **0.03**（P1 で 0.025 から調整、§11） | 120→300 を約31年。30〜50ターンの尺 |
| `POPULATION_GROWTH_PER_HAPPINESS` | 0.002 | 幸福度70で+4%/年 |
| `POPULATION_OUTFLOW_PER_HAPPINESS` | 0.004 | 幸福度30で-8%/年。失うのは増えるより速い |
| `OVERCROWD_OUTFLOW_RATE` | 0.15 | 超過分の15%が毎年流出。住宅放置の罰（A-08 の幸福ペナルティと併用） |

### 2.2 税収と支出

```
taxRevenue = population * TAX_PER_CAPITA * (1 + MARKET_TAX_BONUS * marketCount) * (1 - corruption / 100)
upkeep     = infrastructure * INFRA_UPKEEP_PER_POINT + AIDE_SALARY * (在任側近数) + (officeBuilt ? OFFICE_UPKEEP : 0)
treasury  += taxRevenue - upkeep
```

| 定数 | 値 | 根拠 |
|------|----|------|
| `TAX_PER_CAPITA` | **1.25**（P1 で 1.32 から調整、§11） | 初期の年収約150。調整は主にこの値で行う（難度レバー） |
| `INFRA_UPKEEP_PER_POINT` | 2.0 | インフラ25で年50。作りすぎは財政を圧迫 |
| `AIDE_SALARY` | 15 | 2人で年30 |
| `OFFICE_UPKEEP` | 20 | 役所は建てた後も重い |
| `MARKET_TAX_BONUS` | 0.12 | 市場1つで税収+12%（150の投資を約3〜4年で回収） |
| `MARKET_MAX` | 3 | 市場だけで財政問題を解決させない |
| 汚職の効果 | `(1 - corruption/100)` | CLAUDE.md §6 #6 の推奨案（村には官僚がいないため税の取りこぼしで表現） |

### 2.3 幸福度（A-08 のペナルティを含む）

```
penalty = (overcrowded ? CROWDING_HAPPINESS_PENALTY : 0)              // A-08: 住宅不足（人口 > 住宅区画数×20）毎ターン
        + (corruption > NEGLECTED_CORRUPTION_THRESHOLD ? NEGLECTED_CORRUPTION_PENALTY : 0)   // A-08: 汚職放置 毎ターン
equilibrium = HAPPINESS_EQUILIBRIUM_BASE + infrastructure * HAPPINESS_PER_INFRA
            - corruption * HAPPINESS_PENALTY_PER_CORRUPTION - penalty / HAPPINESS_REVERT_RATE
happiness  += (equilibrium - happiness) * HAPPINESS_REVERT_RATE
```
増税の幸福ペナルティは勅令適用時に即時（§3）。

| 定数 | 値 | 根拠 |
|------|----|------|
| `HAPPINESS_EQUILIBRIUM_BASE` | 48 | 初期（インフラ10・汚職5）の平衡点≒51 |
| `HAPPINESS_PER_INFRA` | 0.4 | インフラ25で+10 |
| `HAPPINESS_PENALTY_PER_CORRUPTION` | 0.2 | 汚職30で-6 |
| `CROWDING_HAPPINESS_PENALTY` | 3 | A-08。1ターンあたり約-3（平衡点を30下げて10%戻す） |
| `NEGLECTED_CORRUPTION_THRESHOLD` | 50 | **A-08** |
| `NEGLECTED_CORRUPTION_PENALTY` | 3 | A-08。住宅不足と同格 |
| `HAPPINESS_REVERT_RATE` | 0.1 | 差の1割ずつ戻る＝勅令の効果が数年残る |

### 2.4 インフラ・汚職・政治資本

| 式 | 定数 | 値 | 根拠 |
|----|------|----|------|
| `rand() < INFRA_DECAY_CHANCE` なら `infrastructure -= INFRA_DECAY_AMOUNT` | `INFRA_DECAY_CHANCE` / `INFRA_DECAY_AMOUNT` | 0.3 / 1 | 50年で期待-15。維持の勅令を要求する |
| `corruption += CORRUPTION_DRIFT_PER_TURN` | `CORRUPTION_DRIFT_PER_TURN` | 0.3 | 50年で+15。村では低いが放置で蝕む |
| 政治資本 `min(MAX, 残高 + INCOME)` | — | — | ターン最後（エンディング判定後）に加算 |

**注意**：汚職は初期5＋0.3/年で最大でも約20にしかならず、A-08 の「汚職>50」は通常プレイでは発動しない（安全網）。発動させたい場合は `CORRUPTION_DRIFT_PER_TURN` を上げる必要がある（DECISIONS N-08）。

---

## 3. 勅令の効果（A-03 の target 8種 × action）

効果は **target で決まる**。`action` は許可された組み合わせのときだけ有効（それ以外は no-op＋側近報告「意味が取れなかった」）。`m` は歪み適用後の `magnitude`（`[-100,100]` に clamp）。DECISIONS N-02 参照。

| target | 許可 action | m>0 の効果 | 国庫コスト | m≤0 |
|--------|-------------|------------|------------|------|
| road | build / invest | インフラ `+ROAD_INFRA_PER_MAG*m` | `ROAD_COST_PER_MAG*m` | no-op |
| well | build / invest | インフラ `+WELL_INFRA_PER_MAG*m`、幸福 `+WELL_HAPPINESS_PER_MAG*m` | `WELL_COST_PER_MAG*m` | no-op |
| residential | build / invest | 住宅区画 `+RESIDENTIAL_UNITS_PER_MAG*m`（端数は蓄積） | `RESIDENTIAL_COST_PER_MAG*m` | no-op |
| market | build / invest | 市場数 +1（`MARKET_MAX` まで） | `MARKET_COST`（m に依存しない） | no-op |
| office | build | 建築条件（§5）を満たせば `officeBuilt = true` | `OFFICE_COST` | no-op |
| tax | **tax（任意の target でも）** / reform | **増税**：国庫 `+population*LEVY_PER_CAPITA_PER_MAG*m`、幸福 `-LEVY_HAPPINESS_PER_MAG*m`（**A-08**：magnitude に比例） | 0 | **減税・施し**：国庫 `-population*LEVY_PER_CAPITA_PER_MAG*\|m\|`、幸福 `+RELIEF_HAPPINESS_PER_MAG*\|m\|` |
| welfare | invest / reform | 幸福 `+WELFARE_HAPPINESS_PER_MAG*m` | `WELFARE_COST_PER_MAG*m` | no-op |
| security | invest / reform | 汚職 `-SECURITY_CORRUPTION_PER_MAG*m`、幸福 `+SECURITY_HAPPINESS_PER_MAG*m` | `SECURITY_COST_PER_MAG*m` | no-op |
| （任意） | appoint / dismiss | no-op（P0 は手動介入のみ。DECISIONS D-04） | 0 | — |

**予算不足（A-07）**：コスト＞国庫のとき、効果とコストを `treasury / cost` 倍に縮小し、縮小率を「側近による補正」に出す。**office のみ縮小せず不成立**。market は固定コストのため縮小せず不成立（DECISIONS N-02）。

| 定数 | 値 | 根拠 |
|------|----|------|
| `ROAD_INFRA_PER_MAG` / `ROAD_COST_PER_MAG` | 0.12 / 4 | 規模50でインフラ+6、200。目標（+15＋劣化分）まで4〜5回 |
| `WELL_INFRA_PER_MAG` / `WELL_HAPPINESS_PER_MAG` / `WELL_COST_PER_MAG` | 0.06 / 0.05 / 3 | 道路の半分のインフラだが幸福も上がる。規模50で+3インフラ・+2.5幸福・150 |
| `RESIDENTIAL_UNITS_PER_MAG` / `RESIDENTIAL_COST_PER_MAG` | 0.06 / 5 | 規模50で+3区画（+60人分）・250。人口の天井を押し上げる |
| `MARKET_COST` | 150 | §2.2 の回収年数から |
| `LEVY_PER_CAPITA_PER_MAG` | 0.03 | 人口120・規模50で+180。即効性はあるが… |
| `LEVY_HAPPINESS_PER_MAG` | 0.25 | …幸福-12.5。連発すると離反へ（A-08）。試算で 0.2→0.25 に上げた |
| `RELIEF_HAPPINESS_PER_MAG` | 0.1 | 取るのは簡単、喜ばせるのは難しい |
| `WELFARE_HAPPINESS_PER_MAG` / `WELFARE_COST_PER_MAG` | 0.15 / 3 | 規模50で幸福+7.5・150 |
| `SECURITY_CORRUPTION_PER_MAG` / `SECURITY_HAPPINESS_PER_MAG` / `SECURITY_COST_PER_MAG` | 0.1 / 0.03 / 2 | 規模50で汚職-5・幸福+1.5・100 |

### 3.1 `budget` と `confidence`
- `budget` は上限としてのみ使う。`budget > 0 && budget < cost` なら効果とコストを `budget/cost` 倍に縮小（DECISIONS D-08）。
- `confidence < LOW_CONFIDENCE_THRESHOLD`（0.3）なら no-op＋「意味が取れなかった」。

---

## 4. 側近による歪み（SPEC §6.4）

### 4.1 担当側近の選択（A-05）
1. target に専門が一致する側近（または action=tax で専門＝経済）を優先。
2. 同点なら信頼関係が高い方。さらに同点なら在任が長い方。
3. 側近0人なら勅令は実行されず政治資本・国庫を消費しない。
4. 3段表示に「選ばれた側近」と「選定理由」（専門一致／信頼関係の高さ）を出す。

| 専門 | 一致する target |
|------|-----------------|
| インフラ | residential, road, well, office, market |
| 経済 | tax, market, security, および action=tax |
| 治安 | welfare, security |
| 環境 | well |

※ market は インフラ・経済の両方に一致（同点→信頼順）。初期側近A=インフラ、B=経済。

### 4.2 解釈精度（A-04）

```
accuracy = clamp(ACCURACY_BASE + ability / ACCURACY_ABILITY_DIVISOR
                 + (specialtyMatch ? ACCURACY_SPECIALTY_BONUS : 0)
                 + (trust >= ACCURACY_TRUST_THRESHOLD ? ACCURACY_TRUST_BONUS : 0)
                 - (ambition >= ACCURACY_AMBITION_THRESHOLD && factionConflict ? ACCURACY_AMBITION_PENALTY : 0), 0, 1)
```

| 定数 | 値 |
|------|----|
| `ACCURACY_BASE` / `ACCURACY_ABILITY_DIVISOR` | 0.3 / 200 |
| `ACCURACY_SPECIALTY_BONUS` | 0.2 |
| `ACCURACY_TRUST_THRESHOLD`（`>=`）/ `ACCURACY_TRUST_BONUS` | 70 / 0.1 |
| `ACCURACY_AMBITION_THRESHOLD`（`>=`）/ `ACCURACY_AMBITION_PENALTY` | 70 / 0.2 |

参考：A がインフラ系を担当 → 0.9、A が専門外 → 0.7、B が経済系（派閥対立なし） → 0.875、B が増税（商業派と対立・野心70） → 0.675。

### 4.3 派閥対立（`FACTION_CONFLICTS`）

| 派閥 | 対立する勅令 | 根拠 |
|------|--------------|------|
| 開発 | build/invest/tax で m<0 | 開発派は財源と事業の縮小を嫌う |
| 商業 | tax で m>0、target=security | 商人は増税と取り締まりを嫌う |
| 保守 | build で m>60（急な大事業） | 変化を嫌う（任命候補のみ） |
| 軍事 | welfare への投資 | 民への施しを嫌う（任命候補のみ） |
| 環境 | road への build（m>0） | 開発を嫌う（任命候補のみ） |

### 4.4 歪みの判定（この順に独立判定）

| 歪み | 発生条件 | 確率 | 効果 | 定数 |
|------|----------|------|------|------|
| 規模の誤読 | 常に | `(1-accuracy)*MISREAD_CHANCE_SCALE` | `m *= 1 ± randRange(MISREAD_MIN, MISREAD_MAX)`（符号は等確率） | 1.0 / 0.3 / 0.5 |
| 対象の取り違え | 専門外のみ | `(1-accuracy)*TARGET_SWAP_CHANCE_SCALE` | 同じ action で許可された別 target をランダムに選ぶ | 0.5 |
| 骨抜き | 派閥対立のみ | `WATER_DOWN_BASE_CHANCE + (100-loyalty)/WATER_DOWN_LOYALTY_DIVISOR` | 効果量 ×`WATER_DOWN_EFFECT_FACTOR`、**コストは減らない** | 0.4 / 200 / 0.5 |
| 隠蔽 | `ambition>=CONCEAL_AMBITION_MIN` かつ `loyalty<=CONCEAL_LOYALTY_MAX` | `CONCEAL_BASE_CHANCE + (ambition-loyalty)/CONCEAL_DIVISOR` | 側近報告から**悪化項目**を消す（状態は変えない） | 60 / 60 / 0.3 / 100 |
| 横領 | 町以降 | — | P0 では発生しない（汚職は税収目減りで表現） | — |

根拠：誤読は SPEC「±30〜50%」を一様分布に。取り違えは専門外のみ・誤読の半分の頻度（理不尽さを抑える、SPEC §9.3-3）。骨抜きは「コストは払ったのに中身が半分」で新聞との乖離を生む。隠蔽は初期 B（野心70・忠誠60）で40%となり、報告の信頼性に側近差をつける。

### 4.5 報告の欠落

| 定数 | 値 | 効果 |
|------|----|------|
| `REPORT_OMIT_CHANCE_DIVISOR` | 400 | 各報告項目が `(100-ability)/400` で欠落（能力60で10%） |
| `REPORT_LOW_TRUST_THRESHOLD` / `REPORT_LOW_TRUST_MAX_ITEMS` | 40 / 2 | 信頼が低いと報告項目が減る（SPEC §5.2） |

---

## 5. 役所

| 定数 | 値 | 根拠 |
|------|----|------|
| `OFFICE_COST` | 400 | 約3年分の税収。目標直前に貯める判断を強いる |
| `OFFICE_MIN_POPULATION` | 200 | 人口が育つ前の早期決着を防ぐ |
| `OFFICE_MIN_INFRASTRUCTURE` | 15 | 道路の通っていない村に役所は建たない |
| 不成立時 | — | 国庫・パラメータ変化なし（政治資本と `DECREE_BASE_COST` は消費）。理由を側近報告で返す（A-07 の縮小表記と同じ欄） |
| 建設後 | — | `OFFICE_UPKEEP`。地図に役所1区画（SPEC §8.2） |

## 6. 地図・見た目と実態

| 定数 | 値 | 根拠 |
|------|----|------|
| `GRID_SIZE` | 10 | SPEC §8.2 |
| 住宅タイル数 | `floor(housingUnits)`（SPEC の `floor(人口/20)` から変更案。DECISIONS N-01） | A-08 の「住宅区画数」と整合させる |
| `INFRA_PER_ROAD_TILE` | 5 | SPEC §8.2 `floor(インフラ/5)` |
| `MIN_EMPTY_TILES` | 10 | SPEC「空き地は常に一定数確保」。超過分は描かない |
| 配置順 | 中心から時計回りの螺旋順に 役所→道路→住宅→市場→空き地 | 決定論的 |
| 市場タイル | `marketCount` 枚 | SPEC §12.7 のタイル種別。P0 で描く（A-03 の target に含まれたため） |
| `hollowInfrastructure` | 骨抜きで失われた build 系の効果量を記録。見た目の道路数は `floor((infrastructure+hollow)/5)` | 見た目と実態の乖離を骨抜きから生む |
| `HOLLOW_DECAY_PER_TURN` / `HOLLOW_DISCLOSE_ABILITY_MIN` | 1 / 70 | 能力70以上の側近は空洞を開示し亀裂アイコンを表示 |

## 7. 新聞（偏向度30）

| 定数 | 値 | 根拠 |
|------|----|------|
| `NEWSPAPER_BIAS` | 30 | SPEC §4.1 |
| 数値ノイズ | 報告数値 = 実数値 × `(1 + randRange(-BIAS/100, BIAS/100))` | CLAUDE.md §6 #9 |
| `NEWSPAPER_TONE_CHANCE` | 0.3 | 各記事で論調語が政府寄り（悪化は控えめ、改善は誇張）になる確率 |

---

## 8. 意図達成ボーナス（A-01）
幸福度 `+INTENT_BONUS_HAPPINESS`（5）。ペナルティなし。判定は宣言値と実変化の単純比較（DECISIONS D-03）。

## 9. P0 試算結果（2026-10-24、使い捨てスクリプト、各2000本。P1 の実測は §11）

| 方策 | 到達 | ゲームオーバー | 時間切れ | 平均到達ターン | GO内訳 |
|------|------|----------------|----------|----------------|--------|
| **ヒューリスティック（主指標）** | **73%** | **20%** | 8% | 33.3 | 財政破綻 20% |
| ヒューリスティック（ノイズなし・参考） | 99% | 0% | 0% | 28.8 | — |
| ランダム勅令（参考・合否に使わない） | 2% | 75% | 23% | 39.5 | 財政64%・幸福度8%・人口2% |

**ヒューリスティック方策の定義**（P1 の `npm run sim` で同じものを実装する）：真の状態を見て次の優先順位で決め、**各ターン `HEURISTIC_NOISE`（0.35）の確率でランダム勅令に置き換える**（情報の不確かさ・誤読の代理）。
1. 幸福度<45 → welfare 投資(40) 2. 役所の条件充足(人口≥200・インフラ≥15・国庫≥400) → office 3. 国庫<150 → 増税(30) 4. 人口>容量×0.9 → residential(40) 5. インフラ<26 → road(40) 6. 汚職>20 → security(40) 7. それ以外 → well(30)

所見：
- **主指標は目標帯に入った**が、「到達70〜90%」と「GO20〜40%」は合計100%以内に収める必要があり、**到達73%・GO20%・時間切れ8%と帯の端**になっている（DECISIONS N-03）。
- **GO の内訳は、ヒューリスティックではほぼ財政破綻**。幸福度・人口の経路（A-08）は、ランダム方策では約10%発生するが、状況を見て手を打つ方策では起きにくい。「経路が現実的に発生する」の検証は、**人間のプレイ（P4）で見るしかない**（DECISIONS N-03）。
- 歪みを無効にすると到達率が約56%に下がった（歪み有 73%）。現在の歪みは平均的には難度を上げておらず、結果のばらつき（意図とのズレ）を作る側に効いている。歪みの強さは P1 の sim で再検証が必要。
- 試算スクリプトは §3 の式を簡略化している（報告・新聞・意図は含まない）。数値は目安。

## 10. 定数一覧（constants.ts 転記用）

```
INITIAL_POPULATION=120  INITIAL_TREASURY=500  INITIAL_HAPPINESS=50  INITIAL_INFRASTRUCTURE=10  INITIAL_CORRUPTION=5
INITIAL_HOUSING_UNITS=8  INITIAL_POLITICAL_CAPITAL=3  POLITICAL_CAPITAL_INCOME=1  POLITICAL_CAPITAL_MAX=5
DECREE_POLITICAL_COST=1  APPOINT_POLITICAL_COST=1  DISMISS_POLITICAL_COST=0  DECREE_BASE_COST=10  MAX_TURNS=50
DECREE_CHAR_LIMIT=40  TAG_CHAR_COST=3  MAX_TAGS=2  INTENT_BONUS_HAPPINESS=5
RESIDENTS_PER_HOUSING_TILE=20  HAPPINESS_GROWTH_THRESHOLD=50  POPULATION_GROWTH_BASE=0.03  POPULATION_GROWTH_PER_HAPPINESS=0.002
POPULATION_OUTFLOW_PER_HAPPINESS=0.004  OVERCROWD_OUTFLOW_RATE=0.15
TAX_PER_CAPITA=1.25  INFRA_UPKEEP_PER_POINT=2.0  AIDE_SALARY=15  OFFICE_UPKEEP=20  MARKET_TAX_BONUS=0.12  MARKET_MAX=3
HAPPINESS_EQUILIBRIUM_BASE=48  HAPPINESS_PER_INFRA=0.4  HAPPINESS_PENALTY_PER_CORRUPTION=0.2  HAPPINESS_REVERT_RATE=0.1
CROWDING_HAPPINESS_PENALTY=3  NEGLECTED_CORRUPTION_THRESHOLD=50  NEGLECTED_CORRUPTION_PENALTY=3
INFRA_DECAY_CHANCE=0.3  INFRA_DECAY_AMOUNT=1  CORRUPTION_DRIFT_PER_TURN=0.3
ROAD_INFRA_PER_MAG=0.12  ROAD_COST_PER_MAG=4  WELL_INFRA_PER_MAG=0.06  WELL_HAPPINESS_PER_MAG=0.05  WELL_COST_PER_MAG=3
RESIDENTIAL_UNITS_PER_MAG=0.06  RESIDENTIAL_COST_PER_MAG=5  MARKET_COST=150
LEVY_PER_CAPITA_PER_MAG=0.03  LEVY_HAPPINESS_PER_MAG=0.25  RELIEF_HAPPINESS_PER_MAG=0.1
WELFARE_HAPPINESS_PER_MAG=0.15  WELFARE_COST_PER_MAG=3
SECURITY_CORRUPTION_PER_MAG=0.1  SECURITY_HAPPINESS_PER_MAG=0.03  SECURITY_COST_PER_MAG=2
LOW_CONFIDENCE_THRESHOLD=0.3
ACCURACY_BASE=0.3  ACCURACY_ABILITY_DIVISOR=200  ACCURACY_SPECIALTY_BONUS=0.2  ACCURACY_TRUST_THRESHOLD=70  ACCURACY_TRUST_BONUS=0.1
ACCURACY_AMBITION_THRESHOLD=70  ACCURACY_AMBITION_PENALTY=0.2
MISREAD_CHANCE_SCALE=1.0  MISREAD_MIN=0.3  MISREAD_MAX=0.5  TARGET_SWAP_CHANCE_SCALE=0.5
WATER_DOWN_BASE_CHANCE=0.4  WATER_DOWN_LOYALTY_DIVISOR=200  WATER_DOWN_EFFECT_FACTOR=0.5
CONCEAL_AMBITION_MIN=60  CONCEAL_LOYALTY_MAX=60  CONCEAL_BASE_CHANCE=0.3  CONCEAL_DIVISOR=100
REPORT_OMIT_CHANCE_DIVISOR=400  REPORT_LOW_TRUST_THRESHOLD=40  REPORT_LOW_TRUST_MAX_ITEMS=2
OFFICE_COST=400  OFFICE_MIN_POPULATION=200  OFFICE_MIN_INFRASTRUCTURE=15
GRID_SIZE=10  INFRA_PER_ROAD_TILE=5  MIN_EMPTY_TILES=10  HOLLOW_DECAY_PER_TURN=1  HOLLOW_DISCLOSE_ABILITY_MIN=70
NEWSPAPER_BIAS=30  NEWSPAPER_TONE_CHANCE=0.3
SUCCESS_POPULATION=300  SUCCESS_INFRASTRUCTURE=25
HEURISTIC_NOISE=0.35  （sim 専用）
LLM_TIMEOUT_MS=5000  LLM_MAX_RETRIES=2  LLM_BACKOFF_BASE_MS=500  LLM_TEMPERATURE=0.2
```

---

## 11. P1 実測（`npm run sim`、各方策1000ゲーム、seed 1〜1000）

`npm run sim` は本番と同じ経路（DecreeParser のスキーマ検証 → AideInterpreter の歪み → RuleEngine → IntentEvaluator → エンディング判定）を通す。LLM はモックで、Bot が決めた DecreeIntent をそのまま「参謀の出力」として返す（テンプレートパーサーは通らない）。方策は §9 の定義どおり（ヒューリスティックの優先順位ルール＋`HEURISTIC_NOISE`=0.35 でランダム勅令に置換）。意図宣言・任命/解任は使わない。sim は seed 固定なので、同じ定数なら同じ結果になる。

### 11.1 最終結果（採用値：`TAX_PER_CAPITA`=1.25、`POPULATION_GROWTH_BASE`=0.03）

| 方策 | 到達 | ゲームオーバー | 時間切れ | GO内訳 | 平均ターン | 平均到達ターン |
|------|------|----------------|----------|--------|------------|----------------|
| **heuristic（主指標）** | **71.7%** | **22.0%** | 6.3% | 財政破綻 22.0% | 32.2 | 32.6 |
| heuristic-clean（ノイズなし・参考） | 99.6% | 0.4% | 0.0% | 財政破綻 0.4% | 27.7 | 27.7 |
| random（参考・合否に使わない） | 0.8% | 77.3% | 21.9% | 財政 68.0% / 幸福度 7.5% / 人口 1.8% | 31.5 | 41.5 |

**A-02 判定：PASS**（到達 70〜90%、ゲームオーバー 20〜40%）。

### 11.2 調整履歴（定数のみ変更。ロジックは変えていない）

| # | 変更 | heuristic 到達 | heuristic GO | 時間切れ | 判定 | メモ |
|---|------|----------------|--------------|----------|------|------|
| 0 | P0 案のまま（`TAX_PER_CAPITA`=1.32、`POPULATION_GROWTH_BASE`=0.025） | 74.7% | 17.7% | 7.6% | FAIL | GO が下限割れ。P0 の Python 試算（73%/20%）より易しい。主因は骨抜きで「コストは減らない」（本実装）と、Python 版の簡略化の差 |
| 1 | `TAX_PER_CAPITA` 1.32→1.30 | 73.6% | 19.0% | 7.4% | FAIL | |
| 2 | `TAX_PER_CAPITA` →1.28 | 70.8% | 20.7% | 8.5% | PASS | 両指標とも下限ぎりぎり |
| 3 | `TAX_PER_CAPITA` →1.26、`POPULATION_GROWTH_BASE` 0.025→0.03 | 73.1% | 20.2% | 6.7% | PASS | 成長を速めて時間切れを減らし、到達の余裕を作る |
| 4 | `TAX_PER_CAPITA` →1.24（成長 0.03） | 69.7% | 22.8% | 7.5% | FAIL | 到達が下限割れ |
| 5 | **`TAX_PER_CAPITA` →1.25（成長 0.03）** | **71.7%** | **22.0%** | 6.3% | **PASS** | **採用**。到達・GO とも下限から約1.5〜2ポイントの余裕 |

### 11.3 所見
- **到達率とゲームオーバー率のトレードオフが急**：`TAX_PER_CAPITA` を 0.01 動かすと到達・GO がそれぞれ約1.5ポイント動く。時間切れが約6〜8%あるため、「到達≧70%」と「GO≧20%」を同時に満たせる幅は狭い（DECISIONS N-03 のとおり）。
- **ヒューリスティックの GO はほぼ全て財政破綻**。A-08 の幸福度・人口経路はランダム方策でのみ約9%発生する。人間のプレイで発生するかは P4 で確認する。
- ノイズなしのヒューリスティックはほぼ全勝（99.6%）。難度の大半は「誤った勅令を出すこと」（ノイズ＝情報の不確かさの代理）から来ている。実プレイの難しさは新聞ノイズ・報告の隠蔽/欠落・LLM の解釈揺れに依存するため、人間の到達率（目標50〜70%）は P4 で実測するまで分からない。
- 実行時間：3方策×1000ゲームで約40秒。


---

# 第2部　v3.2 モデルの初期案（未承認・未実装）

`docs/SPEC_v3.2.md`（建物17＋政策3・派生指標・新聞 v2）に合わせた初期案。論点の結論は DECISIONS.md §11 の推奨案を前提にしている（承認で変わりうる）。
試算は使い捨ての Python スクリプト（リポジトリ外。新聞は含まない簡略モデル）で行い、正式な検証は P1 の `npm run sim` で取り直す。
表中の記事番号は v3.2 §1.3 の記事タイプ（**記事N-xx**。DECISIONS の論点番号 N-xx とは別物）。

## 12. 単位と課金タイミング（V-14 / V-06）

| 項目 | 決定案 | 根拠 |
|------|--------|------|
| 「税+N」 | **毎ターン（1年）**の国庫収入。建物1棟ごと（空洞の建物は0） | v3.2 §5 #14 の推奨 |
| 「維持費N」 | **毎ターン**の国庫支出。建物1棟ごと（空洞でも払う） | 同上。空洞は「金だけ食う」 |
| 建設費 | **建てたターンに一括**（勅令の執行時、自然変化の前） | 現行の効果適用と同じ順序 |
| 維持費の開始 | 建てたターンから払う | 単純化 |
| 「幸福+N」 | 建物が**ある間ずっと**、幸福度の平衡点に加算（1回きりの増減ではない） | 1回きりだと平衡点への回帰で数年で消え、建物の性格（長屋は住みにくい等）が表れない |
| 幸福への寄与の人口補正 | 建物の幸福寄与の合計 × `HAPPINESS_REF_POP / max(HAPPINESS_REF_POP, 人口)` | 同じ寺院1つでも、人が増えれば一人あたりの効き目は薄れる（建物を積むだけで幸福が青天井になるのを防ぐ） |
| 「インフラ+3」（道路） | 1本ごとに台帳のインフラを +3（ストック。劣化は従来どおり） | 道路は「数える建物」ではなく、インフラ台帳を増やす事業として扱う（DECISIONS W-04） |
| 道路の税・維持費 | 地図上の道路タイル数（`floor(インフラ/5)`、最大20）× 税2・維持費1 | 道路の数と台帳のインフラを二重管理しないため |

## 13. 初期状態（V-02：開始直後に記事N-05/06/14 を発火させない）

| 定数 | 値 | 根拠 |
|------|----|------|
| `INITIAL_BUILDINGS` | 住宅7・農地3・井戸1・見張り塔1（他は0） | 下の派生指標がすべて閾値を超える最小構成 |
| 初期の台帳 | 人口120・国庫500・幸福度50・インフラ10・汚職率5・政治資本3 | v3.0 §7.1 / A-01 のまま |

開始時の派生指標（試算で確認）：

| 派生指標 | 式（クランプ前） | 開始時 | 1年目（何もしない場合） | 発火条件 |
|----------|------------------|--------|--------------------------|----------|
| 住宅容量 | 20×住宅 + 35×長屋 + 10×屋敷 | 140 | 140（人口124） | 記事N-05：人口 > 容量 → **発火しない** |
| 食料 | 4×農地 + 2×倉庫 | 12 | 12（需要10.3） | 不足判定は §15 |
| 衛生 | 3×井戸 + 2×診療所 − 2×工房 − 過密 | 3 | 3 | 記事N-06：衛生 < 3 → **発火しない** |
| 治安 | 3×見張り塔 + 4×牢屋 + 2×寺院 + 治安政策 − 過密 | 3 | 3 | 記事N-14：治安 < 3 → **発火しない** |
| 行政能力 | 1×役所 + 0.5×学校 | 0 | 0 | — |

注意：衛生・治安は**ちょうど閾値**で始まる。工房1つ・長屋1つ・過密（人口が容量を50超える）だけで下回る。これは「建物のトレードオフがすぐ効く」意図どおりの緊張だが、試遊で厳しすぎれば `SANITATION_BASE` / `SECURITY_BASE`（既定0）を足して緩める。

## 14. 建物（V-06：建設数・前提・用地）

### 14.1 magnitude → 建設数

```
建設数 = min(MAX_BUILD_PER_DECREE, max(1, ceil(magnitude / MAGNITUDE_PER_BUILDING)))   ※ magnitude > 0 のとき
```

| 定数 | 値 | 根拠 |
|------|----|------|
| `MAGNITUDE_PER_BUILDING` | 34 | 規模タグ 小(25)→1棟、中(50)→2棟、大(80)→3棟 |
| `MAX_BUILD_PER_DECREE` | 3 | 1回の勅令で建つのは最大3棟。「長屋を三つ」は参謀が magnitude ≈ 99 に訳す（システムプロンプトで「n 棟なら magnitude = 33n」と指示） |
| 役所 | 最大1（2棟目は「すでにある」で no-op） | v3.2 §2.6「1区画固定」 |

### 14.2 予算・用地による縮小（A-07 の拡張）
- 建設数は **国庫で買える棟数**（`floor(国庫 / 建設費)`）と **空き用地**まで減らす。減ったことは「側近による補正」に「予算不足のため3棟→1棟」と出す。
- 0棟になったら no-op（国庫は消費しない）。役所は1棟なので、買えなければ不成立（A-07 と同じ結果）。

| 定数 | 値 | 根拠 |
|------|----|------|
| `BUILDING_TILE_CAPACITY` | 80 | 100区画のうち道路の最大20区画を予約。建物は残り80区画まで（V-07） |

### 14.3 建物表（v3.2 §2.3 の値。調整は全体倍率で行う）

| 建物 | 建設費 | 維持費/年 | 税/年 | 幸福 | 派生 | 前提 | 空洞化の対象 |
|------|--------|-----------|-------|------|------|------|--------------|
| 住宅 residential | 100 | 2 | 0 | +1 | 容量+20 | — | |
| 長屋 tenement | 80 | 1 | 0 | −2 | 容量+35、衛生−2 | — | |
| 屋敷 manor | 250 | 3 | 5 | −3 | 容量+10 | 人口≥200 | |
| 道路 road | 80 | （タイル1） | （タイル2） | — | インフラ+3 | — | |
| 井戸 well | 60 | 1 | 0 | +2 | 衛生+3 | — | |
| 倉庫 granary | 120 | 2 | 0 | 0 | 食料+2 | — | ✓ |
| 市場 market | 150 | 2 | 4 | +1 | — | — | ✓ |
| 農地 farm | 70 | 1 | 1 | 0 | 食料+4 | — | |
| 工房 workshop | 120 | 2 | 3 | −1 | 衛生−2 | — | ✓ |
| 役所 office | 300 | 5 | 0 | 0 | 行政+1 | 最大1 | |
| 徴税所 taxoffice | 100 | 1 | 5 | −3 | — | — | |
| 裁判所 courthouse | 200 | 3 | 0 | +2 | 汚職−3/年 | 役所 | |
| 診療所 clinic | 120 | 2 | 0 | +2 | 衛生+2 | — | ✓ |
| 学校 school | 180 | 3 | 0 | +1 | 行政+0.5（`SCHOOL_ADMIN_DELAY_TURNS` 後） | — | ✓ |
| 寺院 temple | 150 | 2 | 0 | +3 | 治安+2 | — | |
| 見張り塔 watchtower | 100 | 2 | 0 | 0 | 治安+3 | — | |
| 牢屋 jail | 150 | 2 | 0 | −2 | 治安+4 | 見張り塔 | |

| 定数 | 値 | 根拠 |
|------|----|------|
| `BUILD_COST_MULTIPLIER` | 1.0 | v3.2 §2.8 のレバー（±50%） |
| `UPKEEP_MULTIPLIER` | 1.5 | 同上の上限。1.0 では財政がほぼ破綻せず（試算 GO 7%）、時間切れが増えるだけだった |
| `SCHOOL_ADMIN_DELAY_TURNS` | 5 | 「行政能力+0.5（長期）」。建ててから5年後に効く |
| `ADMIN_ACCURACY_PER_POINT` / `ADMIN_ACCURACY_MAX` | 0.05 / 0.15 | v3.2 §2.5。側近の精度に加算。行政能力は**勅令の時点の建物**から計算する＝建てた翌年から効く（v3.2 §4 #4） |

## 15. 派生指標の効果（V-05：食料・治安・衛生が幸福度/人口に与える効果）

派生指標はすべて `max(0, …)` でクランプし、判定もクランプ後の値で行う（V-04）。過密 = `max(0, (人口 − 住宅容量) / 50)`。

| 状態 | 判定 | 幸福度（平衡点へのペナルティ） | 人口 | 定数 |
|------|------|-------------------------------|------|------|
| 住宅不足（A-08） | 人口 > 住宅容量 | −3/年 | 増えず、超過分の15%が流出 | `CROWDING_HAPPINESS_PENALTY`=3、`OVERCROWD_OUTFLOW_RATE`=0.15 |
| 食料不足 | 食料 < 人口 / `PEOPLE_PER_FOOD` | −15 × 不足率/年 | 増えず、15% × 不足率が流出 | `PEOPLE_PER_FOOD`=12、`FAMINE_HAPPINESS_PENALTY`=15、`FAMINE_OUTFLOW_RATE`=0.15 |
| 衛生不良 | 衛生 < 3 | −3/年 | 毎年2%流出（疫病） | `SANITATION_LOW`=3、`SANITATION_PENALTY`=3、`DISEASE_OUTFLOW_RATE`=0.02 |
| 治安不良 | 治安 < 3 | −3/年 | — | `SECURITY_LOW`=3、`SECURITY_PENALTY`=3 |
| 汚職の放置（A-08） | 汚職率 > 50 | −3/年 | — | v3.1 のまま |

不足率 = (需要 − 食料) / 需要。閾値は新聞のトリガー（記事N-06/14 の `<3`）と同じ値にそろえ、「新聞が騒ぐ＝実害が出ている」が一致するようにした。

幸福度の平衡点：

```
平衡点 = HAPPINESS_EQUILIBRIUM_BASE
       + Σ(建物の幸福 × 棟数) × HAPPINESS_REF_POP / max(HAPPINESS_REF_POP, 人口)
       + インフラ × HAPPINESS_PER_INFRA − 汚職率 × 0.2
       + 政策の効果（§16） − ペナルティ（上表） / 0.1
```

| 定数 | 値 | 根拠 |
|------|----|------|
| `HAPPINESS_EQUILIBRIUM_BASE` | 45 | 初期建物の幸福寄与（+9）・インフラ（+2）・汚職（−1）と合わせて開始時の平衡点 ≈ 55。人口がゆっくり増え始める |
| `HAPPINESS_PER_INFRA` | 0.2 | v3.1 の 0.4 から半減（幸福の主な出どころを建物に移したため） |
| `HAPPINESS_REF_POP` | 120 | 開始時の人口で補正1 |
| `POPULATION_GROWTH_BASE` | 0.04 | v3.1 の 0.03 から上げる。建物を建てる手間が増えた分、自然増で時間切れを減らす |
| `TAX_PER_CAPITA` | 1.1 | 人頭税。建物の税と合わせて試算で決めた |

## 16. 政策3種（未決 §4 #6）

政策は「建てる」ものではなく**水準**（−2〜+2、初期0）を持つ。勅令で ±1（規模が大きければ ±2）動かす。最後の勅令から `POLICY_DURATION_TURNS` 年続き、その後は毎年1段階ずつ0に戻る。

| 政策 | +1段階あたりの効果（毎年） | −1段階あたり | 定数 |
|------|---------------------------|--------------|------|
| 税率 tax_rate | 人頭税 +15%、幸福の平衡点 −3。**上げた瞬間に幸福 −2/段階**（A-08「増税で幸福ペナルティ」） | 人頭税 −15%、幸福 +3 | `TAX_RATE_INCOME_PER_LEVEL`=0.15、`TAX_RATE_HAPPINESS_PER_LEVEL`=3、`TAX_RATE_SHOCK_PER_LEVEL`=2 |
| 福祉政策 welfare_policy | 幸福の平衡点 +3、国庫 −0.12×人口 | 国庫の支出なし、幸福 −3 | `WELFARE_HAPPINESS_PER_LEVEL`=3、`WELFARE_COST_PER_CAPITA_PER_LEVEL`=0.12 |
| 治安政策 security_policy | 治安 +2、幸福の平衡点 −1.5、国庫 −10 | 治安 −2、幸福 +1.5 | `SECURITY_POLICY_SECURITY_PER_LEVEL`=2、`SECURITY_POLICY_HAPPINESS_PER_LEVEL`=1.5、`SECURITY_POLICY_COST_PER_LEVEL`=10 |

| 定数 | 値 | 根拠 |
|------|----|------|
| `POLICY_LEVEL_MAX` | 2 | 両方向に2段階。極端な政策を続けるには勅令を出し続ける必要がある |
| `POLICY_DURATION_TURNS` | 4 | 一度の勅令で4年効く。放っておけば戻る（勅令1回の価値を建物とおおむね釣り合わせる） |
| `POLICY_LARGE_MAGNITUDE` | 60 | これ以上の規模なら ±2 段階 |

## 17. 汚職による空洞化（未決 §4 #5）

| 項目 | 決定案 | 定数 |
|------|--------|------|
| 対象建物 | **倉庫・市場・工房・診療所・学校**（外から使われているか見えにくい建物）。住宅・道路・井戸・農地・役所・治安系は対象外 | `HOLLOWABLE_BUILDINGS` |
| 発生 | 建てた1棟ごとに、確率 `min(HOLLOW_MAX_CHANCE, 汚職率/100)` で空洞になる | `HOLLOW_MAX_CHANCE`=0.3（v3.2 §2.8 の上限） |
| 骨抜き（歪み）との統合 | 骨抜きされた建設は、建てた棟数の半分（端数は確率）が空洞になる。費用は全額 | v3.1 の「効果半減・費用据え置き」を棟数で表したもの |
| 空洞の効果 | 地図には普通に表示、維持費はかかる、効果（税・幸福・派生）はゼロ | — |
| 露見 | 能力70以上の側近が報告で言及（`HOLLOW_DISCLOSE_ABILITY_MIN`=70）。投書（記事N-16）が「におわせ」る | v3.2 §1.8, §1.9 |
| 修繕 | `invest` × その建物で、空洞の棟を建設費の半額で修繕（修繕が先、余りは新築） | `HOLLOW_REPAIR_COST_RATIO`=0.5 |

## 18. 新聞 v2 の固定値（v3.2 §1.5〜§1.7）

| 定数 | 値 | 根拠 |
|------|----|------|
| `NEWSPAPER_IDEOLOGICAL_BIAS` / `NEWSPAPER_CENSORSHIP` / `NEWSPAPER_BUREAUCRATIC_PRESSURE` | 30 / 20 / 10 | v3.2 §1.5 の P0 固定値 |
| 数値のヘッジ確率 | `NEWSPAPER_IDEOLOGICAL_BIAS / 100`（=0.3） | 「bias/100」の bias は思想的偏向と解釈（DECISIONS W-07） |
| `NEWSPAPER_MAX_ARTICLES` / `NEWSPAPER_MIN_ARTICLES` | 7 / 5 | V-10：上限7で打ち切る（優先：スレッド → 第一面 → 負の記事 → フレーバー） |
| `NEWSPAPER_MAX_THREAD_ARTICLES` | 2 | §1.6 手順1 |
| `NEWSPAPER_RECENT_TURNS` / `NEWSPAPER_RECENT_WEIGHT` | 3 / 0.3 | §1.6 手順3 |
| `THREAD_MIN_TURNS` / `THREAD_MAX_TURNS` | 2 / 3 | §1.7（housing_crisis は解消まで） |
| 記事N-04 / N-11 / N-17 の閾値 | 幸福度<40 / 汚職率>30 / 側近の野心≥70 | N-17 は A-04 と同じ理由で `>=`（W-06） |
| 記事N-03（遷移間近） | 成功3条件のうち2つを満たし、残り1つが目標の90%以上 | 「間近」の定義（W-08） |
| `truthfulness` | 1.0 から、ヘッジ −0.1・婉曲 −0.2・称賛転換 −0.5（下限0）。UI 非表示 | 内部保持のみ（不変条件13） |

## 19. 試算結果（2026-10-25、使い捨てスクリプト、各1000本。新聞・報告・LLM は含まない）

ヒューリスティック方策は v3.1 版（§9）を v3.2 の建物に置き換えたもの：幸福<45→福祉政策 / 食料が需要の1.15倍未満→農地 / 容量が人口の1.12倍未満→住宅 / 衛生<4→井戸 / 治安<4→見張り塔 / 役所なし・人口≥150・国庫≥320→役所 / 国庫<150→税率 / インフラ<26→道路 / 汚職>20かつ役所あり→裁判所 / それ以外→市場。35% はランダム勅令（20種から一様）。

| 設定 | heuristic 到達 | GO | 時間切れ | ノイズなし到達 | ランダム GO |
|------|----------------|----|----------|----------------|-------------|
| v3.2 表の値そのまま（人頭税1.0、維持費×1.0、成長0.03） | 18% | 21% | 61% | 46% | 68% |
| 幸福基準43・人頭税1.2・役所の判断を調整 | 79% | 8% | 13% | 100% | 54% |
| **採用案**：基準45・成長0.04・人頭税1.1・**維持費×1.5** | **71%** | **10%** | 19% | 100% | 56% |
| 参考：維持費×2.5・人頭税1.3（v3.2 の調整幅外） | 66% | 14〜15% | 20% | 97% | 74% |

所見：
- **A-02 の主指標（到達70〜90%）は満たすが、ゲームオーバー率（20〜40%）に届かない。** 建設は国庫に合わせて縮小される（A-07）ため、破綻は維持費の累積でしか起きない。v3.2 の調整幅（維持費±50%）の内側では GO は約10%が上限だった。GO を上げるには、(a) 維持費の倍率を調整幅の外まで上げる、(b) 予算縮小をやめて超過支出を許す、(c) GO 目標を見直す、のいずれかが要る（DECISIONS §11 の質問）。
- ヒューリスティックの GO は財政破綻のみで、幸福度・人口経路はほぼ0%。ランダム方策でも財政破綻のみになった（v3.1 では幸福度8%）。食料・衛生の罰則を強めると増えるが、P1 で本物のエンジンを使って詰める。
- 建物の使用分布のエントロピー（v3.2 §3.2 の KPI の試算）：ヒューリスティック 3.2bit、ノイズなし 2.5bit、ランダム 3.8bit（20種一様なら 4.3bit）。

## 20. 定数一覧（v3.2 追加分。P1 で constants.ts へ）

```
INITIAL_BUILDINGS={residential:7,farm:3,well:1,watchtower:1}
MAGNITUDE_PER_BUILDING=34  MAX_BUILD_PER_DECREE=3  BUILDING_TILE_CAPACITY=80  ROAD_TILE_MAX=20
BUILD_COST_MULTIPLIER=1.0  UPKEEP_MULTIPLIER=1.5  ROAD_TILE_TAX=2  ROAD_TILE_UPKEEP=1  INFRA_PER_ROAD_BUILD=3
TAX_PER_CAPITA=1.1  POPULATION_GROWTH_BASE=0.04  HAPPINESS_EQUILIBRIUM_BASE=45  HAPPINESS_PER_INFRA=0.2  HAPPINESS_REF_POP=120
PEOPLE_PER_FOOD=12  FAMINE_HAPPINESS_PENALTY=15  FAMINE_OUTFLOW_RATE=0.15
SANITATION_LOW=3  SANITATION_PENALTY=3  DISEASE_OUTFLOW_RATE=0.02  SECURITY_LOW=3  SECURITY_PENALTY=3
SANITATION_BASE=0  SECURITY_BASE=0  OVERCROWD_DIVISOR=50  COURTHOUSE_CORRUPTION_PER_TURN=3
SCHOOL_ADMIN_DELAY_TURNS=5  ADMIN_ACCURACY_PER_POINT=0.05  ADMIN_ACCURACY_MAX=0.15
POLICY_LEVEL_MAX=2  POLICY_DURATION_TURNS=4  POLICY_LARGE_MAGNITUDE=60
TAX_RATE_INCOME_PER_LEVEL=0.15  TAX_RATE_HAPPINESS_PER_LEVEL=3  TAX_RATE_SHOCK_PER_LEVEL=2
WELFARE_HAPPINESS_PER_LEVEL=3  WELFARE_COST_PER_CAPITA_PER_LEVEL=0.12
SECURITY_POLICY_SECURITY_PER_LEVEL=2  SECURITY_POLICY_HAPPINESS_PER_LEVEL=1.5  SECURITY_POLICY_COST_PER_LEVEL=10
HOLLOW_MAX_CHANCE=0.3  HOLLOW_REPAIR_COST_RATIO=0.5  HOLLOW_DISCLOSE_ABILITY_MIN=70
NEWSPAPER_IDEOLOGICAL_BIAS=30  NEWSPAPER_CENSORSHIP=20  NEWSPAPER_BUREAUCRATIC_PRESSURE=10
NEWSPAPER_MAX_ARTICLES=7  NEWSPAPER_MIN_ARTICLES=5  NEWSPAPER_MAX_THREAD_ARTICLES=2  NEWSPAPER_RECENT_TURNS=3  NEWSPAPER_RECENT_WEIGHT=0.3
THREAD_MIN_TURNS=2  THREAD_MAX_TURNS=3
（v3.1 から廃止予定：INITIAL_HOUSING_UNITS, RESIDENTIAL_UNITS_PER_MAG, MARKET_TAX_BONUS, MARKET_MAX, *_PER_MAG 系の効果係数, OFFICE_MIN_POPULATION/INFRASTRUCTURE, NEWSPAPER_BIAS, NEWSPAPER_TONE_CHANCE）
```
