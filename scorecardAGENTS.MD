# 成績單 AGENTS.MD

## 目標

成績單 `/88` 必須從正式 Supabase source table 產生，不再依賴 Google Sheet、Streamlit，或默默回退到舊 DuckDB。

正式水管：

```text
每日成績單計算結果
  -> public.trade_records
  -> public.strategy_daily_summary
  -> scripts/export-scorecard-supabase-source.js
  -> C:\fuman-terminal\data\scorecard-latest.json
  -> scorecard_latest Supabase snapshot
  -> /api/scorecard
  -> /88
```

## 固定 Supabase Source Contract

正式 project：

```text
https://cpmpfhbzutkiecccekfr.supabase.co
```

必要 DB 物件：

| object | type | purpose |
| --- | --- | --- |
| `public.trade_records` | table | 每筆成績單交易 / 訊號紀錄 |
| `public.strategy_daily_summary` | table | 每日每策略摘要 |
| `public.v_scorecard_source_health` | view | source readiness / freshness health |

建表 SQL：

```text
C:\fuman-terminal\ops\public-slot\ScorecardSourceContract.sql
```

若要手動確認：

```sql
select
  table_schema,
  table_name,
  table_type
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'trade_records',
    'strategy_daily_summary',
    'v_scorecard_source_health'
  )
order by table_name;
```

必須看到 3 列：

```text
strategy_daily_summary    BASE TABLE
trade_records             BASE TABLE
v_scorecard_source_health VIEW
```

## 權限契約

`service_role` 必須可讀寫 source tables：

```sql
grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete
on public.trade_records
to service_role;

grant select, insert, update, delete
on public.strategy_daily_summary
to service_role;

grant select
on public.trade_records
to anon, authenticated;

grant select
on public.strategy_daily_summary
to anon, authenticated;

grant select
on public.v_scorecard_source_health
to anon, authenticated, service_role;

grant execute
on function public.prune_trade_records()
to service_role;

select pg_notify('pgrst', 'reload schema');
```

若 REST 回：

```text
permission denied for table trade_records
```

代表缺 `insert/update` 權限。

若 REST 回：

```text
Could not find the table public.trade_records in the schema cache
```

代表 SQL 沒套到 terminal 正在讀的 project，或 PostgREST schema 尚未 reload。

## 必要欄位

### `public.trade_records`

| column | required | meaning |
| --- | --- | --- |
| `record_id` | yes | primary key |
| `record_date` | yes | 成績日期 |
| `strategy` | yes | 策略名稱 |
| `ticker` | yes | 股票代號 / 標的代號 |
| `name` | no | 股票名稱 |
| `entry_time` | no | 進場時間 |
| `entry_price` | no | 進場價 |
| `high_price` | no | 當日高點 / 可評估高點 |
| `pnl` | no | 報酬或保守成績值 |
| `source` | yes | source contract |
| `reason` | no | 訊號原因 |

### `public.strategy_daily_summary`

| column | required | meaning |
| --- | --- | --- |
| `summary_date` | yes | 摘要日期 |
| `strategy` | yes | 策略名稱 |
| `signals` | no | 訊號筆數 |
| `backtestable` | no | 可回測筆數 |
| `wins` | no | 勝筆 |
| `losses` | no | 敗筆 |
| `flats` | no | 平手 / 未結算 |
| `win_rate_pct` | no | 勝率 |
| `total_pnl` | no | 總成績 |
| `avg_pnl` | no | 平均成績 |
| `max_profit` | no | 最大獲利 |
| `max_loss` | no | 最大虧損 |
| `status` | no | `complete` / `stale` / `partial` |
| `note` | no | 備註 |
| `source` | yes | source contract |

Primary key:

```text
(summary_date, strategy)
```

## Health View

查詢：

```sql
select * from public.v_scorecard_source_health;
```

必看欄位：

| column | meaning |
| --- | --- |
| `status` | `ready` / `not_ready` / `stale` / `failed` |
| `latest_record_date` | `trade_records` 最新日期 |
| `latest_summary_date` | `strategy_daily_summary` 最新日期 |
| `record_count` | source records 總筆數 |
| `summary_count` | daily summary 總筆數 |
| `recent_record_count` | 近 2 天 records |
| `recent_summary_count` | 近 2 天 summaries |
| `missing_record_source_count` | records 缺 source 數 |
| `missing_summary_source_count` | summary 缺 source 數 |
| `reason` | readable health reason |

Ready 條件：

```text
status = ready
latest_record_date within 2 days
latest_summary_date within 2 days
record_count > 0
summary_count > 0
missing source count = 0
```

## 現況基準

已完成：

| item | result |
| --- | --- |
| Supabase source tables | ready |
| REST visibility | ready |
| source write permission | ready |
| `v_scorecard_source_health` | ready |
| `scorecard_latest` snapshot | published |
| `/api/scorecard` | reads Supabase snapshot |
| `/88` chain | verified |

目前最新狀態：

```text
latest_record_date = 2026-06-26
latest_summary_date = 2026-06-26
record_count = 1662
summary_count = 22
recent_record_count = 374
recent_summary_count = 7
status = ready
reason = ready
```

## 今日 Terminal Complete Run Source

因原始 DuckDB 成績單只到 `2026-06-22`，已補一條今日 source：

```text
C:\fuman-terminal\scripts\generate-terminal-scorecard-source.js
```

輸出：

```text
C:\fuman-terminal\data\scorecard-terminal-current.json
```

來源：

| source API | strategy label |
| --- | --- |
| `/api/open-buy-latest` | `策略1開盤入成績單` |
| `/api/strategy3-latest` | `策略3隔日沖成績單` |
| `/api/strategy4-latest` | `策略4成績單` |
| `/api/strategy5-latest` | `策略5成績單` |
| `/api/institution-latest` | `買賣超成績單` |
| `/api/cb-detect-latest` | `CB成績單` |
| `/api/warrant-flow-latest` | `權證成績單` |

這批資料的 source：

```text
terminal-complete-run-scorecard
```

注意：

```text
沒有已結算績效的項目，pnl 保守設為 0。
這是「今日訊號成績單 source」，不是假裝已結算獲利。
```

最後一次產生結果：

```text
latestDate = 2026-06-26
records = 374
dailyRows = 7
```

## 寫入 Supabase Source

工具：

```text
C:\fuman-terminal\scripts\scorecard-source-supabase-ops.js
```

Probe REST 是否可見：

```powershell
Set-Location -LiteralPath C:\fuman-terminal
node --use-system-ca scripts\scorecard-source-supabase-ops.js probe
```

回填舊 `data\scorecard-latest.json`：

```powershell
Set-Location -LiteralPath C:\fuman-terminal
node --use-system-ca scripts\scorecard-source-supabase-ops.js backfill
```

回填今日 terminal complete-run source：

```powershell
Set-Location -LiteralPath C:\fuman-terminal
node --use-system-ca scripts\scorecard-source-supabase-ops.js backfill --source-file=C:\fuman-terminal\data\scorecard-terminal-current.json
```

查 health：

```powershell
Set-Location -LiteralPath C:\fuman-terminal
node --use-system-ca scripts\scorecard-source-supabase-ops.js health
```

## 發布 Snapshot

正式 runner：

```text
C:\fuman-terminal\run-scorecard-snapshot.ps1
```

執行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\fuman-terminal\run-scorecard-snapshot.ps1
```

流程：

```text
export Supabase source
publish scorecard_latest
verify scorecard
```

成功輸出範例：

```text
latestDate: 2026-06-26
rows: 1000
cacheSource: supabase-snapshot
missingRecordSources: 0
missingDailySources: 0
```

## 驗證

驗證 snapshot 與 live API：

```powershell
Set-Location -LiteralPath C:\fuman-terminal
node --use-system-ca scripts\verify-scorecard-snapshot.js
```

驗證完整 resource chain：

```powershell
Set-Location -LiteralPath C:\fuman-terminal
node --use-system-ca scripts\verify-scorecard-resource-chain.js
```

必須看到：

```text
[scorecard-chain] ok
```

目前已通過：

```text
/api/scorecard latestDate = 2026-06-26
/api/scorecard cacheSource = supabase-snapshot
/88 resource chain = ok
```

## Freshness Gate

預設不允許 stale。

`verify-scorecard-resource-chain.js` 要求：

```text
latestDate within 2 days
```

只有除錯時可暫時：

```powershell
$env:FUMAN_SCORECARD_ALLOW_STALE = "1"
```

正式狀態不可用 stale 假裝通過。

## 不可做的事

不要用以下方式假裝修好：

- Google Sheet
- Streamlit
- 只改 `data\scorecard-latest.json`
- 只發布舊 DuckDB fallback
- 只 bump version
- 只 redeploy Vercel
- 跳過 `v_scorecard_source_health`
- 跳過 `verify-scorecard-resource-chain.js`

## 正確維護順序

1. 產生每日成績單結果。
2. 寫入 `public.trade_records`。
3. 寫入 `public.strategy_daily_summary`。
4. 確認 `v_scorecard_source_health.status = ready`。
5. 跑 `run-scorecard-snapshot.ps1`。
6. 跑 `verify-scorecard-snapshot.js`。
7. 跑 `verify-scorecard-resource-chain.js`。
8. 確認 `/api/scorecard` 與 `/88` 顯示新日期。

## 目前下一步建議

把 `generate-terminal-scorecard-source.js` 接進每日成績單排程，讓每日 complete run 後自動：

```text
generate terminal scorecard source
-> backfill Supabase source tables
-> run-scorecard-snapshot.ps1
-> verify-scorecard-resource-chain.js
```

這樣 `/88` 就會每天讀正式 Supabase source，而不是等手動回填。
