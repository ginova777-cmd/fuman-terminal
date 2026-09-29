# Mother Pool v4.1 接收端交接清單

版本日期：2026-09-09  
時區：Asia/Taipei  
正式契約版本：`4.1.0`  
提供端：Mother Pool／Supabase／Writer／Release Owner  
接收端：Strategy 2／3／4／5、Scanner、買賣超、Telegram 與其他唯讀策略

## 0. 統一自動接收入口

```text
lib/daytrade-canonical-water-reader.js
→ lib/daytrade-mother-pool-strategy-adapters.js
```

接收端以 `strategy2`、`strategy3_v2`、`strategy5`、`institution`、`buy_sell`、`scanner` 或 `telegram` 選擇 Adapter。Adapter 會自動讀取 Mother Pool v4.1 並套用一致的版本、交易日、canonical run 與新鮮度閘門；版本不符、跨日、錯 run 或 stale 一律 fail-closed。Strategy4 是獨立盤後日 K 策略，不是 Mother Pool 消費端，也不得被 Mother Pool Gate、欄位或 receipt 影響。

整體接收契約驗證：

```text
npm run verify:daytrade-mother-pool-consumer-adapters
```

## 1. 接收前先確認

- [ ] 今日為台股交易日；以 `public.market_calendar` 為正式證據，不只看本機星期。
- [ ] `trade_date` 是今日 Asia/Taipei 交易日。
- [ ] `canonical_run_id=fugle_daytrade_source:YYYYMMDD:canonical`。
- [ ] `contract_version=4.1.0`。
- [ ] `source_freshness=same_trade_date_current`。
- [ ] 所有分頁使用同一組 `trade_date + canonical_run_id + contract_version`。
- [ ] 任一必要識別欄位缺少時 fail-closed，不退回舊 view。

## 2. 唯一 Mother Pool 成員入口

```text
public.v_fugle_daytrade_mother_pool_v4_1
```

正式查詢條件：

```text
trade_date=eq.YYYY-MM-DD
canonical_run_id=eq.fugle_daytrade_source:YYYYMMDD:canonical
contract_version=eq.4.1.0
order=symbol.asc
limit=200
offset=0,200,400...
```

規則：

- 使用 `trade_date + symbol` 去重。
- 分頁固定按 `symbol.asc`；不得按盤中會變動的 rank 分頁。
- 讀到最後一頁少於 200 筆才停止。
- 同輪不得混入不同 `canonical_run_id`。
- 舊 `v_fugle_daytrade_mother_pool`、priority view、Top 40、previous-good 只可做 diagnostic，不具正式決策權。

## 3. v4.1 必接欄位

### 3.1 身分與追溯

```text
contract_version
trade_date
canonical_run_id
writer_run_id
generation_id
symbol
name
market
source_name
source_trade_date
source_updated_at
source_freshness
updated_at
```

### 3.2 入池、排序與來源

```text
mother_pool_rank
priority_rank
mother_pool_score
priority_score
entry_score
upgrade_score
priority_reason
priority_reasons[]
mother_reason
mother_source
pool_source
pool_layer
source_flags[]
source_run_ids[]
mother_readiness_status
is_formal_entry_eligible
```

布林欄位只接受 JSON boolean `true`；不得用非空字串判定為真。

### 3.3 行情摘要與新鮮度

```text
price
open_price
previous_close
high_price
low_price
change_percent
total_volume
trade_value
avg_volume5
quote_trade_date
quote_seen_at
quote_age_seconds
last_trade_time
last_trade_age_seconds
latest_candle_time
intraday_1m_stale_seconds
mother_updated_at
pool_updated_trade_date
```

Mother Pool 摘要可用於成員盤點與排序；策略要發布事件時，仍須依第 5 節讀正式 quote／K 線證據。

### 3.4 產業與快速注入

```text
sector_name
sector_strength_score
sector_member_active_count
industry_signal_fast_injected
industry_signal_fast_inject_industries[]
```

`industry_signal_fast_injected=true` 只表示產業事件已快速注入母池，不等於 Formal Gate 放行。

### 3.5 允許的短均線

```text
ma5
ma10
ma20
ma5_ma10_ma20_bullish
```

Mother Pool／Gate 只能讀取上述正式短均線欄位；未列入本契約的移動平均欄位不得查詢、映射、回退或輸出。其他既有策略的獨立指標不屬於 Mother Pool 水源契約。

## 4. 交易日與全域 Gate

### 4.1 交易日

正式入口：

```text
public.market_calendar
```

至少驗證：

```text
market=TW
trade_date=今日
is_open=true
calendar_contract=market-calendar-contract-v1
```

非交易日應回傳 `skipped/market_closed`、零正式副作用，不得把 previous-good 宣稱為今日資料。

### 4.2 Gate

```text
public.v_fugle_daytrade_canonical_gate
public.v_fugle_daytrade_unattended_gate_status
public.source_status
```

接收端必須分離：

```text
receipt_incomplete
global_formal_gate_blocked
symbol_data_gap
```

單檔缺口只隔離該檔；全域 Gate blocked 才阻擋整批正式發布。

## 5. 附加水源

### 5.1 即時 quote

```text
public.fugle_daytrade_quotes_live
```

以 `trade_date + symbol` 對接；正式事件發布前確認 `quote_seen_at`／`last_trade_time`。無新市場事件可標記 `NO_NEW_MARKET_EVENT`，不得算成 Writer 錯誤。

### 5.2 一分 K

```text
RPC public.get_fugle_daytrade_intraday_1m_latest_n
```

請求：

```json
{
  "symbols": ["2330", "2454"],
  "bars_per_symbol": 61
}
```

每根至少保留：

```text
trade_date
symbol
candle_time
open
high
low
close
volume
synthetic
volume_strategy_usable
updated_at
```

規則：`synthetic` 必須為 false；`volume_strategy_usable=null/false` 時，成交量策略必須逐檔 `DATA_GAP`。

### 5.3 五分 K

```text
public.v_fugle_intraday_5m_verification_readback
public.v_fugle_intraday_5m_readback
public.v_fugle_intraday_5m_history_readback
```

先讀 complete receipt，再用相同 `trade_date + run_id` 讀技術欄位。即時 cache 只保證目前 run；歷史 replay 必須讀 immutable history view。

五分 K僅是轉強證據，不得單獨建立 Mother Pool 或正式候選。

### 5.4 內外盤 v3

```text
public.v_fugle_daytrade_side_volume_verification_readback
public.v_fugle_daytrade_side_volume_symbol_readback
```

先取得最新 receipt，再以 `verification_run_id` 綁定逐檔結果。規則：

```text
inside_volume + outside_volume >= 2000 lots
outside_volume / inside_volume >= 2
side_volume_unit=lots
total_volume 不得替代 inside/outside
```

只有兩項數值門檻、同交易日／同 canonical run 的 120 秒新鮮度，以及今日 Mother Pool v4.1 成員資格同時成立，才可建立外盤強勢雷達事件。四項缺一時不得通知，資料不足須回報 `DATA_GAP_SIDE_VOLUME`。

逐檔狀態：

```text
READY_GE_2000_LOTS
READY_BELOW_2000_LOTS
DATA_GAP
DIAGNOSTIC_ONLY
BLOCKED_COMMON
```

### 5.5 前一交易日 OHLC

```text
public.strategy4_daily_ohlcv_view
```

必須按正式交易日完整分頁。缺資料時標記 `DATA_GAP_PREVIOUS_SESSION_OHLC`；不得用 bounded 分鐘 K 推算成 PASS。

## 6. 建議接收順序

```text
market_calendar
  -> source_status / canonical Gate
  -> Mother Pool v4.1 全量分頁
  -> 驗證契約、日期、canonical run、新鮮度
  -> 依策略事件標的讀 quote
  -> 依策略需求讀 1m RPC / 5m / 內外盤 / daily OHLC
  -> 單檔隔離
  -> 策略自身 Gate
  -> runner receipt
  -> verifier
  -> delivery receipt（如適用）
```

不得由下游反向改寫 Mother Pool、Gate 或上游 receipt。

## 7. 接收端最小驗收

- [ ] anon HTTP 200。
- [ ] 母池完整分頁可讀完。
- [ ] `symbol` 唯一，無跨頁重複或遺漏。
- [ ] 全列 `contract_version=4.1.0`。
- [ ] 全列 `trade_date=今日`。
- [ ] 全列為同一 `canonical_run_id`。
- [ ] 全列 `source_freshness=same_trade_date_current`。
- [ ] 必要欄位缺少時逐檔 `DATA_GAP`。
- [ ] 不引用舊 Mother Pool view、Top 40 或 previous-good 作正式 fallback。
- [ ] Mother Pool／Gate 只使用契約列出的正式短均線欄位。
- [ ] runner、verifier、receipt 的交易日、run id 與筆數一致。
- [ ] 零命中可以 complete，但不得偽造訊號或通知。

## 8. 接收端回報格式

```text
consumer_name=
consumer_commit=
contract_version=4.1.0
trade_date=
canonical_run_id=
mother_pool_http_status=
mother_pool_rows=
mother_pool_pages=
unique_symbols=
quote_valid_rows=
intraday_1m_valid_rows=
symbol_data_gap_rows=
global_formal_gate_blocked=
receipt_incomplete=
runner_status=
verifier_ok=
receipt_written=
failed_checks=[]
first_blocker=
```

只有 `runner + verifier + receipt` 均成功且無未交代 blocker，接收端才能回報該策略閉環完成。

## 9. 禁止事項

- 禁止讀舊 Mother Pool view 作正式來源。
- 禁止把昨日資料改標成今日。
- 禁止偽造新鮮度或硬改 Gate。
- 禁止以單筆查詢成功代替全池驗收。
- 禁止用盤中 order book 冒充盤前試撮簿。
- 禁止用 total volume 代替內外盤分類量。
- 禁止把 `DATA_GAP` 顯示為「沒有訊號」。
- 禁止 Viewer／接收策略啟動 Writer 或改寫正式資料。
