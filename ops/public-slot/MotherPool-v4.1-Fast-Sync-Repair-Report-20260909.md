# Mother Pool v4.1 即時報價與一分 K 同步修復完成回報單

日期：2026-09-09  
時區：Asia/Taipei  
交辦：Supabase／Writer／Release Owner Codex  
狀態：`COMPLETE`  
契約版本：`4.1.0`

## 一、問題

完整 Mother Pool Writer 單輪約需 4–5 分鐘。富果 WebSocket 本機快取雖持續更新，但 Supabase 報價與一分 K 原先必須等待完整 Writer 執行至同步階段，造成跨機唯讀資料週期性超過 120 秒。

此問題屬於同步頻率與執行鏈耦合，不是富果 WebSocket 沒有行情。

## 二、根因

1. 報價與一分 K 同步綁在完整 Mother Pool runner。
2. 完整 runner 包含全市場資料、母池重排、歷史量能、籌碼與一分 K 彙整，單輪時間長於即時資料新鮮度門檻。
3. Writer lock 存在時，後續分鐘輪次只會安全跳過，無法獨立更新 Supabase 行情。
4. v4.1 view 的一分 K 新鮮度原先讀取完整 runner payload，不能即時反映快速同步後的新資料。

## 三、修正內容

### 3.1 快速同步 runner

新增：

```text
scripts/sync-daytrade-websocket-supabase-fast.js
```

每輪只處理：

- 富果 WebSocket 三分鐘內最新報價。
- 富果 WebSocket 三分鐘內更新的一分 K。
- 增量 upsert 至 `fugle_daytrade_quotes_live`。
- 增量 upsert 至 `fugle_daytrade_intraday_1m`。
- 寫入 `daytrade-fast-supabase-sync.json` 執行證據。

此 runner 不修改 Mother Pool 排名、不產生策略候選、不發送通知，也不改寫 Formal Gate。

### 3.2 排程整合

快速同步已整合進既有正式排程 wrapper：

```text
Windows Task：Fuman Daytrade Source Writer 0600-1330
Runtime wrapper：C:\fuman-runtime\ops\Run-DaytradeSourceWriter.ps1
正式 wrapper：ops/public-slot/Run-DaytradeSourceWriter.ps1
```

每個自然分鐘的 wrapper 都先執行快速同步，再處理完整 Writer lock。即使完整 Writer 尚未結束，快速行情同步仍可獨立完成。

### 3.3 Supabase v4.1 view

正式跨機水源：

```text
public.v_fugle_daytrade_mother_pool_v4_1
```

已新增 `(symbol, trade_date, candle_time desc)` 索引，並以每檔最新一根一分 K 的索引查詢反映 `latest_candle_time` 與 `intraday_1m_stale_seconds`，避免重新引入全量聚合造成 HTTP 500。

### 3.4 閉環 verifier

唯一正式 verifier：

```text
scripts/verify-daytrade-mother-pool-closed-loop.js
```

新增硬檢查：

```text
fast_supabase_sync_readable=true
fast_supabase_sync_same_day=true
fast_supabase_sync_fresh=true
fast_supabase_quote_write_nonempty=true
fast_supabase_1m_write_nonempty=true
```

快速同步證據超過 120 秒、報價寫入為 0 或一分 K 寫入為 0 時，receipt 不得標記 complete。

## 四、自然時槽證據

已確認三個連續自然分鐘自動執行：

| Asia/Taipei 時間 | 結果 | 報價寫入 | 一分 K 寫入 |
|---|---:|---:|---:|
| 11:44 | exit 0 | 561 | 1,314 |
| 11:45 | exit 0 | 562 | 1,300 |
| 11:46 | exit 0 | 564 | 1,230 |

最終閉環驗收輪：

```text
quotes_written=562
candles_written=1212
fast_sync_age_seconds=35
```

## 五、全量唯讀驗收

```text
contract_version=4.1.0
trade_date=2026-09-09
canonical_run_id=fugle_daytrade_source:20260909:canonical
Mother Pool rows=720
unique symbols=720
anon pagination=500+220
HTTP status=200
source_freshness same_trade_date_current=720
quote_gap_count=0
intraday_1m_gap_count=1
quote_and_1m_available_count=719
```

匿名角色以正式頁大小 500 完整讀取，共 2 頁（500 + 220）；兩頁皆為 HTTP 200。唯一一筆一分 K 缺口保留為真實 `DATA_GAP`，未以舊資料或偽造時間補值。

Supabase 唯讀入口：

```text
水源：public.v_fugle_daytrade_mother_pool_v4_1
Receipt：public.v_fugle_daytrade_mother_pool_receipt_v4_1
Formal Gate：public.v_fugle_daytrade_canonical_gate
```

## 六、DATA_GAP 規則

快速同步只寫入富果確實產生的新事件。無成交、未形成新一分 K 或事件超過 120 秒的個股，仍必須標示 `DATA_GAP`。

因此：

- 不要求無成交個股偽造即時報價。
- 不以昨日資料替代。
- 不把總成交量偽裝成內外盤。
- Mother Pool 成員資格完整與單檔盤中行情可用性分開驗收。
- 接收端只能對報價及一分 K 均符合自身時效要求的個股執行盤中策略。

## 七、均線契約

Mother Pool 與 Mother Pool Gate：

```text
短均線方向：MA5 > MA10 > MA20
禁用：MA30、MA35、MA58
```

接收端自己的獨立策略可保留原有指標，但不得將 MA30／35／58 宣稱為 Mother Pool 欄位，也不得用它們反向修改母池資格或母池 receipt。

## 八、最終閉環結果

```text
runner_ok=true
fast_supabase_sync=true
verifier_ok=true
receipt_written=true
closed_loop_ok=true
failed_checks=[]
first_blocker=null
receipt_status=complete
```

正式 commit：

```text
程式修復：54b35916bf070af6695e52de58c1f15021844cf2
回報文件：9b88f03bf6d7e82d3c631220e97e06a7f2b4a908
```

最終 Supabase receipt：

```text
verification_run_id=mother_pool_v4_1:20260909:20260909035326677
complete=true
mother_pool_rows=720
failed_checks=[]
first_blocker=null
```

結論：Supabase 即時報價與一分 K 已由完整 runner 解耦，並以既有工作日 Writer 排程每分鐘更新；修復已納入唯一正式 verifier 與 receipt 契約。
