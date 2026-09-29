# 當沖水源與 Mother Pool 最新完整運作流程

版本日期：2026-09-09  
時區：Asia/Taipei  
正式契約：`Mother Pool v4.1.0`  
正式根目錄：`C:\fuman-release-owner\fuman-terminal`  
Production：`C:\fuman-release-owner\prod81`  
Runtime：`C:\fuman-runtime`  
文件狀態：`PRODUCTION_CONTRACT_WITH_EXPLICIT_PENDING_NATURAL_EVIDENCE`

## 0. 本版核心結論

1. Mother Pool 是台股當沖共用水源與候選發現層，不是任何下游策略的進場決策器。
2. 唯一正式成員入口為 `public.v_fugle_daytrade_mother_pool_v4_1`，只接受 `contract_version=4.1.0`。
3. 06:00 將全終端有效台股聯集直接列為暖機入池來源；不是把全台所有普通股無條件入池，檔數不得寫死。
4. 2026-09-09 同日 v4.1 實際完整讀回為 720 檔；先前 467 檔只是當時的終端快照，不是永久上限。
5. 權證與可轉債已剔除；不得由舊 cache、bridge、underlying mapping 或相容欄位復活。
6. Mother Pool／Gate 的正式移動平均欄位只保留 `MA3、MA5、MA10、MA20`，短均線排列只使用 `MA5 > MA10 > MA20`。
7. 一分 K 是正式盤中水源；五分 K 是下游轉強確認，不得反向刪除 Mother Pool 成員。
8. 正式完成必須是 `runner → canonical readback → verifier → receipt`；檔案存在不等於 complete。
9. 單檔資料缺口只隔離該檔，不得連帶擋住其他有效標的；全域 Gate 失敗才阻擋整批發布。
10. LINE、Telegram、終端排版與下游進場通知不屬於 Mother Pool 的策略責任；通知結果不得反向改寫母池。

## 1. 責任邊界

Mother Pool 負責：

- 同步與驗證上市、上櫃股票主檔。
- 建立 06:00 全終端有效台股暖機聯集。
- 維護唯一 Fugle WebSocket collector 與 Writer。
- 寫入同交易日 quote、一分 K、盤前快照、Mother Pool 與必要 readback。
- 執行商品資格、熱門排行、量價、細產業、內外盤與動態分層。
- 產生 runner、verifier、receipt 閉環證據。
- 提供其他電腦與策略唯讀使用。

Mother Pool 不負責：

- 海外市場行情、海外休市或晨報海外產業計算。
- Strategy 2／3／4／5、買賣超及其他策略的正式進場決策。
- 自動下單。
- LINE／Telegram 的訊息格式、推播與 delivery receipt。
- 以正式候選或通知結果反向修改 Mother Pool。

## 2. 唯一 Release Owner

Mother Pool Codex 是 Fuman Terminal 唯一 Release Owner，唯一可執行：

- 合併或推送 `main`。
- 更新 `approvedProductionSha`。
- 切換 `prod81`。
- 修改正式 runtime、Writer 與 Windows schedules。
- 完成正式 runner＋verifier＋receipt 發布閉環。

其他 Codex 只能提交獨立 worktree／branch／PR 與固定 commit SHA。整合前必須先核對：

```text
main HEAD
origin/main HEAD
approvedProductionSha
prod81 HEAD
source/prod81 dirty status
```

不得覆寫或夾帶其他工單的 dirty files。

## 3. 交易日與同輪身分

正式交易日入口：

```text
public.market_calendar
```

核心身分：

```text
trade_date=YYYY-MM-DD（Asia/Taipei）
canonical_run_id=fugle_daytrade_source:YYYYMMDD:canonical
contract_version=4.1.0
source_freshness=same_trade_date_current
writer_run_id=<writer-host>:daytrade-writer:<date>:<unique-id>
generation_id=writer_run_id
```

週末或官方休市應正常回傳 `skipped/market_closed`、`exit_code=0`、零正式副作用。previous-good 可以保存，但不得宣稱為今日資料。

## 4. 正式排程

| 時間 | 工作 | 定位 |
| --- | --- | --- |
| 06:00 | WebSocket、Writer 與全終端聯集暖機入池 | 水源／無進場權限 |
| 06:00～13:30 | Source Writer 每分鐘自然執行 | canonical 水源 |
| 07:00 | Source Gate、連線、驗證、heartbeat | 水源健康 |
| 08:20～08:30 | 唯讀接收晨報台股優先觀察 | 暖機優先權 |
| 08:35 | 股期 collector recovery guard | 水源恢復 |
| 08:45～08:59 | 盤前 WebSocket snapshot 每分鐘寫入 | 盤前自然證據 |
| 08:45／08:50／08:55／08:59 | 股期／試撮正式自然時槽 | 盤前證據 |
| 09:00 | 啟動台股全市場細產業與動態 Mother Pool | discovery |
| 09:00～13:30 | quote、一分 K、排行、產業、內外盤、分層 | 盤中偵測 |
| 每 5 分鐘 | 五分 K runner＋verifier＋history verifier＋receipt | 下游轉強證據 |
| 13:30 後 | 停止新增盤中候選，寫入 off-session 狀態 | 盤後收斂 |

Windows 工作均使用 `IgnoreNew`；不得因重疊而自動重啟或產生兩個 Writer。五分 K 單輪上限為 4 分鐘。

## 4.1 一眼看懂：盤前暖機與盤中偵測

### A. 盤前暖機清單（06:00～08:59）

| 時間／階段 | 暖機或偵測內容 | 正式來源 | 結果／用途 |
| --- | --- | --- | --- |
| 06:00 | 台股交易日、週末及休市辨識 | `public.market_calendar` | 建立今日身分；非交易日正常早退且不覆寫 previous-good |
| 06:00 | `trade_date`、`canonical_run_id`、`writer_run_id`、`generation_id`、Writer lease | canonical Source Writer | 鎖定同日同輪，排除跨日、舊 run 與舊 latest pointer |
| 06:00 | 上市／上櫃股票主檔、四碼普通股與交易資格 | MOPS、`stock_tickers`、`stock_universe` | 排除 ETF、權證、可轉債、特別股及無效商品 |
| 06:00 | Strategy 2／3 V2／4／5、買賣超、`/88`、追蹤及有效觀察清單聯集 | 全終端正式輸出 | 以 `trade_date + symbol` 去重後直接暖機入池 |
| 06:00 | 成交量、成交值、漲幅、振幅、周轉率排行榜前段 | 正式排行水源 | 補入熱門股並寫明來源與優先原因 |
| 06:00 | 近日強勢、五日緩漲、短均線多頭及個股期貨標的 | 正式歷史／策略水源 | 補入 priority discovery |
| 06:00～ | Fugle WebSocket 連線、認證、訂閱與 heartbeat | `trades`、`aggregates`、`candles` | 建立即時 quote、一分 K及 transport 健康證據 |
| 06:00～ | 日 K、昨收、前日 OHLC、3／5日均量、振幅與周轉率基線 | 正式 daily OHLC／volume | 歷史不足標記 `history_pending`／`DATA_GAP` |
| 06:00～ | MA3、MA5、MA10、MA20、KD、MACD、RSI及量能趨勢 | 正式歷史 K線 | 只作暖機與 priority 證據；短均線方向為 `MA5 > MA10 > MA20` |
| 08:20 | 海外15產業凍結、日期及休市檢查 | 晨報 runner | 由晨報負責，Mother Pool 不重算海外排名 |
| 08:30 | 海外 Top 3及對應台股優先觀察股交接 | 今日 Top 3 Bridge | 驗證同日交接後加入 Mother Pool並提高優先度 |
| 08:45／08:50／08:55／08:59 | 台股自然試撮、參考價、委買賣及股期證據 | Fugle preopen／股期 collector | 不得用09:00後資料回填；缺口採 `safe_degraded` |
| 08:59 | 暖機 runner＋readback＋verifier＋receipt | canonical 水源 | 驗證全終端入池、來源歸因、WebSocket及同輪身分 |

盤前暖機的目的，是把今日需要監控的股票與計算基線準備完整；入池不等於正式進場，也不因盤前沒有新成交就判定斷線。

### B. 盤中偵測清單（09:00～13:30）

| 偵測項目 | 每輪檢查內容 | 成立後動作 | 缺口處理 |
| --- | --- | --- | --- |
| 全市場行情 | 最新價、開高低、漲幅、成交量、成交值、事件時間與接收時間 | 更新 quote 與盤中排行 | 有事件未更新才是 `DATA_GAP_QUOTE`；無新成交可為 `NO_NEW_MARKET_EVENT` |
| 一分 K | 同日非 synthetic OHLCV、最新時間、量能可用性 | 更新技術、量價與產業計算 | 過期或不可用為 `DATA_GAP_1M` |
| 五分 K增強 | 由同日一分 K自然聚合，檢查完整 bar 與轉強訊號 | 標記五分 K增強，供下游確認 | 未完成為 `pending`；缺資料為 `DATA_GAP_5M` |
| 台股細產業 Top 3 | 資金持續流入、量／值放大、平均及中位漲幅延續、多檔同向 | 選出合格成分股並同輪快速注入 Mother Pool | 缺少基準或廣度不得成立 |
| 產業突然流入 | 資金相對前輪跳升、成交量同步放大、成分股漲幅延續 | 同輪快注入並在下一輪高頻掃描 | 不得以單一股票異常成交代替產業訊號 |
| 個股量價 | 漲幅延續、相對量能、成交值、突破日內高點、振幅與周轉率 | 提升 `priority/hot/deep_scan` | stale quote或 synthetic K線逐檔隔離 |
| 技術方向 | MA3／5／10／20、`MA5 > MA10 > MA20`、KD、MACD、RSI、突破／回踩 | 作 discovery、排序及增強證據 | 舊值不得補成 PASS；技術條件不單獨形成進場 |
| 熱門排行榜 | 成交量、成交值、漲幅、振幅、周轉率、相對量能 | 排行前段提升掃描優先度 | 排名不得取代資料品質 Gate |
| 內外盤 | `inside_volume`、`outside_volume`、合計、比例與同日來源 | 分成達2,000張／未達門檻並保存 readback | 不得以 `total_volume` 代替；缺資料為 `DATA_GAP_SIDE_VOLUME` |
| 外盤強勢雷達 | 外內盤比至少2倍、合計至少2,000張、資料120秒內、今日母池成員 | 輸出雷達事件並提升 `priority/hot`；通知端可據此推播 | 四項缺一不得建立事件或通知 |
| 動態 Mother Pool | 新策略命中、晨報優先、排行、產業、量價與外盤訊號 | 同輪新增／升級，保留 source flags及run id | 降級或移出只改動態層，不刪稽核歷史 |
| Formal Gate | transport、同日同run、quote覆蓋、一分 K、歷史基線、來源及lease | 決定是否建立下游正式候選 | 產業成立、入池或雷達通知均不等於 Gate 放行 |
| 每輪閉環 | Runner寫入、canonical readback、Verifier、Receipt | `failed_checks=[]`且`first_blocker=null`才完成 | 零事件可以complete，但必須證明完整掃描已執行 |

盤中每輪的核心順序為：

```text
更新全市場行情與一分 K
→ 重算排行榜及台股細產業
→ 偵測 Top 3／突然流入／個股量價／外盤強勢
→ 合格標的同輪注入或提高優先度
→ 更新 mother／priority／hot／deep_scan
→ canonical readback
→ verifier
→ receipt
```

## 5. 股票主檔

權威來源：`MOPS_OPEN_DATA_TWSE_TPEX`。

正式鏈：

```text
lib/stock-master-sync.js
→ scripts/run-stock-master-sync.js
→ scripts/verify-stock-master-sync.js
→ stock-master-sync runner/verifier/wrapper receipts
```

規則：

- 官方四碼普通股先完整寫入 `stock_tickers` 與 `stock_universe`。
- 黑名單、停牌與當沖不適合只影響掃描資格，不得從官方主檔刪除。
- ETF、權證、可轉債、特別股及無效商品不得進入正式當沖聯集。
- Source Writer 每日先驗 stock-master receipt；不完整時 fail-closed。

## 6. 06:00 盤前暖機入池

以 `trade_date + symbol` 去重，來源至少包含：

- Strategy 2、Strategy 3 V2、Strategy 4、Strategy 5 的有效台股。
- 買賣超有效台股。
- `/88`、使用者追蹤及未失效正式觀察清單。
- 成交量、成交值、漲幅、振幅與周轉率排行榜前段。
- 近日強勢、均線多頭、五日緩漲及個股期貨標的。
- 晨報交付的台股優先觀察。

每檔必須保留：

```text
trade_date
symbol
source_flags[]
source_run_ids[]
priority_reasons[]
source_updated_at
source_freshness
canonical_run_id
contract_version
```

06:00 入池只表示具備暖機與盤中追蹤資格，不等於正式進場候選。

### 6.1 盤前暖機實際偵測細項

06:00～08:59 必須依下列順序完成，不得只產生一份 symbol 清單：

#### A. 交易日與執行身分

- 讀取 `public.market_calendar`，確認 TW、今日交易日及 `is_open=true`。
- 建立今日唯一 `canonical_run_id`、`writer_run_id` 與 `generation_id`。
- 週末或休市正常早退；不得啟動今日正式候選、副作用或通知。

#### B. 股票主檔與商品資格

- 驗證 MOPS 上市／上櫃官方主檔同步 receipt。
- 驗證 `stock_tickers`、`stock_universe` 與 WebSocket active universe 對帳。
- 保留官方四碼普通股；排除 ETF、權證、可轉債、特別股、無效或不可交易商品。
- 黑名單、停牌與當沖不適合只標記掃描資格，不從官方主檔刪除。

#### C. 全終端聯集入池

- 收集 Strategy 2／3 V2／4／5、買賣超、`/88`、追蹤清單與未失效觀察名單。
- 收集成交量、成交值、漲幅、振幅與周轉率排行榜前段。
- 收集近日強勢、五日緩漲、短均線多頭及個股期貨標的。
- 08:30 後合併晨報交付的台股優先觀察。
- 以 `trade_date + symbol` 去重後直接成為暖機 Mother Pool 成員；不設固定 467、600 或 Top 40 上限。
- 每一來源都要寫入 `source_flags[]`、`source_run_ids[]` 與 `priority_reasons[]`，不得只保留最後一個來源。

#### D. WebSocket 與行情暖機

- 啟動唯一 Fugle collector，確認 authenticated、connected、formalReady。
- 確認 `trades`、`aggregates`、`candles` 三頻道都在工作。
- 為入池標的建立 quote 訂閱、最新成交、aggregate、日內高低價、成交量與成交值基線。
- 無新成交但 heartbeat／aggregate 健康者標記 `NO_NEW_MARKET_EVENT`，不列 Writer 錯誤。
- 有市場事件但 quote 未更新者逐檔標記 `DATA_GAP_QUOTE`。

#### E. 一分 K 水源準備

- 確認今日非 synthetic 一分 K 可讀，並保留 OHLCV、事件時間及 `volume_strategy_usable`。
- 一分 K不足時標記 `DATA_GAP_1M`；不得用昨日 K線補今日暖機。
- 盤前不要求先計算完整五分 K訊號。
- 只準備 Mother Pool 共用的 MA5、MA10、MA20 所需資料；五分 K由獨立 Writer 在自然時段計算。

#### F. 前日基準資料

- 從完整 daily OHLC 取得前一正式交易日 high、low、close 與成交量基準。
- 取得日均量、近日量價、五日緩漲、振幅及周轉率所需歷史值。
- 缺少前日 OHLC 時逐檔標記 `DATA_GAP_PREVIOUS_SESSION_OHLC`，不得從 bounded 分鐘 K推算為 PASS。

#### F1. 技術與量能基線

- 以正式歷史資料建立 MA3、MA5、MA10、MA20、KD、MACD、RSI、近期高低點與量能趨勢。
- 暖機辨識短均線方向、`MA5 > MA10 > MA20`、近日強勢與五日緩漲；這些只作 discovery／priority 證據，不單獨形成正式進場。
- 正式暖機與盤中只允許本契約列出的指標集合；未列入欄位不得查詢、映射或輸出。
- 樣本不足須標記 `history_pending` 或對應 `DATA_GAP`，不得以舊值補齊，也不得改寫成「沒有訊號」。

#### G. 盤前試撮與股期

- 08:45～08:59 保存自然 `trial_price`、`reference_price`、事件時間與當時可取得的委買賣簿。
- 08:45、08:50、08:55、08:59 四個正式時槽各自保存 receipt。
- 不得使用 09:00 後成交或 order book 回填盤前證據。
- 股期與試撮證據只增加觀察優先權，不單獨形成正式進場。

### 6.2 暖機完成條件

盤前暖機 receipt 至少必須證明：

```text
trading_day_verified=true
stock_master_complete=true
websocket_connected=true
websocket_authenticated=true
required_channels=trades,aggregates,candles
terminal_union_read_rows > 0
mother_pool_admitted_rows = terminal_union_unique_symbols
missing_source_attribution_rows=0
retired_warrant_rows=0
retired_cb_rows=0
same_trade_date=true
same_canonical_run_id=true
runner_ok=true
verifier_ok=true
failed_checks=[]
first_blocker=null
```

盤前個別行情缺口可以逐檔隔離，但股票主檔、交易日、canonical 身分或 WebSocket 共通水源失敗屬全域 blocker。

## 7. WebSocket 與即時行情

唯一正式 collector：

```text
scripts/fugle-websocket-collector.js
ops/public-slot/Run-DaytradeWebSocketCollector.ps1
```

必要頻道：

```text
trades
aggregates
candles
```

即時 quote：

```text
public.fugle_daytrade_quotes_live
```

新鮮度依三層判定：成交事件、aggregates 更新、WebSocket heartbeat。無新成交但通路健康可標示 `NO_NEW_MARKET_EVENT`，不得誤算 Writer 錯誤；有市場事件卻未同步才是 `DATA_GAP`。

## 8. 盤前 Snapshot

現股盤前來源以 WebSocket 試撮事件為準。正式寫入：

```text
public.fugle_preopen_snapshot
public.fugle_preopen_snapshot_history
```

每筆至少保存交易日、symbol、自然事件時間、trial price、reference price、來源與品質狀態。不得用 09:00 後 order book 冒充盤前簿。

2026-09-09 歷史證據：482 檔試撮價／參考價已回補；原始盤前委買賣簿未保存，因此 482 檔維持 `DATA_GAP_UNRECOVERABLE`。自然同步 Task 已安裝，下一交易日 08:45～08:59 驗收。

## 9. 一分 K

正式 RPC：

```text
public.get_fugle_daytrade_intraday_1m_latest_n
```

每根至少包含：

```text
trade_date, symbol, candle_time
open, high, low, close, volume
synthetic, volume_strategy_usable, updated_at
```

只接受同交易日且 `synthetic=false`。`volume_strategy_usable=null/false` 必須逐檔 `DATA_GAP`，不可預設 true。

## 10. 五分 K

五分 K由獨立 Writer 自一分 K計算，只作轉強確認：

```text
scripts/run-daytrade-intraday-5m-writer.js
→ scripts/verify-daytrade-intraday-5m-readback.js
→ scripts/verify-daytrade-intraday-5m-history.js
→ public.v_fugle_intraday_5m_verification_readback
```

盤前只建立歷史基線；當日五分 K 必須由開盤後同日、非 synthetic 的一分 K自然聚合，不得盤前捏造。每根須保存 OHLCV、bar 起訖時間、完整性、收盤特殊 bar、`data_gap_5m` 與 `confirmation_eligible`；未完成的 bar 為 `pending`。

允許的轉強證據：

```text
RSI3 cross RSI6
KD(5,3,3) golden cross
MA5 cross MA10
MA10 cross MA20
MA5 cross MA20
```

即時 cache 只保證目前 run；指定舊 run 的 replay 必須讀 `public.v_fugle_intraday_5m_history_readback`。

目前已完成隔離歷史 replay，但 720 檔自然全輪仍需在下一交易時段證明能於 4 分鐘內完成，不得提前標成完整自然閉環。

## 11. 盤中細產業偵測

09:00 後使用台股當日資料計算，不使用海外晨報結果取代台股排名。偵測兩類事件：

1. 台灣全市場細產業排名前三名，資金持續流入、成交量放大且成分股漲幅持續上升。
2. 任何細產業盤中突然大筆資金流入、成交量放大且成分股漲幅持續上升。

產業成立後，同一輪將合格成分股快速注入 Mother Pool，保留產業名稱、事件時間、注入原因與同輪 run id。不得等下一輪才入池。

### 11.1 每分鐘偵測順序

09:00～13:30 每一輪依序執行：

```text
交易日／canonical 身分檢查
→ WebSocket 通路健康與事件時間檢查
→ 更新全市場 quote、成交量、成交值與一分 K
→ 重新計算全市場細產業統計
→ 偵測前三名持續流入及突然大筆流入
→ 驗證產業成交量放大與成分股漲幅延續
→ 選出產業內合格股票
→ 同輪快速注入 Mother Pool
→ 補齊被注入股票 quote／1分K／內外盤
→ 更新 mother／priority／hot／deep-scan 分層
→ canonical readback
→ verifier
→ receipt
```

### 11.2 全市場細產業統計

每個細產業至少彙總：

```text
industry_name
industry_rank
member_count
active_member_count
advancing_member_count
declining_member_count
average_change_percent
median_change_percent
industry_trade_value
industry_volume
relative_volume_ratio
capital_flow_estimate
capital_flow_rank
price_breadth
event_started_at
event_confirmed_at
source_updated_at
```

所有成分股必須是今日有效台股，且行情與產業 taxonomy 可追溯。不得用海外產業排名替代台股盤中排名。

### 11.3 類型一：前三名且持續流入

產業必須同時具備：

- 位於當輪台灣全市場細產業排名前三名。
- 資金流入為正，且相較前一輪沒有明顯反轉。
- 產業成交量或成交值相較基準放大。
- 產業平均／中位漲幅持續上升，不能只靠單一權值股拉動。
- 上漲家數與活躍家數具足夠廣度。
- 至少跨兩個自然輪次確認「持續」，單一瞬間尖峰只列 observation。

### 11.4 類型二：盤中突然大筆流入

不要求原本位居前三，但必須同時具備：

- 本輪資金流入相對前輪出現明顯跳升。
- 成交量／成交值同步放大，不接受只有價格跳動。
- 多檔成分股同步上漲，且漲幅在後續輪次未立即回吐。
- 事件時間、基準輪、確認輪與增量值均有保存。
- 缺少前輪基準或行情不同步時標記 `DATA_GAP_INDUSTRY_FLOW`，不得猜測突然流入。

### 11.5 產業股票的快速入池條件

產業成立後，不是把全部成分股無條件注入。每檔至少檢查：

- 今日可交易四碼普通股，且不屬於退役商品類型。
- quote 與產業事件為同一交易日、同一 canonical run。
- 成交量／成交值有實際放大或位於產業前段。
- 個股漲幅仍向上或維持產業同步方向。
- 非單筆異常成交、非 stale quote、非 synthetic candle。
- 保存 `industry_signal_fast_injected=true`、產業名稱、事件時間與注入理由。

符合者必須在產業確認的同一 Writer 輪寫入 Mother Pool 並立即 readback。若寫入成功但 readback 缺少，該檔為 `DATA_GAP_FAST_INJECT_READBACK`。

### 11.6 盤中個股偵測細項

對暖機成員與新注入成員持續偵測：

```text
最新價、開盤價、昨收、日內高低
漲幅及漲幅是否延續
成交量、成交值、相對量能
成交量／成交值／漲幅／振幅／周轉率排名
一分 K OHLCV 與 volume_strategy_usable
MA5、MA10、MA20 與 MA5 > MA10 > MA20
近日強勢、五日緩漲與個股期貨身分
inside_volume、outside_volume、side_volume_total
產業名稱、產業排名、產業資金與廣度
quote／1分K／產業事件的新鮮度
```

MA5 > MA10 > MA20 是短均線方向證據，不是單獨進場條件。

盤中技術重算範圍包含 MA3、MA5、MA10、MA20、KD、MACD、RSI、黃金交叉、突破／回踩、一分 K延續性與自然五分 K增強。任何必要資料不足均保留對應 `DATA_GAP`，禁止沿用舊輪值補成 PASS。

### 11.7 排行榜熱門股

盤中持續重排：

- 成交量排行榜。
- 成交值排行榜。
- 漲幅排行榜。
- 振幅排行榜。
- 周轉率排行榜。
- 相對量能排行榜。

排行榜前段股票可提升 priority 或進入 hot observation，但仍須通過商品、交易日、quote 與一分 K品質檢查。排行榜名次不能取代資料品質 Gate。

### 11.8 分層與更新

- `mother`：所有已入池且可追溯的 discovery 成員。
- `priority`：終端來源、晨報、排行、產業或內外盤條件提高處理優先權的成員。
- `hot`：當輪量價、漲幅、成交值或產業事件明顯加速的成員。
- `deep_scan`：需要補齊更多一分 K、五分 K或策略證據的輪轉集合。

各層是聯集／子池關係，不得把 `hot=0` 或 `deep_scan=0` 自動解讀為水源故障；必須以同輪成員集合及原因欄位判斷。

盤中可因晨報優先觀察、終端策略新命中、熱門排行、周轉率加速、產業排名／突然流入、量價同步、技術轉強或五分 K確認提高優先度。跨日、來源失效、商品／價格不合格、技術結構破壞、行情或 K線缺口、產業同步消失及觀察期限失效時可降低優先度或移出動態子池；稽核歷史與來源歸因不得刪除。

### 11.9 盤中逐檔狀態

```text
READY
NO_NEW_MARKET_EVENT
BELOW_THRESHOLD
DATA_GAP_QUOTE
DATA_GAP_1M
DATA_GAP_VOLUME_USABILITY
DATA_GAP_INDUSTRY_FLOW
DATA_GAP_SIDE_VOLUME
DATA_GAP_FAST_INJECT_READBACK
DIAGNOSTIC_ONLY
```

單檔狀態不得覆寫全域 receipt；其他 READY 標的仍可繼續供下游策略讀取。

### 11.10 盤中每輪 receipt 必備統計

```text
full_market_scanned_rows
mother_members
priority_members
hot_members
deep_scan_members
industry_ranked_count
top3_industries[]
sudden_inflow_industries[]
industry_fast_inject_count
industry_fast_inject_readback_count
quote_valid_rows
intraday_1m_valid_rows
no_new_market_event_rows
symbol_data_gap_rows
side_volume_ready_rows
side_volume_ge_2000_rows
outside_volume_radar_rows
outside_volume_radar_readback_rows
runner_started_at / runner_finished_at
canonical_run_id / writer_run_id / generation_id
verifier_ok / failed_checks[] / first_blocker
```

所有零值都必須來自實際完整掃描，不得用預設 0 代替未執行。

## 12. 內外盤

正式條件：

```text
side_volume_total = inside_volume + outside_volume
inside_volume + outside_volume >= 2000 lots
outside_volume >= inside_volume * 2
```

### 12.1 外盤強勢雷達

同一檔股票必須同時符合以下四項，才輸出外盤強勢雷達事件：

```text
outside_volume / inside_volume >= 2
side_volume_total >= 2000 lots
side-volume 事件與 quote 都是同交易日、同 canonical_run_id，且 age <= 120 秒
symbol 存在於今日 public.v_fugle_daytrade_mother_pool_v4_1
```

四項缺一不可。內盤為 0、外盤大於 0 時比例可視為無限大，但仍須通過 2,000 張、新鮮度與今日母池資格。缺資料標記 `DATA_GAP_SIDE_VOLUME`，不得用 `total_volume`、昨日累積值或 previous-good 替代。

Mother Pool 負責輸出雷達事件與完整來源證據；Telegram／其他接收端負責通知 delivery。雷達成立可提升 `priority/hot`，但不等於 Formal Gate 放行。

不得以 `total_volume` 替代內外盤。正式 readback：

```text
public.v_fugle_daytrade_side_volume_verification_readback
public.v_fugle_daytrade_side_volume_symbol_readback
```

逐檔狀態為 `READY_GE_2000_LOTS`、`READY_BELOW_2000_LOTS`、`DATA_GAP`、`DIAGNOSTIC_ONLY` 或 `BLOCKED_COMMON`。

2026-09-09 最新集合對帳：Mother Pool 720 檔；312 檔具完整內外盤，其中 167 檔達 2,000 張、145 檔低於門檻；408 檔逐檔隔離為 DATA_GAP。

## 13. Mother Pool 分層

正式流程：

```text
full-market discovery
→ mother pool
→ priority pool
→ hot pool
→ deep-scan pool
→ formal gate
→ downstream formal candidates
```

Mother Pool 是完整 discovery 集合；priority／hot／deep-scan 是運算優先層，不得把母池硬縮回舊 160 檔或 Top 40。Hot／Deep Scan 可以合法為零，但必須有同輪集合與原因證據，不能為湊數虛增。

## 14. 唯一正式 view 與讀取規則

```text
public.v_fugle_daytrade_mother_pool_v4_1
```

必須篩選：

```text
trade_date=今日
canonical_run_id=fugle_daytrade_source:YYYYMMDD:canonical
contract_version=4.1.0
```

完整分頁固定 `order=symbol.asc`、page size 200。不得按動態 rank 分頁，以免 Writer 更新期間跨頁位移。

詳細下游欄位表另見：`ops/public-slot/MotherPoolV4_1ConsumerHandoffChecklist_20260909.md`。

## 15. Runner＋Verifier＋Receipt 契約

```text
Runner 執行正式掃描與寫入
→ canonical readback 獨立讀回
→ Verifier 不呼叫 Runner、不補資料
→ Receipt 保存判定及完整證據
```

Receipt 至少包含：

```text
contract / contract_version
runner_contract / verifier_contract
status / complete / ok / exit_code
trade_date / canonical_run_id
writer_run_id / generation_id
written_rows / readback_rows
runner_ok / verifier_ok
same_trade_date / same_canonical_run_id
failed_checks[] / first_blocker
started_at / finished_at / checked_at
```

完整公式：

```text
complete = runner_exit_code=0
AND runner_receipt_written=true
AND verifier_exit_code=0
AND verifier_readback_matches_runner=true
AND contract_versions_match=true
AND all identities match
AND failed_checks=[]
AND first_blocker=null
```

零事件可以 complete，但必須證明完整掃描已執行；不得偽造候選或通知。

## 15.1 Formal Gate 與每輪正式輸出

Formal Gate 只決定是否建立下游正式候選，不決定 Mother Pool 是否可保留 discovery 成員。至少驗證 Fugle transport、同交易日／同 canonical run、formal scope 行情覆蓋、一分 K新鮮度、日 K與均量、必要技術狀態、來源追溯、Writer lease，以及不存在全域 blocker。產業成立、快速入池或 Telegram 事件均不等於 Gate 放行。

每輪至少更新或產生可稽核證據：

```text
fugle_daytrade_priority_pool
fugle_daytrade_quotes_live
fugle_daytrade_intraday_1m
fugle_intraday_5m_signal_cache
fugle_daytrade_daily_volume_avg
source_status
daytrade_industry_signal_fast_inject
Mother Pool delta
Gate / scorecard
canonical receipt
```

## 16. DATA_GAP 與 fail-closed

必須分離：

```text
receipt_incomplete
global_formal_gate_blocked
symbol_data_gap
NO_NEW_MARKET_EVENT
```

一律 fail-closed：跨日資料、錯誤 run、必要欄位缺失、WebSocket 必要頻道失效、Writer／readback 筆數不一致、舊 view fallback、舊 verifier 復活、用盤中簿冒充盤前簿。

正常空結果：沒有合格產業、沒有兩倍外盤候選、沒有五分 K轉強、非交易日、收盤後停止新增。正常空結果仍須有 runner、readback、verifier 與 receipt。

## 17. 舊鏈退役

已退役 verifier 的實體檔案、package script、Windows Task 與任何可執行引用必須為零；其名稱只可存在於現行 closed-loop 防復活 blacklist。正式驗證入口唯一為 `scripts/verify-daytrade-mother-pool-closed-loop.js`。舊 Mother Pool view、Top 40、priority compatibility 與 previous-good 不得取得正式決策權。

## 18. 下游交接順序

所有下游策略統一使用：

```text
lib/daytrade-canonical-water-reader.js
→ lib/daytrade-mother-pool-strategy-adapters.js
→ strategy2 / strategy3_v2 / strategy4 / strategy5 / institution / buy_sell / scanner / telegram
```

Adapter 自動套用各策略所需的一分 K載入範圍，但共同版本閘門完全一致：只接受 `4.1.0`、今日 `trade_date`、今日 `canonical_run_id` 與 `same_trade_date_current`。任一不符即 fail-closed，禁止回退舊 view或previous-good。

```text
market_calendar
→ source_status / canonical Gate
→ v4.1 全量分頁
→ 驗證 contract/date/run/freshness
→ 依策略事件標的讀 quote
→ 讀 1m RPC／5m／內外盤／daily OHLC
→ 逐檔 DATA_GAP 隔離
→ 下游策略自己的 Gate
→ 下游 runner＋verifier＋receipt
```

Viewer 與下游只能唯讀，不得啟動 Writer、補資料、修改 Mother Pool 或硬開 Gate。

正式機器可執行 `npm run verify:daytrade-mother-pool-consumer-adapters`，一次驗證 Strategy 2／3 V2／4／5、法人、買賣超、Scanner及Telegram的Adapter、版本拒絕、跨日拒絕、錯run拒絕與新鮮度拒絕。

## 19. 目前正式證據與待驗項目

2026-09-09 已有：

- Mother Pool v4.1：720 rows／4 pages，契約、交易日、canonical run 與 freshness 全列一致。
- 一分 K RPC：已回傳真實 `volume_strategy_usable`。
- Market calendar：TW、同日、open。
- 盤前試撮：482 rows；盤前 order book 482 檔明確不可逆缺口。
- 前一交易日 OHLC：706/720；14 檔為 `DATA_GAP_PREVIOUS_SESSION_OHLC`。
- 內外盤：完成 720 檔集合對帳與逐檔隔離。
- 五分 K隔離 history replay：PASS。

尚待下一交易時段：

- 盤前 Snapshot Task 自然 08:45～08:59 驗收。
- 五分 K 720 檔在 4 分鐘內完成三個連續自然輪次。
- 跨電腦 anon 綁定相同 receipt／run id 讀回。

因此目前不得把「整日所有自然鏈」標記為 COMPLETE；各已完成子鏈可依自己的 receipt 如實標記 complete。

## 20. 最終運作流程

```text
交易日判斷
→ 股票主檔 runner＋verifier＋receipt
→ 06:00 啟動唯一 WebSocket 與 Writer
→ 全終端有效台股聯集直接暖機入池
→ 保存來源與新鮮度
→ 08:30 接收晨報台股優先觀察
→ 08:45～08:59 保存自然盤前證據
→ 09:00 台股全市場細產業與量價偵測
→ 排行榜熱門股與突然流入事件
→ 合格產業成分股同輪快速注入
→ quote＋1分K＋內外盤補證
→ mother／priority／hot／deep-scan 分層
→ Mother Pool runner receipt
→ canonical readback
→ source alignment verifier
→ closed-loop verifier
→ canonical receipt
→ 下游策略唯讀取用
→ 下游自行執行策略 Gate、顯示與通知
→ 13:30 停止新增並保存盤後驗收
```

真正完成的定義是：正式 Runner 寫入、獨立 Verifier 從 canonical 水源讀回、Receipt 身分與筆數一致，且 `failed_checks=[]`、`first_blocker=null`。
