# 當沖專用水源交接手冊 2026-07-02

本文件是 release owner 交接用。目標是把 `fugle_daytrade_source` 做成當沖 / Strategy1 / Strategy3 專用水源，不再跟展示水源、AI、熱力圖、其他策略互相搶 quota。

## 總判定

目前是 code readiness / SQL contract partial ready。

不是 production YES。

不是全 A。

目前不能正式當沖進場，因為 live quote freshness 還沒有跑出證據。

## Release Owner 硬規則

1. 不從 dirty worktree deploy。
2. 不 push main。
3. 不 deploy。
4. 不碰 `C:\fuman-terminal` 當 source；它只能是 production mirror。
5. 不啟動 scanner / writer / receipt / snapshot，除非 release owner 明確批准。
6. 不因為 SQL 成功、API 200、單一 dry-run PASS 就宣告 unattended YES。
7. 不用 SQL 把 stale quote 改成 fresh。
8. A gate 只能由 live writer 實際刷新後產生。

## 目前 Git 狀態

Branch:

```text
release-daytrade-source-priority-bootstrap-20260702
```

最新已推 commit:

```text
124ff924 Use market quote timestamps for daytrade freshness
```

前一個重要 commit:

```text
794350f9 Use readiness fallbacks for daytrade source gates
```

本輪沒有做：

```text
沒有 push main
沒有 deploy
沒有 npm run deploy
沒有 vercel --prod
沒有碰 C:\fuman-terminal
沒有啟動正式 writer
沒有啟動 scanner
沒有宣告 production YES
```

正式驗收固定 SHA 仍以 release owner 指定為準：

```text
9e4ed17d50e9e1f71ba12fd359fcf55f8963ad51
```

## 已建立 / 已確認的 SQL Contract

Supabase project:

```text
https://supabase.com/dashboard/project/cpmpfhbzutkiecccekfr/sql/new
```

已建立或應存在：

```text
source_status row: source_name = fugle_daytrade_source
fugle_daytrade_source_speed_scorecard
fugle_daytrade_priority_symbols
fugle_daytrade_quotes_live
fugle_daytrade_intraday_1m
fugle_daytrade_daily_volume_avg
fugle_daytrade_futopt_quotes_live
v_fugle_daytrade_intraday_1m_status
v_fugle_daytrade_intraday_1m_coverage_stats
v_fugle_daytrade_stock_future_live_contract
v_fugle_daytrade_stock_future_contract_health
v_fugle_daytrade_stock_future_scorecard
v_fugle_daytrade_source_contract_health
```

## 目前已是 A 的項目

### 個股期貨合約 mapping

最新使用者回報：

```text
contract_rows = 222
symbol_rows = 222
future_symbol_rows = 222
last_price_rows = 222
change_percent_rows = 222
total_volume_rows = 222
contract_mapping_grade = A
```

判定：

```text
個股期貨合約完整度 = A
```

### 1 分 K MA readiness

read-only 查詢結果：

```text
ready_ma20_continuous = 1614
ready_ma35_continuous = 1614
```

判定：

```text
MA20 / MA35 readiness = A
```

注意：這不是 live 1 分 K freshness A。這只代表 historical / continuous readiness 足夠。

## 目前不是 A 的項目

### 1. 主水源狀態不是 A

目前：

```text
source_status = stopped
daytrade_gate_grade = D
production_unattended = NO
```

原因：

```text
dedicated writer 尚未正式 apply / 長跑
source_status 仍是 bootstrap row
```

要變 A：

```text
status = ok
daytrade_gate_grade = A
daytrade_source_speed_ok = true
source_status.updated_at 持續刷新
```

### 2. Quote fresh 不是 A

目前：

```text
fresh_quotes_120s = 0
fresh_quote_coverage_120s = 0
quote_age_seconds = 999999
actual_quote_speed_per_sec = 0
```

原因：

```text
沒有 dedicated quote writer 實際刷新 fugle_daytrade_quotes_live
```

要變 A：

```text
priority_fresh_quote_coverage_120s >= 0.95
quote_age_seconds <= 90
selected_symbols_fresh_ok = true
fresh_quotes_120s / full market coverage 作為 scorecard 追蹤
```

注意：writer 已修正成用市場 quote timestamp 判斷 freshness，不用 `quote_seen_at=now` 偽裝新鮮。

### 3. Priority pool fresh 不是 A

目前 live source row：

```text
priority_symbols = 0
priority_pool_symbols = 0
priority_fresh_quotes_120s = 0
priority_fresh_quote_coverage_120s = 0
```

dry-run code readiness 已可產生：

```text
priorityPoolSymbols = 500
```

要變 A：

```text
priority_pool_symbols >= 300
priority_fresh_quote_coverage_120s >= 0.95
selected_symbols_fresh_ok = true
```

### 4. Scanner 放行不是 A

目前：

```text
scanner_can_run_quote_only = false
scanner_can_run_opening = false
```

要變 A：

```text
scanner_can_run_quote_only = true
scanner_can_run_opening = true
```

依賴：

```text
quote fresh A
priority pool A
daily_volume_status = ready
MA20 / MA35 readiness A
08:45 後 futopt mapping/live quote ready
09:00 後 intraday_1m_stale_seconds <= 120
```

### 5. 1 分 K live freshness 不是 A

目前：

```text
today_1m_symbols = 155
today_1m_rows = 1692
intraday_1m_stale_seconds = 16436
```

判定：

```text
MA readiness A
live 1m freshness 不是 A
```

要變 A：

```text
09:00 後 intraday_1m_stale_seconds <= 120
preferred <= 60
today_1m_symbols 持續上升
quote-derived 1m 不阻塞 quote writer
```

### 6. 個股期貨 live quote 不是 A

目前：

```text
contract_mapping_grade = A
fresh_rows_180s = 0
fresh_rows_300s = 0
live_quote_grade = after_daytrade_window_stale_not_proof
```

判定：

```text
合約 mapping A
live futopt quote freshness 不是 A
```

要變 A：

```text
08:45-09:10 fresh_rows_180s >= floor(contract_rows * 0.95)
222 contracts => 至少 211 rows fresh
```

### 7. Production unattended 不是 A

目前：

```text
production_unattended = NO
```

要變 A：

```text
SQL contract OK
dedicated writer live OK
read-only verifier gateGrade=A
連續 15-30 分鐘無 active cooldown / 無近期 429
deploy hygiene clean
production evidence captured
```

## 明天作戰時間表

### 06:00-08:29 暖機

目標：

```text
daily_volume_status = ready
MA20 / MA35 readiness >= 1500
priority pool 可建立 300-500 檔
```

不做：

```text
不讓 strategy scanner 補打 Fugle
不讓 1m backfill 卡 quote writer
不跑全市場暴衝
```

### 08:30-08:44 盤前準備

目標：

```text
priority_pool_symbols >= 300
avg_volume5_eligible >= 300
daily_volume_status = ready
ready_ma20_continuous >= 1500
ready_ma35_continuous >= 1500
```

### 08:45-09:10 Opening Boost

目標：

```text
priority_fresh_quote_coverage_120s >= 0.95
quote_age_seconds <= 90
scanner_can_run_quote_only = true
scanner_can_run_opening = true
futopt fresh_rows_180s >= 211
```

速度：

```text
priority first
batch_size = 40
concurrency = 1
target_batch_interval_seconds = 3.2
429 => priority-only + cooldown
```

### 09:00-09:35 Live 1m

目標：

```text
intraday_1m_stale_seconds <= 120
preferred <= 60
today_1m_symbols 上升
quote writer 最高優先
direct 1m 只能補 priority / hot symbols
```

### 09:35 後

目標：

```text
regular daytrade gate A
priority pool 持續 fresh
full market coverage 逐步補
source_status.status = ok
```

## 驗收指令

### Code readiness

```text
npm run verify:daytrade-source-writer
node --check scripts/run-daytrade-source-writer.js
git diff --check
```

### Dry-run

```text
npm run daytrade-source:writer:dry-run
```

預期：

```text
不寫 Supabase
不 fetch Fugle
盤後仍 D
readyMa20 / readyMa35 / futoptMapped 應有值
```

### Read-only source verifier

```text
npm run verify:daytrade-source-speed -- --json-only
```

目前盤後預期：

```text
gateGrade = D
sourceStatus = stopped
formalEntryAllowed = false
stopNewSignals = true
```

明天 A 預期：

```text
gateGrade = A
sourceStatus = ok
formalEntryAllowed = true
stopNewSignals = false
priorityFreshQuoteCoverage120s >= 0.95
quoteAgeSeconds <= 90
scannerCanRunOpening = true
```

### SQL spot checks

```sql
select *
from public.v_fugle_daytrade_intraday_1m_coverage_stats;

select *
from public.v_fugle_daytrade_stock_future_scorecard;

select source_name, status, updated_at, message, payload
from public.source_status
where source_name = 'fugle_daytrade_source';
```

## Writer 啟動原則

正式 apply 只能在 release-owner window 啟動。

指令：

```text
npm run daytrade-source:writer
```

或：

```text
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ops/public-slot/Run-DaytradeSourceWriter.ps1 -Apply
```

啟動前必須確認：

```text
只有一個 dedicated daytrade writer
shared source writer 不可被當成 daytrade source authority
strategy scanner 只讀 Supabase
scanner 不補打 Fugle
沒有 active 429 cooldown
```

## 不可接受的假 A

以下都不能算 A：

```text
SQL 手動把 daytrade_gate_grade 改 A
用 quote_seen_at=now 取代市場 quote timestamp
盤後抓舊 quote 再宣告 fresh
shared source coverage 直接外推 daytrade source A
只看 API 200
只看單一 PASS
只看 contract rows，不看 live freshness
```

## A Gate 最終條件

正式當沖 A 需要全部成立：

```text
source_status.status = ok
daytrade_gate_grade = A
daytrade_source_speed_ok = true
gate_mode = priority_first
priority_pool_symbols >= 300
priority_fresh_quote_coverage_120s >= 0.95
selected_symbols_fresh_ok = true
quote_age_seconds <= 90
daily_volume_status = ready
ready_ma20_continuous >= 1500
ready_ma35_continuous >= 1500
scanner_can_run_quote_only = true
scanner_can_run_opening = true
08:45 後 futopt live quote fresh >= 95%
09:00 後 intraday_1m_stale_seconds <= 120
rate_limit_status != cooldown
last_429_age_seconds > 90
read-only verifier PASS
```

## 交接結論

目前可交付：

```text
架構方向 OK
SQL contract partial OK
個股期貨 mapping A
MA20 / MA35 readiness A
writer 防假 A 修正 OK
```

目前不可交付：

```text
當沖實戰 A
production unattended YES
scanner opening true
quote fresh A
futopt live freshness A
1m live freshness A
```

下一步：

```text
明天 06:00 暖機
08:30 建 priority pool
08:45 啟動 dedicated writer opening boost
09:00 驗 live 1m freshness
09:10-09:35 連續驗 A gate
```

沒有完整 live evidence 前，總管結論維持：

```text
NO / PARTIAL
```
