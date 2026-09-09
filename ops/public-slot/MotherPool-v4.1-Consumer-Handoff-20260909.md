# Mother Pool v4.1 當沖程式唯讀交接守則

版本日期：2026-09-09  
時區：Asia/Taipei  
契約版本：`4.1.0`  
模式：`runner → verifier → receipt`

## 1. 唯一正式水源

跨電腦接收端只讀 Supabase：

- 母池清單：`public.v_fugle_daytrade_mother_pool_v4_1`
- 即時報價底層：`public.fugle_daytrade_quotes_live`
- 正式 1 分 K 狀態：`public.v_fugle_daytrade_intraday_1m_status`
- Source Gate：`public.v_fugle_daytrade_canonical_gate`
- 閉環 receipt：`public.v_fugle_daytrade_mother_pool_receipt_v4_1`

Release Owner 本機可用的同內容證據：

- `C:\fuman-runtime\state\daytrade-mother-pool-delta.json`
- `C:\fuman-runtime\data\scan-receipts\daytrade-mother-pool-closed-loop-YYYYMMDD.json`

其他電腦不得把本機路徑當跨機水源，也不得直接寫入上述資料表或 view。

## 2. 身分與新鮮度硬條件

每輪讀取必須同時確認：

1. `contract_version = '4.1.0'`；其他版本一律拒收。
2. `trade_date` 等於 Asia/Taipei 當日台股交易日。
3. 全輪 `canonical_run_id` 相同且非空。
4. `source_freshness = 'same_trade_date_current'`。
5. 盤中 `quote_age_seconds <= 120`。
6. 需要 1 分 K 的策略必須確認 `intraday_1m_stale_seconds <= 120`。
7. `symbol` 必須是有效台股普通股；權證、可轉債、ETF 不得自行補入。

任一條件不成立時回報 `DATA_GAP` 或 `FAIL_CLOSED`；不得拿前一交易日、舊 receipt 或其他行情來源補成成功。

## 3. 接收端必要欄位

識別欄位：

```text
trade_date
symbol
name
market
contract_version
canonical_run_id
updated_at
```

母池與追溯欄位：

```text
mother_pool_rank
priority_reason
pool_source
pool_layer
entry_score
upgrade_score
source_flags
source_run_ids
priority_reasons
source_updated_at
source_freshness
```

盤中行情欄位：

```text
price
open_price
previous_close
change_percent
total_volume
trade_value
quote_seen_at
quote_age_seconds
latest_candle_time
intraday_1m_stale_seconds
```

短均線欄位：

```text
ma5
ma10
ma20
ma5_ma10_ma20_bullish
```

`ma5_ma10_ma20_bullish=true` 的唯一公式為：

```text
MA5 > MA10 > MA20 且 MA20 > 0
```

`MA30`、`MA35`、`MA58` 及舊的 `ma5_ma10_ma35_bullish` 僅可能存在於歷史相容 view；它們在 Mother Pool 與 Mother Pool Gate 全面禁用。接收端自己的獨立策略可保留其原策略指標，但不得宣稱那些長均線來自 Mother Pool，也不得用它們改寫母池資格或母池 receipt。

## 4. 標準讀取方式

```sql
select *
from public.v_fugle_daytrade_mother_pool_v4_1
where trade_date = ((now() at time zone 'Asia/Taipei')::date)
order by mother_pool_rank asc, symbol asc;
```

REST 正式分頁大小為每頁 `200` 筆，依 `mother_pool_rank.asc,symbol.asc` 連續讀取，直到回傳少於 200 筆；720 檔應為 4 頁。讀取後以 `trade_date + symbol` 去重。不得只取固定 Top 40；程式可依自身策略縮小掃描範圍，但不可反向改寫 Mother Pool。

## 5. 接收端執行順序

1. 讀取 `v_fugle_daytrade_canonical_gate` 與母池 v4.1 view。
2. 驗證版本、交易日、run id、新鮮度與必要欄位。
3. 建立本輪唯讀 symbol 集合。
4. 依接收端策略計算；母池欄位只作水源與優先權，不等於正式進場訊號。
5. 接收端自行產生 runner receipt，記錄接受的 `contract_version`、`canonical_run_id`、symbol 數及資料時間。
6. verifier 比對同交易日、同 run id 與來源新鮮度。
7. 只有 runner 與 verifier 均通過，receipt 才能標記 `complete`。

## 6. 禁止事項

- 不得寫入或刪除 Mother Pool、quotes、1 分 K 與 Source Gate。
- 不得用 `/88`、終端顯示順序或舊 Top 40 view 取代正式母池。
- 不得自行猜測缺少欄位。
- 不得接受 `4.0.0` 或更舊契約。
- 不得使用 MA30、MA35、MA58 或舊 MA5/10/35 判斷。
- 不得將通知成功視為策略或資料閉環成功。

## 7. 正式驗收

Release Owner 唯一正式 verifier：

```text
scripts/verify-daytrade-mother-pool-closed-loop.js
```

正式成功條件：

```text
runner_ok=true
verifier_ok=true
closed_loop_ok=true
failed_checks=[]
receipt_written=true
```

跨機 receipt 必須從 `public.v_fugle_daytrade_mother_pool_receipt_v4_1` 依同一 `trade_date + canonical_run_id` 讀取最新一筆，並要求 `complete=true`。

所有舊 Mother Pool verifier 已退役且不得恢復或引用；接收端只能使用上述唯一正式閉環 verifier 契約。
