# Strategy3 V2 完整運作與驗收守則

版本日期：2026-09-11
時區：Asia/Taipei
正式策略：Strategy3 V2
策略用途：隔日沖候選參考，不是自動下單
正式根目錄：`C:\fuman-release-owner\fuman-terminal`
正式 Runtime：`C:\fuman-runtime`
Mother Pool 契約：`4.1.0`
閉環契約：`runner＋authoritative readback＋verifier＋receipt`
文件版本：2026-09-11 修訂驗收版。本文定義驗收要求，不代表程式已部署或任一批次已通過完整驗收。
> 本文件取代 2026-09-10 與更早的 Strategy3 文件。正式漲幅區間為 5%～8%；60 分 K 的 KD 只保留為證據，不再是硬條件；尾盤延續改採 RSI、ATR14、相對成交量與收盤位置共同判定。

## 1. 一眼看懂完整流程

| 時點 | Producer／Consumer | 正式動作 | 產物 |
|---|---|---|---|
| T 日 Strategy3 完成後 | Strategy3 | 將 run 與候選寫入 Strategy3 V2 authority | `strategy3_v2_scan_runs`、`strategy3_v2_scan_results` |
| T+1 06:00 | Mother Pool Writer | 直接讀最近有效的 Strategy3 complete run；候選以 `source_strategy3` 聯集入池 | Strategy3 priority bridge、Mother Pool v4.1 |
| T+1 09:00～13:30 | Mother Pool | 依當日台股量價動態增減；股期只作增強證據 | 當日 Mother Pool v4.1 |
| T+1 12:30 | Strategy3 readiness | 讀 Mother Pool、同日 quote、同日一分 K；檢查 90% coverage | readiness evidence |
| T+1 12:50 | Strategy3 readiness | 最後水源與 coverage 預檢 | readiness evidence |
| T+1 12:55 | Strategy3 first attempt | 證明未到 13:00 不得正式發布 | fail-closed evidence |
| T+1 13:00 | Strategy3 runner | 掃描今日 Mother Pool，套用 5%～8%、非漲停、RSI、日 K KD、ATR／RVOL 尾盤動能 | run、results、runner receipt |
| T+1 13:10 | Strategy3 verifier | 驗證水源、結果、資料庫與三端 | verifier receipt |
| T+1 13:15 | Scorecard | 對齊 runId、日期與筆數 | canonical receipt |
| 下一交易日 06:00 | Mother Pool Writer | 讀取上述 Strategy3 complete authority，直接把候選作為暖機入池來源 | `source_strategy3` |

## 2. 策略與 Mother Pool 的責任邊界

- Mother Pool 是 Strategy3 的當日 universe 與同日行情供應者。
- Strategy3 不建立全市場清單、不擴充 Mother Pool，也不反向修改當日 Gate。
- Strategy3 掃描成功後，結果會成為「下一交易日 06:00 Mother Pool 暖機來源」；這是結果交接，不是 Strategy3 改寫 Mother Pool。
- Strategy3 與當沖共用同一份 Fugle quote／一分 K Source Writer；不得另建 Strategy3 一分 K Writer。
- Strategy3 不依賴 Strategy2，不因 Strategy2 或股期資料失敗而全域封鎖。
- 股期只作個股增強證據，不具全域阻擋權。

## 3. 唯一正式 Mother Pool 水源

```text
authoritative view = public.v_fugle_daytrade_mother_pool_v4_1
producer receipt   = public.v_fugle_daytrade_mother_pool_receipt_v4_1
contract_version   = 4.1.0
common Reader      = lib/daytrade-canonical-water-reader.js
consumer Adapter   = strategy3_v2
```
每輪必須同時驗證：
```text
contract_version = 4.1.0
trade_date = 本輪指定交易日
canonical_run_id = fugle_daytrade_source:YYYYMMDD:canonical
source_freshness = same_trade_date_current
accepted_symbol_count > 0
trade_date + symbol 唯一
```
全域版本、日期、runId、freshness 或必要追溯欄位錯誤時整輪 fail-closed。單一股票 quote、一分 K、日 K 或 ATR／RVOL 歷史不足時，只隔離該檔並標記 `DATA_GAP`。
禁止回退：
- 舊 `public.v_fugle_daytrade_mother_pool`。
- 固定 Top 40、Strategy2 間接結果或前端受保護 API。
- previous-good、昨日 Mother Pool、昨日 quote 或昨日一分 K。
- 本機 JSON 作為正式 authority。

## 4. 行情與歷史水源

| 用途 | 正式來源 | 規則 |
|---|---|---|
| 即時／收盤 quote | `public.fugle_daytrade_quotes_live` | 必須同交易日 |
| 當日一分 K | `public.fugle_daytrade_intraday_1m`／`rpc:get_fugle_daytrade_intraday_1m_latest_n` | `synthetic=false`、`volume_strategy_usable=true` |
| 60 分 K | 同日及歷史一分 K聚合為已完成 60 分 K | KD 為證據；RSI 為硬條件 |
| 日 K、KD、RSI、ATR14 | `public.strategy4_daily_ohlcv_view` 加 Mother Pool 當日 live bar | 只借用正式日 K 水源；不代表依賴 Strategy4 掃描結果 |
MA30、MA35、MA58 與 `ma5_ma10_ma35_bullish` 全部禁止。若顯示短均線，只能使用 `MA5 > MA10 > MA20`，但它不是本版 Strategy3 的 ATR／RVOL硬門檻。

## 5. Reader 與一分 K 分批

PostgREST／RPC 上限是列數，不是股票數。正式 Reader 必須依每檔根數動態分批：
```text
requestedBarsPerSymbol = max(策略最低根數, 本輪指定根數)
candleChunkSize = max(1, min(200, floor(900 / requestedBarsPerSymbol)))
```
- 13:00 自然時槽：每檔至少 20 根有效同日一分 K。
- 盤後隔離重播：每檔取 40 根，以涵蓋 12:59～13:02 到收盤。
- 必須完整分頁讀完 Mother Pool，禁止因 RPC 截斷誤判 coverage。

## 6. 90% coverage 與容錯

```text
expected = 當輪 Mother Pool v4.1 去重後 symbol 數
ready20  = 至少 20 根有效同日一分 K 的 symbol 數
coverage = ready20 / expected
門檻     = coverage >= 0.90
```
- 90% 容錯只適用個股資料缺口，不適用版本、跨日、錯 run 或 authority 錯誤。
- 沒有新市場事件不算 Writer 錯誤；有市場事件卻沒有同步才是 `DATA_GAP`。
- `DATA_GAP` 股票不得進入正式候選。
- 健康資料下可 0 檔 complete；缺資料造成的 0 檔不得假裝 complete。

## 7. Strategy3 候選硬條件

每檔必須全部符合：
1. 位於指定交易日 Mother Pool v4.1。
2. Mother Pool、quote、一分 K 使用同一交易日與 canonical run。
3. 至少 20 根有效同日一分 K。
4. 12:59～13:02 至少一根有效一分 K；第一根 close 作為 entry。
5. 正式 close 優先使用同日 quote price。
6. `5% <= changePercent <= 8%`，上下限包含。
7. 實際漲停價命中者剔除；若缺正式漲停價，才以 `changePercent >= 9.7%` 作保守備援判定。
8. `closePrice >= entryPrice`。
9. 60 分 K：`RSI(3) > RSI(6)`，且 RSI(3)、RSI(6) 都高於前一根已完成 60 分 K。
10. 日 K：`K > D`、K 與 D 都向上；同時 `RSI(3) > RSI(6)` 且兩者都向上。
11. 收盤位置 `closeLocation >= 0.75`。
12. 當日截至 13:00 的 session RVOL `>= 1.5`。
13. 12:45～13:00 的尾盤 RVOL `>= 1.5`。
14. `0.8 <= 當日 TR / ATR14 <= 2.2`。
15. ATR14 必須有 14 個有效歷史 TR；RVOL 至少有 2 個可比較交易日。
### 7.1 60 分 K KD 的定位

60 分 K 仍計算 `K>D` 與 KD 趨勢，寫入 evidence，但不再是硬條件。原因是尾盤延續型股票可能在長時間整理後突然放量拉高，60 分 K KD 反應較慢；本版以 60 分 K 短 RSI、日 K完整趨勢與 ATR／RVOL 共同確認。
### 7.2 ATR／RVOL 公式

```text
closeLocation = (close - low) / (high - low)
sessionRVOL   = 今日 09:00～13:00 成交量 / 歷史比較日相同區間平均量
tailRVOL      = 今日 12:45～13:00 成交量 / 歷史比較日相同區間平均量
TRtoday       = max(high-low, abs(high-prevClose), abs(low-prevClose))
TR_ATR_ratio  = TRtoday / ATR14
```
RVOL 樣本政策：
- 5 個有效比較日：`rvol_baseline_confidence=standard`。
- 2～4 個有效比較日：允許成立，但標記 `rvol_baseline_confidence=low_sample`。
- 0～1 個有效比較日：`DATA_GAP`，該檔不得發布。

## 8. 排序與分數

以下公式依正式來源 scripts/run-strategy3-v2-complete-scan.js 第 267～275 行還原；原貼文的試算表錯誤文字已移除。

```text
tailSharePct = tailVolume / totalVolume × 100
entryToClosePct = (closePrice - entryPrice) / entryPrice × 100
fullSessionBonus = candleCount >= 200 ? 8 : (candleCount >= 100 ? 4 : 0)
rawScore = 50
         + min(28, changePercent × 4)
         + min(18, tailSharePct)
         + max(0, min(10, entryToClosePct × 2))
         + fullSessionBonus
score = max(1, min(100, round(rawScore)))
```

排序依 score、changePercent、tailSharePct 由高至低。ATR／RVOL 是硬條件與證據，不重複加分。驗收須記錄 candleCount 與實際取樣時間範圍；取 20／40 根資料不得宣稱取得全交易時段資料，也不得因此取得全時段加分。

## 9. 正式結果必要欄位

除既有 code、name、rank、score、entry、close、change、Mother Pool 追溯欄位外，每筆必須包含：
```text
technical_trend_confirmation.hourly60
technical_trend_confirmation.daily
technical_trend_confirmation.hourly_strategy3_pass
technical_trend_confirmation.daily_strategy3_pass
atr_rvol_confirmation.atr14
atr_rvol_confirmation.current_true_range
atr_rvol_confirmation.tr_atr_ratio
atr_rvol_confirmation.close_location
atr_rvol_confirmation.session_rvol_5d
atr_rvol_confirmation.tail_rvol_5d
atr_rvol_confirmation.comparable_history_dates[]
atr_rvol_confirmation.rvol_baseline_session_count
atr_rvol_confirmation.rvol_baseline_confidence
atr_rvol_confirmation.checks
```
欄位名稱 `session_rvol_5d`／`tail_rvol_5d` 為相容名稱；實際分母依 `rvol_baseline_session_count` 決定，2～4 日會明確標為 `low_sample`。

## 10. Strategy3 authority 與反向暖機橋接

Strategy3 正式 authority：
```text
public.strategy3_v2_scan_runs
public.strategy3_v2_scan_results
public.v_strategy3_v2_latest_complete_run
```
Mother Pool Writer 的 Strategy3 bridge 必須：
1. 由 Writer 端以 service-role 唯讀上述 authority，避免 RLS 將完整結果靜默讀成 0 筆。
2. latest run 必須 `status=complete`、`complete=true`、`publish_allowed=true`。
3. 結果列必須與 runId、tradeDate 一致。
4. 非 0 結果時，`resultRows` 與 `symbolCount` 必須等於 authority 結果筆數。
5. 合格股票寫入 bridge 後，以 `source_strategy3` 加入下一交易日 06:00 Mother Pool 暖機聯集。
6. 合法的 0 結果 complete run 可維持 bridge ready，但不得偽造 symbol。


## 11. 完成狀態與用語

本版統一「三端」為桌機、手機、／88 Scorecard；API 與 Supabase 是另外必驗的資料來源。API、桌機、手機片段三者一致只能稱「資料介面讀回通過」。

| 狀態 | 必須具備的證據 | 允許回報 |
|---|---|---|
| scan_complete | 全池讀取、資料品質、候選條件、runner 與 DB 讀回通過 | 掃描完成，交付待驗收 |
| delivery_complete | scan_complete，加 API、桌機、手機、／88、LINE 2/2、完整 verifier 與最終回執 | 本批交付完整驗收通過；須標明 natural 或 recovery |
| natural_slot_complete | 當日自然排程各階段真實執行，且 delivery_complete | 自然排程完整驗收通過 |
| recovery_replay_complete | 獨立重播批次完成 delivery_complete | 修復重播交付完成；自然排程仍未通過 |
| next_day_handoff_ready | Writer 可從 authority 讀到同批候選、bridge 筆數及股票集合一致 | 隔日暖機交接已備妥 |
| next_day_handoff_complete | 下一交易日 06:00 Writer 實際完成入池並有讀回證據 | 隔日暖機實際驗收通過 |

上述為本文件的驗收狀態語意。現有回執若未實作相同欄位，驗收報告應提供原欄位與證據對照，不能憑文件宣稱系統已支援。

任何缺證據、跨日、錯批次、未到執行時槽，一律不得當作通過。不得只憑 complete=true、程序 exitCode=0、HTTP 200 或畫面有股票就宣告整套完成。下一交易日尚未到時，可回報本批交付完成、暖機待驗；不得預先回報跨日整套完成。

## 12. 執行前鎖定驗收身分

每次驗收先記錄 expected_trade_date、scanner_run_id、canonical_run_id、mode、程式版本、驗收開始時間與證據目錄。自然時槽及 recovery 使用不同 scanner_run_id；canonical_run_id 是水源批次，不能拿來代替 scanner_run_id。

固定核對四個追溯欄位：writer_run_id、generation_id、source_name、source_trade_date。每份證據須記錄來源、觀察時間、對應 runId／日期與驗證器版本；歷史證據即使今天重新存檔也不能算今天的新證據。

同一次驗收固定同一 scanner run。若 latest 在驗收途中切換，改查已鎖定批次並重新核對受影響介面，禁止混用兩輪結果。只讀狀態檢查不得啟動掃描、發布或通知。

正式程式來源為 C:\fuman-release-owner\fuman-terminal；C:\fuman-runtime 只放執行資料。部署及修改仍須遵守正式來源的 AGENTS.md 與發版流程，文件修訂不等於部署完成。

## 13. 每日自然排程與逐站驗收

以 D 表示本輪交易日，D+1 表示下一個台股交易日，須依市場日曆判定，不能單純加一天。

| 步驟／時槽 | 動作與通過條件 | 必留證據 | 失敗時處置 |
|---|---|---|---|
| 0／執行前 | 核對交易日、正式程式、排程動作、工作目錄、啟用狀態、重複工作及鎖 | 市場日曆、Task 名稱、action、上次結果、下次時間、鎖擁有者 | 停止錯誤批次；活躍鎖不得直接刪除 |
| 1／12:30 | Mother Pool v4.1、必要身分、同日 quote／一分 K、全池非空且 coverage ≥90% | readiness 與 producer receipt | 記錄第一阻擋原因；修復水源後再預檢 |
| 2／12:50 | 再次取得當日當輪可用來源，確認資料未退化 | 第二份 readiness，不得複製 12:30 結果 | 保持 fail-closed，禁止勉強發布 |
| 3／12:55 | 提前嘗試有紀錄，但不得提前正式發布 | 預期被時間保護阻擋的 evidence；不得將預期阻擋判為全天成功 | 若真的提前發布，驗收失敗 |
| 4／13:00 | 正式 runner 全池掃描，逐股計算及隔離缺口；exitCode=0 | runner、全池分頁、coverage、條件判定、result count | 保留失敗紀錄，禁止將缺資料零筆當作完成 |
| 5／掃描後 | Supabase apply 成功；再獨立讀回唯一 run 與所有 results | 完整 DB readback、去重股票集合、內容及 count | 不得以本機 JSON 或寫入請求成功代替 DB 驗證 |
| 6／掃描後 | 刷新桌機 snapshot 及手機 fragment；驗證 API 與實際畫面 | 第 14 節全部證據 | 補刷新／補讀回，不篡改結果 |
| 7／13:10 起 | 依相依順序跑水源、條件、介面與交付 verifier | 各 verifier 的開始／完成時間、exit code、issues | 缺 LINE 或／88 時只能 pending，不得先填完整成功 |
| 8／交付階段 | 合法可發布批次，LINE 個人與群組均送達且對齊同批次 | 2/2 通知證據與去重紀錄 | 僅處理缺失接收端；不重掃或全量重送 |
| 9／13:15 | ／88 固定時槽收集同批 runId、日期、結果及筆數 | collector receipt、讀回及渲染證據 | 標示 scorecard_pending／mismatch，走同批補收集 |
| 10／全部交付後 | 跑 daily/full closure，最後產生 canonical receipt 並再讀回 | complete、verifier_ok、failed_checks、三端與 LINE 證據 | 缺任何項目不得 complete |
| 11／當日 | Writer 讀取 V2 authority，bridge 候選集合與筆數一致 | bridge source runId、source date、resultRows、symbolCount、symbols | 不得以介面顯示正常代替 bridge |
| 12／D+1 06:00 | Writer 實際以 source_strategy3 聯集入池 | 目標交易日、Writer run、來源 Strategy3 run、逐股標記與讀回 | 未到時槽記 PENDING；缺入池證據不得跨日完成 |

13:10 是驗證開始時槽，不代表可跳過 13:15 才產生的 Scorecard 證據。晚到的自然批次補驗收必須保留實際完成時間，不能回填成準時完成。

## 14. API、桌機、手機與／88 驗收

四個介面一律要求讀取成功、trade date 等於 scanner trade date、runId 等於 scanner run_id、總結果數等於 scanner result_count。除此之外，逐一核對股票集合與關鍵欄位，不能只有筆數相同。

- API：確認 V2 authority、complete／publish 狀態、日期、總筆數與結果內容；錯誤回應或舊資料不能因 HTTP 200 算通過。
- 桌機：snapshot 與實際 Strategy3 畫面對齊本輪；須看得到正確交易日與候選，不是只有後端 bundle JSON 通過。
- 手機：fragment、boot 所指向的批次與手機實際畫面一致。fragment 已更新但 boot 仍為 waiting／舊 run 時，須查明實際載入及更新行為；未取得畫面證據前不可報手機完成。
- ／88：collector 與 Strategy3 行的 runId、tradeDate、count、股票集合一致，且實際畫面不是昨日成績單。禁止修改成績列以湊齊 scanner 筆數。
- 介面分頁／顯示上限與完整結果總數分別記錄。例如只顯示前 60 筆不能把 60 當全池掃描數；按頁核對完整集合或可追溯摘要。
- recovery 的 API metadata、終端與通知均需清楚標示修復重播及交易日。

UI 留存網址／路由、檢查時間、視窗類型、畫面或渲染測試證據；涵蓋正常結果、健康零結果、blocked、degraded 的正確呈現。未發生狀態以隔離測試驗證，禁止改動正式資料製造測試狀態。健康零結果須明示無符合標的；缺資料須顯示原因，不能留白或永遠載入。

## 15. LINE 與重複通知保護

LINE 只讀取已 apply 成功且 publish_allowed=true 的批次。個人與群組分別核對 runId、交易日、count、送出時間、接收端的非敏感識別、平台回應及可取得的送達證據。

發送前先查同批次既有證據。只有 dry-run、訊息生成成功、送出請求成功或平台接受，不得寫成人員已讀；驗收報告要如實記錄平台實際可證明的層級。若現行 connector 只能證明接受，不能憑空產生 delivery 證據，須列出契約要求未被證明。

個人與群組任一未完成，交付不得 complete；不影響已成功的掃描資料。回應不明時先核對去重紀錄，禁止盲目重送。Receipt 不得存 token、原始 target 或 Authorization header。

自然正式發送依既有明確授權執行；修復補發布須有明確授權並標示「策略3 修復重播結果」及交易日。本文件本身不是對任何接收人的發訊授權。

## 16. Verifier 與最終回執

使用來源文件列出的正式程式，由正式 runner 串接；執行前核對現有程式與參數，禁止把文件中的名稱視為已部署證據。

```text
verify-daytrade-canonical-water-reader-contract.js
→ verify-strategy3-v2-mother-pool-v4-1-scan-contract.js
→ verify-strategy3-technical-trend-contract.js
→ verify-strategy3-atr-rvol-contract.js
→ verify-strategy3-v2-water-universe.js
→ verify-strategy3-v2-surface-closure.js
→ LINE 與 Scorecard 實際交付證據
→ verify-strategy3-v2-daily-unattended-closure.js
→ verify-strategy3-v2-full-closure.js
→ canonical strategy receipt
```

重播另核對 verify-strategy3-recovery-replay-complete.js；暖機另核對 verify-strategy3-mother-pool-warmup-authority.js。程式驗證 pass 不代替資料庫、UI 或實際送達證據。若既有 verifier 未涵蓋本版要求，記為驗收缺口，不能用舊的 ok=true 直接批准。

最終回執至少包含：

```text
contract / contract_version / mode / strategy
tradeDate / runId / canonical_run_id / writer_run_id / generation_id
source_name / source_trade_date / source_freshness
startedAt / finishedAt / checkedAt / code_version
status / complete / exitCode / runner_status
mother_pool_rows / mother_pool_pages / unique_symbols
expectedTotal / scannedCount / accepted_symbol_count
quote_valid_rows / intraday_1m_valid_rows / coverage / symbol_data_gap_rows
resultCount / result_symbols / candidate_gate_evidence
supabase_apply / database_readback
apiRunId / desktopRunId / mobileRunId / scorecardRunId
各介面的 tradeDate、totalCount、股票集合及 evidence 路徑
triSurfaceStatus / UI_evidence
LINE_personal_evidence / LINE_group_evidence
verifier / verifier_ok / failed_checks / first_blocker / blockingReason
fallback / warnings / receipt_written
natural_slot_complete / next_day_handoff_status
```

驗收用的 expectedTotal 固定為去重後全 Mother Pool；accepted_symbol_count 須明示原程式語意，不能以排除缺口後的可用數縮小 coverage 分母。ScannedCount、可用檔數、缺口數與結果數應分開。

自然最終回執：C:\fuman-runtime\data\scan-receipts\strategy3.json。
重播最終回執：C:\fuman-runtime\data\scan-receipts\strategy3-recovery-replay.json，並保留日期／runId 對應歷史副本。

最終 complete 的必要條件為：資料身分與全池讀取合格、coverage≥90%、每筆候選硬條件合格、runner exit 0、DB apply/readback 一致、API 與三端讀回及畫面一致、LINE 2/2 證據齊全、完整 verifier 通過、failed_checks 為空、first_blocker 為 null、blockingReason 為空、fallback=false，最後寫入並重新讀回本輪回執成功。

可接受的 low_sample 與逐股 DATA_GAP 必須完整記錄於樣本／缺口證據，不得清除真實 warnings 來湊 warnings=[]。若既有 schema 將這些狀態視為阻擋，須修正並驗證 schema 與契約的一致性後才能完成。

## 17. 修復與補驗收流程

### 17.1 自然掃描成功，只缺後續驗收

前提是自然 scan、DB apply 及 LINE 已成功。鎖定原 runId，依序補 API／snapshot／fragment／Scorecard、UI、verifier 及 final receipt。不得重掃、換 runId、重送 LINE，也不得改寫原始時槽記錄。

### 17.2 水源修復後隔離重播

同日 Mother Pool、quote、一分 K 與 Writer generation 必須能完整追溯，coverage≥90%。以獨立 recovery runId 完整執行，寫入 V2 authority，formal_allowed=false。publish_allowed=true 只表示可補發布明確標示的重播結果，不等於自然時槽成功或自動取得通知授權。

已存在同日成功 recovery run 時，先核對該批 authority 與來源證據。若只是交付缺口，優先補同批交付，不無故重掃。若資料或策略版本改變而須重算，必須新建獨立 run 並保留替代關係。

盤後使用保存的同日資料驗證，不要求已過期的 live WebSocket 即時狀態；但不得放寬同日、追溯、非 synthetic、volume usable 及 coverage 要求。盤後資訊不得反填為 13:00 當時可得資料。自然時槽只能用當時已取得的 quote、已完成 K 與 live daily bar，須記錄 as-of 時間。

Recovery 仍須完成 DB、API、桌機、手機、／88、LINE 與獨立最終回執，才可稱修復交付完成；natural_slot_complete 永遠不能因此變 true。

### 17.3 失敗與停止規則

- 版本／日期／run／追溯錯誤、全池空、coverage 不足：停止該輪，不發布不完整結果。
- DB、介面、／88 不一致：保留成功掃描，補缺失環節，不能手改結果或回執。
- 短暫讀取失敗採有上限重試並保留每次紀錄；持續外部故障須回報確切 blocker，不能無限輪詢或密集重跑。
- 缺發訊授權、真正外部故障、不可逆操作或業務規則歧義：清楚列出待處理項目；不得將 blocked 改成 complete。
- 舊畫面若因可用性保留，必須明示舊日期／降級；不得拿 previous-good 作本輪水源或完成證據。

## 18. 06:00 暖機與舊鏈驗收

當日 bridge ready 須從 V2 authority 獨立讀回：source run status=complete、complete=true、publish_allowed=true，結果列日期及 runId 一致。非零結果時 resultRows、symbolCount、去重股票集合都一致。合法零結果維持 bridge ready 且 symbols=[]，不得造股票。

下一交易日 06:00，驗證 Writer 實際使用同一 source run，候選以 source_strategy3 進入目標日 Mother Pool。保留目標日與來源日，不要求兩者相同。若來源被較新合格批次取代，須有可追溯選取規則與批次關係，不能悄悄驗收另一輪。

在正式 Reader、runner、verifier、排程 action 中，已退役 authority、Strategy2 間接水源及另建 Strategy3 一分 K Writer 的可執行引用必須為零。MA30、MA35、MA58、ma5_ma10_ma35_bullish 不得復活；歷史紀錄與 blacklist 不計為可執行引用。

至少禁止：strategy3_scan_runs、strategy3_scan_results、v_strategy3_latest_complete_run、v_strategy3_quote_ready*、v_strategy3_source_gate、v_strategy3_intraday_1m_status、strategy3_intraday_1m_status_latest。禁止名單不得誤傷正式 V2 的 v_strategy3_v2_latest_complete_run。

## 19. 每次交付必填驗收表

以下為空白範本，所有項目預設待驗，不是成功證據。

| 項目 | 結果 PASS／FAIL／PENDING | 觀察時間 | runId／日期／筆數 | 證據位置／第一阻擋原因 |
|---|---|---|---|---|
| 排程、日曆、版本與鎖 | PENDING | 待填 | 待填 | 待填 |
| 12:30／12:50／12:55 自然證據 | PENDING | 待填 | 待填 | 重播不能替代 |
| 全池分頁、追溯與 coverage | PENDING | 待填 | 待填 | 待填 |
| 候選條件、樣本信心與資料缺口 | PENDING | 待填 | 待填 | 待填 |
| Runner 與 Supabase 獨立讀回 | PENDING | 待填 | 待填 | 待填 |
| API | PENDING | 待填 | 待填 | 待填 |
| 桌機 snapshot 與畫面 | PENDING | 待填 | 待填 | 待填 |
| 手機 boot、fragment 與畫面 | PENDING | 待填 | 待填 | 待填 |
| ／88 collector 與畫面 | PENDING | 待填 | 待填 | 待填 |
| LINE 個人 | PENDING | 待填 | 待填 | 待填 |
| LINE 群組 | PENDING | 待填 | 待填 | 待填 |
| Daily／Full verifier | PENDING | 待填 | 待填 | 待填 |
| 最終回執寫入及再讀回 | PENDING | 待填 | 待填 | 待填 |
| 當日 bridge ready | PENDING | 待填 | 待填 | 待填 |
| 下一交易日 06:00 實際入池 | PENDING | 待填 | 待填 | 未到時槽維持待驗 |
| 舊鏈退役與 UI 狀態測試 | PENDING | 待填 | 待填 | 待填 |

最後回報格式：

```text
交易日／驗收時間／模式／scanner runId：
掃描：全池 __、有效 __、缺口 __、coverage __、結果 __
資料庫／API／桌機／手機／88：逐項結果與批次
LINE：個人 __、群組 __，證據層級 __
Verifier／最終回執：__
本批交付完整驗收：YES／NO
自然排程完整驗收：YES／NO／待自然時槽
隔日暖機：READY／COMPLETE／PENDING／FAIL
第一阻擋原因及下一步：__
```

沒有全部證據就回答尚未完成並指出缺口；不得只回「已修好」「三端正常」或「掃描成功」。

## 20. 9/11 證據範圍與文件修訂紀錄

使用者原文件與本次對話先前讀到的 recovery 證據：runId=strategy3v2-recovery-replay-20260911-20260911084738，全池 366、有效 362、coverage 0.9891、結果 2，候選為 2305、1560，資料庫及 API／桌機／手機片段讀回一致。

這些是指定歷史批次的證據摘要，不是本文件產出當下的重新驗收結果。先前查到／88 與自然 final receipt 仍指向 9/8；本次文件修訂未重新執行線上驗收、未補發 LINE，也未驗證下一交易日 06:00 入池，因此不得據此升格為今天整套交付完成。

本次修訂：統一漲幅 5%～8%；還原評分公式；合併重複章節；區分三端與 API；加入逐站證據、UI、LINE、／88、獨立重播、最終回執及跨日暖機驗收；移除舊版 5%～7% 條款。9/10 歷史成功不作今天的完成證據。

文件完成與系統完成分開回報。本文是交付的完整操作及驗收規範；仍須以實際 runner、DB、各介面、通知、verifier 及回執證據完成系統驗收。

