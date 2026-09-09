# Scanner 水源修復回報單

日期：2026-09-09  
交辦：Scanner 接收端 Codex  
提供端：Supabase／Writer／Release Owner  
狀態：`SOURCE_REPAIR_COMPLETE_WITH_EXPLICIT_HISTORICAL_DATA_GAPS`

## 修正根因

1. `get_fugle_daytrade_intraday_1m_latest_n` 的回傳型別漏掉原始表已有的 `volume_strategy_usable`，導致 Scanner 無法辨識真實成交量是否可用。
2. 5 分 K complete runner 沒把 Writer 已確定的 `trade_date` 傳給 verifier；verifier 另做全表日期探測並 timeout，因此同 run receipt 未發布。
3. 盤前 snapshot Writer 使用 `trade_date,symbol` 作 conflict key，但既有表的實際主鍵仍是 `symbol`，造成 upsert 409，今日資料為 0。
4. Daytrade Writer 沒有直接維護 `market_calendar`，Scanner 雖有本機時鐘規則，但 Supabase 缺少同日唯讀證據。
5. Mother Pool 分頁若按動態 rank 排序，Writer 更新期間可能跨頁位移；改用穩定的 `symbol.asc`。

## 已完成修復

- 新增 migration：`ops/public-slot/ScannerSourceClosurePatch_20260909.sql`。
- RPC 現在逐 bar 原樣回傳 `volume_strategy_usable`，null 仍為 null，禁止預設 true。
- 5 分 K runner 直接把 Writer 的 `trade_date` 傳入 verifier；明確日期存在時不再執行 timeout-prone 全表日期 probe。
- 今日同 run 5 分 K receipt 已發布至 `public.v_fugle_intraday_5m_verification_readback`。
- Daytrade Writer 每輪寫入正式 `market_calendar`；今日 TW row 已由正式交易日 guard 確認後補入。
- 盤前 snapshot conflict key 改為資料表真實主鍵 `symbol`。
- 新增輕量盤前同步器與 Windows Task：`Fuman Daytrade Preopen Snapshot 0845-0859`，工作日 08:45 起每分鐘執行至 08:59，`IgnoreNew`。
- 今日 cache 保留的真實 `trialEventAt/trialPrice/referencePrice` 已回補；未保存的盤前 order book 保持 DATA_GAP，不拿盤中簿替代。
- v4.1 全池分頁固定使用 `symbol.asc`。

## 正式證據

### 1 分 K RPC anon

- HTTP 200。
- 3105 兩根抽驗 bar 均回傳 `volume_strategy_usable=true`、`synthetic=false`。
- 接收端仍須逐 bar fail-closed；null 不得發布成交量策略。

### 5 分 K同 run receipt

- `trade_date=2026-09-09`
- `run_id=five-minute-20260909045808`
- `contract=daytrade_intraday_5m_runner_verifier_receipt_v3`
- `status=complete`
- `complete=true`
- `exit_code=0`
- `anon_http_status=200`
- `ssl_ok=true`
- `failed_checks=[]`
- 唯讀入口：`public.v_fugle_intraday_5m_verification_readback`

該輪 3105 的技術分類仍可為 DATA_GAP；receipt complete 只代表 Writer＋verifier＋publication 完整執行，不代表偽造技術訊號。

### Market calendar anon

- `trade_date=2026-09-09`
- `market=TW`
- `is_open=true`
- `calendar_contract=market-calendar-contract-v1`
- 唯讀入口：`public.market_calendar`

### Preopen anon

- `fugle_preopen_snapshot`：482 rows。
- `fugle_preopen_snapshot_history`：482 rows。
- 真實來源時間：2026-09-09 08:45–08:59 Asia/Taipei。
- 試撮價／參考價：已保存。
- 同事件盤前 order book：0 rows ready。
- `order_book_status=DATA_GAP_UNRECOVERABLE`：482 rows。

### Mother Pool v4.1 完整讀回

- `trade_date=2026-09-09`
- `canonical_run_id=fugle_daytrade_source:20260909:canonical`
- 720 rows／4 pages（page size 200）。
- `contract_version=4.1.0`：720。
- `source_freshness=same_trade_date_current`：720。
- quote 完全缺少：1。
- 1 分 K 完全缺少：1。
- 唯讀入口：`public.v_fugle_daytrade_mother_pool_v4_1`

### 前一交易日 OHLC

- 正式來源：`public.strategy4_daily_ohlcv_view`
- 前一交易日：2026-09-08。
- 完整分頁：1908 rows／4 pages。
- Mother Pool 覆蓋：706/720。
- 真實缺口：14 symbols：`1102,2254,4590,5371,6461,6534,6854,6924,6949,6955,6969,7610,7730,7823`。
- 接收端不得再以 bounded latest-N 分鐘 K 宣稱完整前日 OHLC；這 14 檔應標示 `DATA_GAP_PREVIOUS_SESSION_OHLC`。

## 接收端必須修改

Scanner 主 PS1 不在本正式 repository，因此以下由接收端 Codex 完成：

1. `Get-SupabaseMarketCalendar` 必須在 Scanner 主流程執行，禁止只看時鐘。
2. `Get-DaytradeContractHealth` 的 authoritative Mother Pool 僅能是 v4.1；舊 Mother／priority／Top40 只可標示 diagnostic，不得影響 v4.1 健康結果。
3. `Test-CandleVolumeStrategyUsable` 繼續拒絕 null，直接使用 RPC 新欄位。
4. `Get-IntradayCandleStats` 的 previous-day high/close 改讀完整 daily OHLC；缺少的 14 檔逐檔 DATA_GAP。
5. 分離三種狀態：`receipt_incomplete`、`global_formal_gate_blocked`、`symbol_data_gap`，不得互相覆寫。
6. Mother Pool／Gate 禁用 MA30、MA35、MA58；其他既有策略是否移除這些條件必須依各策略契約另行遷移，不可由 Scanner 擅自刪除。

## 剩餘 blocker

- 今日 482 檔盤前委買賣簿沒有保存原始時槽快照，屬不可逆歷史缺口；已安裝自然時槽 Task 防止明日重發。
- 前日 OHLC 尚缺 14/720，必須逐檔 DATA_GAP，不能用分鐘 K 推算成 PASS。
- 接收端主 PS1 尚須依上節完成整合與 end-to-end replay。

禁止偽造新鮮度、硬改 Gate、用昨日盤中資料替代今日資料、用盤中 order book 冒充盤前簿，或用單筆查詢代替完整驗收。
