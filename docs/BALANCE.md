# BALANCE.md — P0 バランス初期案

| 項目 | 内容 |
|------|------|
| ステータス | **初期案（未承認）** |
| 対象 | SPEC v3.0 §7（パラメータ）/ §6.4（歪み）/ §8.2（地図）/ CLAUDE.md §6 #6〜#8, #11 |
| 目標 | ランダム勅令シミュレーションで **到達率30〜50%、ゲームオーバー率20〜40%**（SPEC §9.2） |

- 定数名はすべて `src/domain/constants.ts` にそのまま置く想定（UPPER_SNAKE_CASE）。
- 各式の下の「根拠」は1行で、なぜその形・その値かを書く。
- 確率判定はすべて `Rng` サービス経由（seed 付き）。本書の `rand()` は `[0,1)` の一様乱数、`randRange(a,b)` は `[a,b)` の一様乱数を指す。
- 本書の試算は使い捨ての Python スクリプト（リポジトリ外）で行った。正式な検証は P1 の `pnpm sim` で取り直す（§9）。

---

## 0. 数値の表現

| 定数 | 値 | 根拠 |
|------|----|------|
| — | 人口は整数（毎ターン末に `floor`）。他パラメータは内部では実数、表示は四捨五入 | 人口は「人数」なので端数が不自然。他は係数×規模で端数が出るため、内部で丸めると小さい勅令が消える |
| — | 幸福度・インフラ・汚職率は毎ターン末に `[0,100]` へ clamp。国庫は clamp しない | 国庫のマイナスはゲームオーバー判定に使うため（SPEC §7.2） |

## 1. 初期値・資源

| 定数 | 値 | 根拠 |
|------|----|------|
| `INITIAL_POPULATION` | 120 | SPEC §7.1 |
| `INITIAL_TREASURY` | 500 | SPEC §7.1 |
| `INITIAL_HAPPINESS` | 50 | SPEC §7.1 |
| `INITIAL_INFRASTRUCTURE` | 10 | SPEC §7.1 |
| `INITIAL_CORRUPTION` | 5 | SPEC §7.1 |
| `INITIAL_POLITICAL_CAPITAL` | 3 | SPEC §7.1 の「3/ターン」を初期値兼収入と解釈（DECISIONS D-01） |
| `POLITICAL_CAPITAL_INCOME` | 3 | 同上。※D-01 で「+1」案も提示中 |
| `POLITICAL_CAPITAL_MAX` | 10 | SPEC §7.1 の範囲上限 |
| `DECREE_POLITICAL_COST` | 1 | SPEC §7.1 |
| `APPOINT_POLITICAL_COST` | 1 | SPEC §5.4 |
| `DECREE_BASE_COST` | 10 | 勅令1回の国庫コスト（SPEC §7.4 の難度レバー）。年収の1割弱。勅令を出すだけで国庫が減る緊張感を最小限に付与 |
| `MAX_TURNS` | 50 | SPEC §7.2 |

## 2. ターン更新式（自然変化）

勅令の効果（§3）を適用した**後**に、以下を上から順に計算する（順序は DECISIONS D-15）。

### 2.1 住宅容量

```
capacity = HOUSING_BASE_CAPACITY + infrastructure * HOUSING_CAPACITY_PER_INFRA
```

| 定数 | 値 | 根拠 |
|------|----|------|
| `HOUSING_BASE_CAPACITY` | 100 | 初期インフラ10で容量200。人口120→200までは「放っておいても伸びる」余地を与える |
| `HOUSING_CAPACITY_PER_INFRA` | 10 | インフラ20で容量300＝目標人口。インフラ25（目標値）で350となり、目標達成に必要なインフラ量と整合 |

### 2.2 人口

```
if population > capacity:
    population -= (population - capacity) * OVERCROWD_OUTFLOW_RATE
else:
    rate = happiness >= HAPPINESS_GROWTH_THRESHOLD
         ? POPULATION_GROWTH_BASE + (happiness - 50) * POPULATION_GROWTH_PER_HAPPINESS
         : (happiness - 50) * POPULATION_OUTFLOW_PER_HAPPINESS        // 負の値＝流出
    population = rate > 0 ? min(capacity, population * (1 + rate))
                          : population * (1 + rate)
population = floor(max(0, population))
```

| 定数 | 値 | 根拠 |
|------|----|------|
| `HAPPINESS_GROWTH_THRESHOLD` | 50 | SPEC §7.1「50未満で人口流出」 |
| `POPULATION_GROWTH_BASE` | 0.025 | 120→300 を自然増のみで約37年。30〜50ターンの尺に収まる（0.04だと熟練者が15ターンで終わる） |
| `POPULATION_GROWTH_PER_HAPPINESS` | 0.002 | 幸福度70で成長率+4%。幸福投資が人口に効く手応えを出す |
| `POPULATION_OUTFLOW_PER_HAPPINESS` | 0.004 | 幸福度30で年-8%。流出は増加より速く（失うのは簡単） |
| `OVERCROWD_OUTFLOW_RATE` | 0.3 | 容量超過分の3割が毎年出ていく。インフラ減衰で容量が縮んだときの罰 |

### 2.3 税収と支出（国庫）

```
taxRevenue = population * TAX_PER_CAPITA * (1 - corruption / 100)
upkeep     = infrastructure * INFRA_UPKEEP_PER_POINT
           + AIDE_SALARY * (在任中の側近数)
           + (officeBuilt ? OFFICE_UPKEEP : 0)
treasury  += taxRevenue - upkeep
```

| 定数 | 値 | 根拠 |
|------|----|------|
| `TAX_PER_CAPITA` | 1.2 | 初期の年収 約137。初期国庫500＝約4年分で、最初の数手の投資余地を確保 |
| `INFRA_UPKEEP_PER_POINT` | 1.5 | インフラ25で年37.5。インフラの作りすぎが財政を圧迫する（1.0だと無風、2.0だとランダム勅令の破綻率が過大） |
| `AIDE_SALARY` | 15 | SPEC §7.1「給与で減少」。2人で年30。側近を減らすと財政が楽になるトレードオフ |
| `OFFICE_UPKEEP` | 20 | 役所は建てた後も重い。ただし成功は建設ターンで即判定されることが多いため影響は小さい |
| 汚職の効果 | `(1 - corruption/100)` で税収を目減り | CLAUDE.md §6 #6 の推奨案。村には官僚がいないため、横領の代替として税の取りこぼしで表現 |

### 2.4 幸福度

```
equilibrium = HAPPINESS_EQUILIBRIUM_BASE
            + infrastructure * HAPPINESS_PER_INFRA
            - corruption * HAPPINESS_PENALTY_PER_CORRUPTION
            - (population > capacity * CROWDING_RATIO ? CROWDING_PENALTY : 0)
happiness  += (equilibrium - happiness) * HAPPINESS_REVERT_RATE
```

| 定数 | 値 | 根拠 |
|------|----|------|
| `HAPPINESS_EQUILIBRIUM_BASE` | 48 | 初期（インフラ10・汚職5）の平衡点が約51。何もしなければ微増し、村は「静かに育つ」状態から始まる |
| `HAPPINESS_PER_INFRA` | 0.4 | インフラ25で平衡点+10。インフラが暮らしを良くする実感 |
| `HAPPINESS_PENALTY_PER_CORRUPTION` | 0.2 | 汚職30で平衡点-6。汚職放置が幸福度経由でも効く |
| `CROWDING_RATIO` | 0.9 | 容量の9割を超えると窮屈 |
| `CROWDING_PENALTY` | 30 | 平衡点を30下げる（＝1ターンあたり実質-3）。人口だけ増やしてインフラを怠ると不満が溜まる |
| `HAPPINESS_REVERT_RATE` | 0.1 | 毎年、平衡点との差の1割だけ戻る。勅令の効果が数年残る |

### 2.5 インフラ

```
if rand() < INFRA_DECAY_CHANCE: infrastructure -= INFRA_DECAY_AMOUNT
```

| 定数 | 値 | 根拠 |
|------|----|------|
| `INFRA_DECAY_CHANCE` | 0.3 | 50年で期待値-15。「作ったら終わり」にせず維持の勅令を要求する |
| `INFRA_DECAY_AMOUNT` | 1 | 1回の劣化は小さく、劣化の報告（側近・新聞）を出すきっかけにする |

### 2.6 汚職率

```
corruption += CORRUPTION_DRIFT_PER_TURN
```

| 定数 | 値 | 根拠 |
|------|----|------|
| `CORRUPTION_DRIFT_PER_TURN` | 0.3 | 50年で+15。「村では低い」（SPEC §7.1）が、放置すると税収と幸福度を蝕む |

### 2.7 政治資本

```
politicalCapital = min(POLITICAL_CAPITAL_MAX, politicalCapital + POLITICAL_CAPITAL_INCOME)
```
ターンの最後（エンディング判定の後）に加算する。

---

## 3. 勅令の効果（action × target 行列）

ルールエンジンは歪み適用後の `DecreeIntent` を以下の行列で処理する。行列にない組み合わせは **no-op＋側近報告「意味が取れなかった」**（CLAUDE.md §4-10）。
`m` は歪み適用後の `magnitude`（`[-100,100]` に clamp）。

| action | target | m>0 の効果 | 国庫コスト | m<0 |
|--------|--------|------------|------------|-----|
| build / invest | infrastructure, road | インフラ `+BUILD_INFRA_PER_MAG * m` | `BUILD_COST_PER_MAG * m` | no-op（取り壊しはP0で扱わない） |
| build / invest | housing | インフラ `+HOUSING_INFRA_PER_MAG * m`、幸福 `+HOUSING_HAPPINESS_PER_MAG * m` | `HOUSING_COST_PER_MAG * m` | no-op |
| build | office | 建築条件（§5）を満たせば `officeBuilt = true` | `OFFICE_COST`（規模に依存しない） | no-op |
| tax | treasury（他 target も tax として扱う） | 臨時徴税：国庫 `+population * LEVY_PER_CAPITA_PER_MAG * m`、幸福 `-LEVY_HAPPINESS_PER_MAG * m` | 0 | 減税・施し：国庫 `-population * LEVY_PER_CAPITA_PER_MAG * |m|`、幸福 `+RELIEF_HAPPINESS_PER_MAG * |m|` |
| invest | happiness | 幸福 `+INVEST_HAPPINESS_PER_MAG * m` | `INVEST_HAPPINESS_COST_PER_MAG * m` | no-op |
| invest | population | 移住奨励：人口 `+INVEST_POPULATION_PER_MAG * m`（容量は自然変化で効く） | `INVEST_POPULATION_COST_PER_MAG * m` | no-op |
| reform / invest | corruption | 汚職 `-REFORM_CORRUPTION_PER_MAG * m`、幸福 `-REFORM_CORRUPTION_HAPPINESS_PER_MAG * m` | `REFORM_CORRUPTION_COST_PER_MAG * m` | no-op |
| reform | happiness | 恩赦・祭り：幸福 `+REFORM_HAPPINESS_PER_MAG * m` | `REFORM_HAPPINESS_COST_PER_MAG * m` | no-op |
| appoint / dismiss | 任意 | no-op（P0 は手動介入のみ。DECISIONS D-04） | 0 | — |

**予算不足時**：コストが現在の国庫を上回る場合、効果とコストを `treasury / cost` 倍に縮小する（側近報告「予算不足で規模を縮小した」）。役所だけは縮小せず不成立。根拠：勅令1回で即破綻させず、破綻は「維持費と給与の積み重ね」で起こるようにする。

| 定数 | 値 | 根拠 |
|------|----|------|
| `BUILD_INFRA_PER_MAG` | 0.12 | 規模50で+6。目標まで（+15＋劣化分）おおむね4〜5回の勅令 |
| `BUILD_COST_PER_MAG` | 4 | 規模50で200＝約1.5年分の税収。インフラ1点あたり約33 |
| `HOUSING_INFRA_PER_MAG` | 0.08 | 住宅は道路より効率が悪いが幸福が上がる。選択の余地を作る |
| `HOUSING_HAPPINESS_PER_MAG` | 0.03 | 規模50で幸福+1.5 |
| `HOUSING_COST_PER_MAG` | 3 | 規模50で150 |
| `LEVY_PER_CAPITA_PER_MAG` | 0.03 | 人口120・規模50で+180。即効性はあるが… |
| `LEVY_HAPPINESS_PER_MAG` | 0.2 | …幸福-10。連発すると人口流出に転じる |
| `RELIEF_HAPPINESS_PER_MAG` | 0.1 | 減税は徴税より幸福効率が悪い（取るのは簡単、喜ばせるのは難しい） |
| `INVEST_HAPPINESS_PER_MAG` | 0.15 | 規模50で幸福+7.5 |
| `INVEST_HAPPINESS_COST_PER_MAG` | 3 | 規模50で150 |
| `INVEST_POPULATION_PER_MAG` | 0.15 | 規模50で+7人。容量の上限には勝てない（直接人口を買う抜け道を抑える） |
| `INVEST_POPULATION_COST_PER_MAG` | 3 | 規模50で150 |
| `REFORM_CORRUPTION_PER_MAG` | 0.1 | 規模50で汚職-5 |
| `REFORM_CORRUPTION_COST_PER_MAG` | 2 | 規模50で100 |
| `REFORM_CORRUPTION_HAPPINESS_PER_MAG` | 0.03 | 綱紀粛正は少し嫌われる（規模50で-1.5） |
| `REFORM_HAPPINESS_PER_MAG` | 0.1 | 恩赦は invest より安いが効果も小さい |
| `REFORM_HAPPINESS_COST_PER_MAG` | 2 | 同上 |

### 3.1 `budget` の扱い
LLM 出力の `budget` は**上限**としてのみ使う：`budget > 0 && budget < cost` なら効果とコストを `budget / cost` 倍に縮小。コスト計算自体は上表の式で行う。根拠：LLM が出した金額をそのまま国庫から引くと、数値更新を LLM に委ねることになる（CLAUDE.md §4-2）。DECISIONS D-08。

### 3.2 `confidence` の扱い
`confidence < LOW_CONFIDENCE_THRESHOLD`（**0.3**）なら no-op＋「意味が取れなかった」。根拠：テンプレートパーサーのフォールバックが「何もマッチしなかった」ときに返す値と揃える。DECISIONS D-09。

---

## 4. 側近による歪み（SPEC §6.4）

### 4.1 担当側近の選択（DECISIONS D-06）
1. `target`（と `action=tax`）に専門が一致する側近を優先。
2. 同点なら信頼関係が高い側近。さらに同点なら在任が長い側近。
3. 側近0人なら勅令は実行されない（政治資本も国庫も消費しない）。自然変化だけ進む。

**専門一致表**（`SPECIALTY_TARGETS`）

| 専門 | 一致する target / action |
|------|--------------------------|
| インフラ | infrastructure, road, housing, office |
| 経済 | treasury, corruption, および action=tax |
| 治安 | happiness, population |
| 環境 | （P0 では一致なし） |

根拠：初期側近 A=インフラ、B=経済で、建設系は A、税・汚職は B に自然に振り分けられ、プレイヤーが「誰に渡るか」を予測できる。

### 4.2 解釈精度（SPEC §7.6）

```
accuracy = clamp(
    ACCURACY_BASE
  + ability / ACCURACY_ABILITY_DIVISOR
  + (specialtyMatch ? ACCURACY_SPECIALTY_BONUS : 0)
  + (trust >= ACCURACY_TRUST_THRESHOLD ? ACCURACY_TRUST_BONUS : 0)
  - (ambition >= ACCURACY_AMBITION_THRESHOLD && factionConflict ? ACCURACY_AMBITION_PENALTY : 0),
  0, 1)
```

| 定数 | 値 | 根拠 |
|------|----|------|
| `ACCURACY_BASE` | 0.3 | SPEC §7.6 |
| `ACCURACY_ABILITY_DIVISOR` | 200 | SPEC §7.6 |
| `ACCURACY_SPECIALTY_BONUS` | 0.2 | SPEC §7.6 |
| `ACCURACY_TRUST_THRESHOLD` | 70（`>=`） | SPEC は `> 70`。初期の側近A（信頼70）がちょうど対象外になるため `>=` を提案（DECISIONS D-07） |
| `ACCURACY_TRUST_BONUS` | 0.1 | SPEC §7.6 |
| `ACCURACY_AMBITION_THRESHOLD` | 70（`>=`） | SPEC は `> 70`。初期の側近B（野心70）がちょうど対象外になるため `>=` を提案（D-07） |
| `ACCURACY_AMBITION_PENALTY` | 0.2 | SPEC §7.6 |

参考（`>=` 採用時）：A が建設を担当 → 0.9、A が専門外 → 0.7、B が徴税（派閥対立あり） → 0.675、B が専門外 → 0.675。

### 4.3 派閥対立（`FACTION_CONFLICTS`）

| 派閥 | 対立する勅令 | 根拠 |
|------|--------------|------|
| 開発 | build/invest の m<0、tax の m<0（減税＝開発財源の減少） | 開発派は財源と事業の縮小を嫌う |
| 商業 | tax の m>0、reform×corruption | 商人は増税と綱紀粛正（既得権の締め付け）を嫌う |
| 保守 | build の m>60（急な大事業） | 変化を嫌う。P0 の任命候補でのみ登場 |
| 軍事 | invest×happiness、reform×happiness | 民への施しを嫌う。候補でのみ登場 |
| 環境 | build×road, build×infrastructure の m>0 | 開発を嫌う。候補でのみ登場 |

### 4.4 歪みの判定（この順に独立判定）

| 歪み | 発生条件 | 確率 | 効果 | 定数 |
|------|----------|------|------|------|
| 規模の誤読 | 常に判定 | `(1 - accuracy) * MISREAD_CHANCE_SCALE` | `m *= 1 ± randRange(MISREAD_MIN, MISREAD_MAX)`（符号は等確率） | `MISREAD_CHANCE_SCALE=1.0`, `MISREAD_MIN=0.3`, `MISREAD_MAX=0.5` |
| 対象の取り違え | 専門外のときのみ | `(1 - accuracy) * TARGET_SWAP_CHANCE_SCALE` | 同じ action の有効 target から、元以外を一様に選ぶ | `TARGET_SWAP_CHANCE_SCALE=0.5` |
| 骨抜き | 派閥対立のときのみ | `WATER_DOWN_BASE_CHANCE + (100 - loyalty) / WATER_DOWN_LOYALTY_DIVISOR` | 効果量 ×`WATER_DOWN_EFFECT_FACTOR`、**コストは減らない** | `WATER_DOWN_BASE_CHANCE=0.4`, `WATER_DOWN_LOYALTY_DIVISOR=200`, `WATER_DOWN_EFFECT_FACTOR=0.5` |
| 隠蔽 | `ambition >= CONCEAL_AMBITION_MIN` かつ `loyalty <= CONCEAL_LOYALTY_MAX` | `CONCEAL_BASE_CHANCE + (ambition - loyalty) / CONCEAL_DIVISOR` | そのターンの側近報告から**悪化した項目**を消す（状態は変えない） | `CONCEAL_AMBITION_MIN=60`, `CONCEAL_LOYALTY_MAX=60`, `CONCEAL_BASE_CHANCE=0.3`, `CONCEAL_DIVISOR=100` |
| 横領 | 町以降 | — | **P0 では発生しない**（村に官僚がいないため。汚職は §2.3 の税収目減りで表現） | — |

根拠（1行ずつ）：
- 誤読：SPEC「±30〜50%」をそのまま一様分布に。精度0.9でも1割で発生し、「優秀でも完璧ではない」。
- 取り違え：専門外のみ・誤読の半分の頻度。頻発すると理不尽（SPEC §9.3-3）なので抑えめ。
- 骨抜き：忠誠80で50%、忠誠60で60%。「コストは払ったのに中身が半分」が空洞（§6）と新聞の「立派な工事」記事の乖離を生む。
- 隠蔽：初期 B（野心70・忠誠60）で40%、A は条件外。報告の信頼性に側近差をつける。

### 4.5 報告の欠落（能力・信頼による）

| 定数 | 値 | 効果 | 根拠 |
|------|----|------|------|
| `REPORT_OMIT_CHANCE_DIVISOR` | 400 | 各報告項目が `(100 - ability) / 400` で欠落（能力60で10%） | SPEC §5.2「能力が低いと見落とし」 |
| `REPORT_LOW_TRUST_THRESHOLD` | 40 | 信頼がこれ未満なら報告項目数を `REPORT_LOW_TRUST_MAX_ITEMS` に制限 | SPEC §5.2「信頼が低いと報告が減る」 |
| `REPORT_LOW_TRUST_MAX_ITEMS` | 2 | 同上 | 情報が減るが、ゼロにはしない |

### 4.6 試算で分かったこと
歪みを全て無効にしてもランダム勅令の到達率は 33%→36% 程度しか変わらない。歪みは**到達率よりも「意図と結果のズレ」に効く**設計になっている。歪みを主要な難度レバーにしたい場合は、骨抜きのコスト据え置きや誤読幅を強める必要がある（P1 の sim で再検証）。

---

## 5. 役所

| 定数 | 値 | 根拠 |
|------|----|------|
| `OFFICE_COST` | 400 | 約3年分の税収。目標直前に「貯める」判断を強いる |
| `OFFICE_MIN_POPULATION` | 200 | 人口が育つ前に建ててしまう早期決着を防ぐ |
| `OFFICE_MIN_INFRASTRUCTURE` | 15 | 同上。道路が通っていない村に役所は建たない |
| 不成立時 | 国庫・効果とも変化なし（政治資本と `DECREE_BASE_COST` は消費）。側近報告で「条件を満たさない」と理由を返す | 条件をプレイヤーに学ばせる |
| 予算不足時 | 縮小せず不成立 | 「半分の役所」は意味をなさない |
| 建設後 | `OFFICE_UPKEEP`（§2.3）。地図に役所1区画 | SPEC §8.2 |

---

## 6. 地図・見た目と実態

| 定数 | 値 | 根拠 |
|------|----|------|
| `GRID_SIZE` | 10 | SPEC §8.2 |
| `RESIDENTS_PER_HOUSING_TILE` | 20 | SPEC §8.2 `floor(人口/20)` |
| `INFRA_PER_ROAD_TILE` | 5 | SPEC §8.2 `floor(インフラ/5)` |
| `MIN_EMPTY_TILES` | 10 | SPEC「空き地は常に一定数確保」。超過分の住宅は描かない（人口は減らない） |
| 配置順 | 中心(4,4)から時計回りの螺旋順に、役所→道路→住宅→空き地 | 決定論的・seed 不要。「中心から広がる村」に見える |
| 空洞 | 骨抜きされた build/housing の「失われた効果量」を `hollowInfrastructure` として記録。見た目の道路数は `floor((infrastructure + hollow)/5)` | `visual_state` と `actual_state` の乖離を、骨抜きから自然に生む |
| `HOLLOW_DECAY_PER_TURN` | 1 | 空洞は年1ずつ解消（見かけ倒しも崩れていく） |
| `HOLLOW_DISCLOSE_ABILITY_MIN` | 70 | 能力70以上の側近は空洞を報告で開示し、亀裂アイコンが付く（SPEC §12.7） |

---

## 7. 新聞（偏向度30）

| 定数 | 値 | 根拠 |
|------|----|------|
| `NEWSPAPER_BIAS` | 30 | SPEC §4.1 |
| `NEWSPAPER_NOISE_RATIO` | `NEWSPAPER_BIAS / 100`（=0.3） | 報告数値 = 実数値 × `(1 + randRange(-0.3, 0.3))`。CLAUDE.md §6 #9 |
| `NEWSPAPER_TONE` | `"progovernment"` | 偏向の向き：悪化は控えめな語、改善は誇張した語を選ぶ（論調語テーブルは i18n）。ノイズは対称、論調だけ偏る |
| `NEWSPAPER_TONE_CHANCE` | 0.3（=BIAS/100） | 各記事で論調語が偏る確率 |

---

## 8. 意図達成ボーナス

| 定数 | 値 | 根拠 |
|------|----|------|
| `INTENT_BONUS_KIND` | `"politicalCapital"` | CLAUDE.md §6 #2。`"happiness"` に切替可能 |
| `INTENT_BONUS_POLITICAL_CAPITAL` | 1 | SPEC §6.2 |
| `INTENT_BONUS_HAPPINESS` | 5 | SPEC §6.2 |

**注意**：政治資本が +3/ターン・上限10・消費1/ターンのままだと、政治資本はほぼ常に余り、ボーナス+1 の価値がゼロに近い（DECISIONS D-01, D-02）。

---

## 9. 試算結果（2026-10-24、使い捨てスクリプト、各2000本）

本書の値で、意図宣言・新聞・報告の不確かさは含めず（ルールエンジンのみ）に試算した。

| 方策 | 到達 | ゲームオーバー | 時間切れ | 平均到達ターン |
|------|------|----------------|----------|----------------|
| ランダム勅令（有効な action×target から一様、規模10〜100、15%で負） | **33%** | **36%** | 32% | 36.6 |
| 半合理（50%ランダム／50%ヒューリスティック） | 87% | 8% | 5% | 31.3 |
| ヒューリスティック（真値を見て最善手） | 100% | 0% | 0% | 24.3 |

- ランダム勅令は目標帯（到達30〜50%、GO 20〜40%）に入った。
- **ゲームオーバーのほぼ全てが財政破綻**。人口壊滅・民衆離反はほぼ起きない（0.1%）。3種の終わり方を体験させたいなら、徴税の幸福ペナルティ強化か幸福度の減衰を強める必要がある（DECISIONS D-20）。
- 真値が見えるヒューリスティックは全員到達する。実プレイでは新聞ノイズ・隠蔽・欠落・LLM の解釈揺れがあるので下がるはずだが、**人間の到達率がランダム方策より高くなるのは確実**。「`pnpm sim` のランダム勅令で30〜50%」と「テスターで30〜50%」は別物として扱う必要がある（DECISIONS D-19）。

## 10. 定数一覧（constants.ts 転記用）

```
INITIAL_POPULATION=120  INITIAL_TREASURY=500  INITIAL_HAPPINESS=50  INITIAL_INFRASTRUCTURE=10  INITIAL_CORRUPTION=5
INITIAL_POLITICAL_CAPITAL=3  POLITICAL_CAPITAL_INCOME=3  POLITICAL_CAPITAL_MAX=10
DECREE_POLITICAL_COST=1  APPOINT_POLITICAL_COST=1  DECREE_BASE_COST=10  MAX_TURNS=50
DECREE_CHAR_LIMIT=40  TAG_CHAR_COST=5
HOUSING_BASE_CAPACITY=100  HOUSING_CAPACITY_PER_INFRA=10
HAPPINESS_GROWTH_THRESHOLD=50  POPULATION_GROWTH_BASE=0.025  POPULATION_GROWTH_PER_HAPPINESS=0.002
POPULATION_OUTFLOW_PER_HAPPINESS=0.004  OVERCROWD_OUTFLOW_RATE=0.3
TAX_PER_CAPITA=1.2  INFRA_UPKEEP_PER_POINT=1.5  AIDE_SALARY=15  OFFICE_UPKEEP=20
HAPPINESS_EQUILIBRIUM_BASE=48  HAPPINESS_PER_INFRA=0.4  HAPPINESS_PENALTY_PER_CORRUPTION=0.2
CROWDING_RATIO=0.9  CROWDING_PENALTY=30  HAPPINESS_REVERT_RATE=0.1
INFRA_DECAY_CHANCE=0.3  INFRA_DECAY_AMOUNT=1  CORRUPTION_DRIFT_PER_TURN=0.3
BUILD_INFRA_PER_MAG=0.12  BUILD_COST_PER_MAG=4  HOUSING_INFRA_PER_MAG=0.08  HOUSING_HAPPINESS_PER_MAG=0.03  HOUSING_COST_PER_MAG=3
LEVY_PER_CAPITA_PER_MAG=0.03  LEVY_HAPPINESS_PER_MAG=0.2  RELIEF_HAPPINESS_PER_MAG=0.1
INVEST_HAPPINESS_PER_MAG=0.15  INVEST_HAPPINESS_COST_PER_MAG=3  INVEST_POPULATION_PER_MAG=0.15  INVEST_POPULATION_COST_PER_MAG=3
REFORM_CORRUPTION_PER_MAG=0.1  REFORM_CORRUPTION_COST_PER_MAG=2  REFORM_CORRUPTION_HAPPINESS_PER_MAG=0.03
REFORM_HAPPINESS_PER_MAG=0.1  REFORM_HAPPINESS_COST_PER_MAG=2
LOW_CONFIDENCE_THRESHOLD=0.3
ACCURACY_BASE=0.3  ACCURACY_ABILITY_DIVISOR=200  ACCURACY_SPECIALTY_BONUS=0.2  ACCURACY_TRUST_THRESHOLD=70  ACCURACY_TRUST_BONUS=0.1
ACCURACY_AMBITION_THRESHOLD=70  ACCURACY_AMBITION_PENALTY=0.2
MISREAD_CHANCE_SCALE=1.0  MISREAD_MIN=0.3  MISREAD_MAX=0.5  TARGET_SWAP_CHANCE_SCALE=0.5
WATER_DOWN_BASE_CHANCE=0.4  WATER_DOWN_LOYALTY_DIVISOR=200  WATER_DOWN_EFFECT_FACTOR=0.5
CONCEAL_AMBITION_MIN=60  CONCEAL_LOYALTY_MAX=60  CONCEAL_BASE_CHANCE=0.3  CONCEAL_DIVISOR=100
REPORT_OMIT_CHANCE_DIVISOR=400  REPORT_LOW_TRUST_THRESHOLD=40  REPORT_LOW_TRUST_MAX_ITEMS=2
OFFICE_COST=400  OFFICE_MIN_POPULATION=200  OFFICE_MIN_INFRASTRUCTURE=15
GRID_SIZE=10  RESIDENTS_PER_HOUSING_TILE=20  INFRA_PER_ROAD_TILE=5  MIN_EMPTY_TILES=10
HOLLOW_DECAY_PER_TURN=1  HOLLOW_DISCLOSE_ABILITY_MIN=70
NEWSPAPER_BIAS=30  NEWSPAPER_TONE_CHANCE=0.3
INTENT_BONUS_POLITICAL_CAPITAL=1  INTENT_BONUS_HAPPINESS=5
SUCCESS_POPULATION=300  SUCCESS_INFRASTRUCTURE=25
LLM_TIMEOUT_MS=5000  LLM_MAX_RETRIES=2  LLM_BACKOFF_BASE_MS=500  LLM_TEMPERATURE=0.2
```
