# 成績單 AGENTS.MD

## 目標

成績單 `/88` 是正式公開成績單，不可再依賴 Google Sheet、Streamlit、舊 DuckDB、舊 static JSON，或任何會默默回退到舊日期的快取。

正式水管：

```text
各策略 latest complete/live source
  -> scripts/generate-terminal-scorecard-source.js
  -> C:\fuman-runtime\data\scorecard-terminal-current.json
  -> scripts/scorecard-source-supabase-ops.js
  -> public.trade_records
  -> public.strategy_daily_summary
  -> scripts/export-scorecard-supabase-source.js
  -> C:\fuman-terminal\data\scorecard-latest.json
  -> scripts/publish-scorecard-snapshot.js
  -> scorecard_latest Supabase snapshot
  -> /api/scorecard?date=YYYY-MM-DD
  -> /88
```

`/88` 是顯示層；資料正確性以 `/api/scorecard`、Supabase source tables、`scorecard_latest` snapshot、以及 E2E 驗證共同閉環。

成績單歷史規格：

```text
每天 14:00 產出的「當天 /88 顯示內容」必須存入 Supabase。
最多保留最近 30 日。
/api/scorecard 預設只回最新日。
/api/scorecard?date=YYYY-MM-DD 只回指定日期。
/api/scorecard 必須另外回 historyDates，供 /88 日期下拉使用。
/88 切換歷史日期時才拉該日期資料，不一次渲染 30 天。
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

手動確認：

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

必須看到：

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

常見錯誤：

| error | meaning |
| --- | --- |
| `permission denied for table trade_records` | service role 缺 `insert/update/delete` |
| `Could not find the table public.trade_records in the schema cache` | SQL 未套到正式 project，或 PostgREST schema 尚未 reload |
| `/api/scorecard` rows 與 generator rows 不一致 | Supabase 舊同日同策略資料未清乾淨，需檢查清理邏輯 |

## 必要欄位

### `public.trade_records`

| column | required | meaning |
| --- | --- | --- |
| `record_id` | yes | primary key |
| `record_date` | yes | 成績日期 / 結算日 |
| `strategy` | yes | 策略名稱 |
| `ticker` | yes | 股票代號 / 標的代號 |
| `name` | yes for UI | 股票名稱 |
| `entry_time` | yes for UI | 進場時間 |
| `entry_price` | yes for calculation | 進場價 |
| `high_price` | yes for calculation | 成績評估高點 |
| `pnl` | yes | 原始價差，`high_price - entry_price` |
| `source` | yes | source contract |
| `reason` | yes for audit | 訊號原因與補值來源 |

### `public.strategy_daily_summary`

| column | required | meaning |
| --- | --- | --- |
| `summary_date` | yes | 摘要日期 |
| `strategy` | yes | 策略名稱 |
| `signals` | yes | 訊號筆數 |
| `backtestable` | yes | 可回測筆數 |
| `wins` | yes | 勝筆 |
| `losses` | yes | 敗筆 |
| `flats` | yes | 平手 / 未結算 |
| `win_rate_pct` | yes | 勝率 |
| `total_pnl` | yes | 原始總價差 |
| `avg_pnl` | yes | 平均原始價差 |
| `max_profit` | yes | 最大原始價差獲利 |
| `max_loss` | yes | 最大原始價差虧損 |
| `status` | yes | `complete` / `stale` / `partial` |
| `note` | no | 備註 |
| `source` | yes | source contract |

Primary key:

```text
(summary_date, strategy)
```

## 策略來源清單

`scripts/generate-terminal-scorecard-source.js` 必須納入所有正式成績單來源。

| key | source API / table | strategy label | limit / rule |
| --- | --- | --- | --- |
| `strategy1` | `/api/open-buy-latest` | `策略1開盤入成績單` | 120 |
| `strategy2` | `/api/strategy2-latest` | `策略2成績單` | 只顯示 `09:00-12:00` |
| `strategy3` | Supabase `strategy3_scan_runs/results` previous trading day | `策略3隔日沖成績單` | 來源日前一開盤日，進場 `13:00` |
| `strategy4` | `/api/strategy4-latest` | `策略4成績單` | 70 |
| `strategy5` | `/api/strategy5-latest` | `策略5成績單` | 25 |
| `institution` | `/api/institution-latest` | `買賣超成績單` | 120 |
| `warrant` | `/api/warrant-flow-latest` | `權證成績單` | 120 |
| `cb` | `/api/cb-detect-latest` | `CB成績單` | 120 |
| `realtime-radar` | `/api/realtime-radar-latest` | `即時雷達成績單` | 80 |

任何策略若只存在於 Supabase 清舊名單，但沒有出現在 `TASKS` 或正式 source override，就是未接上成績單。

## 日期規則

成績單必須能判斷交易日。

| market state | `/88` and `/api/scorecard` date |
| --- | --- |
| 正常開盤日 | 顯示當天開盤日 |
| 休市 / 週末 / 連假 | 顯示最後一個開盤日 |

`marketStatus` 必須包含：

| field | meaning |
| --- | --- |
| `isTradingDay` | 今天是否開盤 |
| `taipeiDate` | 台北今日日期 |
| `latestOpenDate` | 成績單顯示日期 |
| `batchDate` | source rows 最新日期 |
| `sourceLatestDate` | source report 最新日期 |
| `reason` | 休市 / 快取原因 |

範例：`2026-06-28` 是週日，成績單顯示最後開盤日 `2026-06-26`。

## 進場時間規則

`entry_time` 是成績單必填欄位。不可留空白。

| strategy | entry_time rule |
| --- | --- |
| 策略1開盤入 | `21:30` 初篩來源 |
| 策略2 | 從 live rows 的 `entry_time` / `entryTime` / `latestRecord` 等欄位解析，只保留 `09:00-12:00` |
| 策略3隔日沖 | 固定 `13:00` |
| 策略4 | `13:30` |
| 策略5 | `14:00` |
| 買賣超 | `14:00` |
| 權證 | `14:00` |
| CB | payload `updatedAt/generatedAt/finishedAt/timestamp` 轉台北時間，fallback `14:00` |
| 即時雷達 | 從 row timestamp / quote time 解析，fallback 不可空白 |

`verify-scorecard-ui-e2e.js` 必須檢查所有 rows `entry_time` 不為空。

## 進場價與最高價規則

| field | rule |
| --- | --- |
| `entry_price` | 成績單進場價，不可為 0 |
| `high_price` | 成績單評估高點，不可為 0 |
| `pnl` | `high_price - entry_price`，API 層保留原始價差 |

CB 特別規則：

```text
CB 進場價 = 完整掃偵測到的股價 = row.stockPrice
```

不是 CB 價格、不是 0、不是暫定溢價率。

最高價補值：

```text
fugle_quotes_latest.high
```

若 source high 缺失或低於最新 quote high，使用：

```text
max(source high, quote high, entry price)
```

補值時必須在 `reason` 補上：

```text
最高價補值=fugle_quotes_latest <high>
```

## 策略2成績單規格

策略2 source 目前 live endpoint 偵測範圍可含 `08:45-12:00`，但成績單只顯示：

```text
09:00-12:00
```

任何 `entry_time < 09:00` 或 `entry_time > 12:00` 的策略2列都不可進入 `/api/scorecard`。

E2E 必須檢查：

```text
策略2成績單 rows > 0
所有策略2 entry_time between 09:00 and 12:00
```

## 策略3隔日沖成績單規格

策略3不可用同日 latest run 直接當同日成績單。

正式規則：

```text
record_date = 成績單結算日
source_date = record_date 的前一個開盤日
entry_time = 13:00
entry_price = source_date 13:00 完整掃偵測價格
high_price = record_date 當天最高價
pnl = high_price - entry_price
```

來源：

```text
strategy3_scan_runs
strategy3_scan_results
```

查詢條件：

```text
strategy=eq.strategy3
status=eq.complete
complete=eq.true
scan_date=eq.<previous trading day>
```

策略3 row 必須可稽核來源日。若 DB 不新增 `source_date` 欄位，必須在 `reason` 補上：

```text
策略3來源日=YYYY-MM-DD
```

範例 `2026-06-26` 成績單：

| ticker | name | record_date | source_date | entry_time | entry | high | pnl |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2302 | 麗正 | 2026-06-26 | 2026-06-25 | 13:00 | 48 | 50.9 | 2.9 |
| 2308 | 台達電 | 2026-06-26 | 2026-06-25 | 13:00 | 1980 | 1980 | 0 |
| 8105 | 凌巨 | 2026-06-26 | 2026-06-25 | 13:00 | 25.15 | 25.15 | 0 |
| 8261 | 富鼎 | 2026-06-26 | 2026-06-25 | 13:00 | 255.5 | 281 | 25.5 |

E2E 必須檢查：

```text
策略3隔日沖成績單 rows > 0
所有策略3 entry_time = 13:00
所有策略3 row 有 previous trading-day source marker
策略3 source marker 不可等於 latestDate
```

## `/88` 顯示規則

API 的 `pnl` 保留原始價差，勝敗判斷也用原始價差正負。

`/88` 顯示給使用者的損益要換算為 1000 股金額：

```text
display pnl = pnl * 1000
display total pnl = summary.totalPnl * 1000
display strategy pnl = summary.byStrategy[].pnl * 1000
```

HTML 必須包含：

```text
PNL_MULTIPLIER = 1000
損益(元)
```

範例：

```text
raw pnl = 25.5
/88 display pnl = 25,500
```

不得把資料源 `pnl` 直接改成乘 1000 後的金額，否則會破壞 API 與 summary 既有勝敗檢查。乘數只屬於顯示層。

## Supabase 回填清理規則

`scripts/scorecard-source-supabase-ops.js` 在回填 terminal complete-run scorecard 前，必須清掉當天舊資料，並保留最近 30 日歷史。

清理範圍：

```text
source=terminal-complete-run-scorecard and record_date = latestDate
source=terminal-complete-run-scorecard and record_date < historyCutoff
strategy in TERMINAL_SCORECARD_STRATEGIES and record_date = latestDate
strategy in TERMINAL_SCORECARD_STRATEGIES and record_date < historyCutoff
```

daily summary 同理用：

```text
summary_date
```

目的：

```text
1. 避免同一天同策略舊列殘留。
2. 保留最近 30 日，每天可從 /88 歷史下拉切換。
3. 自動清掉 30 日以前資料，避免 Supabase 與 snapshot 長期膨脹。
```

曾發生 generator 產生 495 筆，但 Supabase snapshot 匯出 507 筆，原因就是同日舊策略3 12 筆沒有被清掉。這類錯誤必須靠「當天同策略先清再 upsert」解決，不可刪掉全部歷史。

回填成功後：

```text
generator rows = latestDate rows
exported snapshot rows = 最近 30 日 rows
/api/scorecard rows = selected date rows
/api/scorecard.historyDates = 最近 30 日有資料的日期
```

## 已停用 / 不可再依賴的舊資源

以下不可作為正式成績單 source of truth：

```text
open-buy-scorecard-source.json
realtime-radar-scorecard-latest.json
star-preopen-scorecard-source.json
strategy5-scorecard-latest.json
scorecard-terminal-current-verify.json
realtime-radar-scorecard-history
strategy5-scorecard-history
scorecard-ledger
Fuman Scorecard Snapshot 1538
Google Sheet scorecard
Streamlit scorecard
DuckDB fallback scorecard
```

如果看到這些檔案或排程被重新啟用，要停用或刪除，不能讓它們覆蓋 Supabase source chain。

## 正式執行

### 每日 14:00 runner

正式腳本：

```text
C:\fuman-terminal\run-scorecard-daily-automation.ps1
```

手動執行：

```powershell
Set-Location -LiteralPath C:\fuman-terminal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\fuman-terminal\run-scorecard-daily-automation.ps1
```

休市日若要允許沿用最後開盤日：

```powershell
Set-Location -LiteralPath C:\fuman-terminal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\fuman-terminal\run-scorecard-daily-automation.ps1 -AllowPreviousTradeDate
```

除錯時若不做 live verify：

```powershell
Set-Location -LiteralPath C:\fuman-terminal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\fuman-terminal\run-scorecard-daily-automation.ps1 -NoLiveVerify
```

流程：

```text
check TWSE trading day
generate terminal scorecard source
backfill Supabase source tables
check v_scorecard_source_health
export Supabase source snapshot
publish scorecard_latest snapshot
verify scorecard snapshot
verify scorecard resource chain
optional verify live /api/scorecard and /88
```

### 手動 source / snapshot commands

Generate terminal source：

```powershell
Set-Location -LiteralPath C:\fuman-terminal
node --use-system-ca scripts\generate-terminal-scorecard-source.js
```

Backfill Supabase：

```powershell
Set-Location -LiteralPath C:\fuman-terminal
node --use-system-ca scripts\scorecard-source-supabase-ops.js backfill --source-file=C:\fuman-runtime\data\scorecard-terminal-current.json
```

Export Supabase source：

```powershell
Set-Location -LiteralPath C:\fuman-terminal
node --use-system-ca scripts\export-scorecard-supabase-source.js
```

Publish snapshot：

```powershell
Set-Location -LiteralPath C:\fuman-terminal
node --use-system-ca scripts\publish-scorecard-snapshot.js
```

Snapshot runner：

```powershell
Set-Location -LiteralPath C:\fuman-terminal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\fuman-terminal\run-scorecard-snapshot.ps1
```

## 驗證門檻

必跑：

```powershell
Set-Location -LiteralPath C:\fuman-terminal
node --check scripts\generate-terminal-scorecard-source.js
node --check scripts\scorecard-source-supabase-ops.js
node --check scripts\verify-scorecard-ui-e2e.js
node --use-system-ca scripts\verify-scorecard-snapshot.js
node --use-system-ca scripts\verify-scorecard-resource-chain.js
node --use-system-ca scripts\verify-scorecard-ui-e2e.js
```

`verify-scorecard-ui-e2e.js` 必須檢查：

| check | required |
| --- | --- |
| `/api/scorecard` ok | true |
| rows | `> 0` |
| record_date | all equal `latestDate` |
| strategies | 包含全部 9 個正式策略 |
| 策略2 | rows > 0 and only `09:00-12:00` |
| 策略3 | rows > 0, `entry_time=13:00`, previous source marker |
| 權證 | rows > 0 |
| CB | entry_price from detected stockPrice and calculable |
| non-CB entry/high | all filled |
| required fields | no missing `record_date/strategy/ticker/name/entry_time/entry_price/high_price/pnl/reason` |
| summary | rows/wins/losses/flats/totalPnl match row data |
| `/88` HTML | scorecard hooks, result pills, decimal pnl |
| `/88` hidden panel | 不顯示資料來源 / 日期規則 / 最高價來源 / 損益公式 basis panel |
| `/88` display pnl | `PNL_MULTIPLIER=1000`, `損益(元)` |
| `/88` history selector | `scorecard-history-date`, `historyDates`, selected-date summaries |
| `/88` theme toggle | `scorecard-theme-toggle`, visible symbol only `☀` / `☾`, yellow `#facc15`, no `陽光` / `夜幕` button text |

Resource chain 必須看到：

```text
[scorecard-chain] ok
```

UI E2E 必須看到：

```text
[scorecard-ui-e2e] ok
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

## 目前閉環基準

最後已驗證正式狀態：

```text
checked date = 2026-06-28 Asia/Taipei
closed-loop rehearsal checkedAt = 2026-06-28 12:32:02 +08:00
last code deploy commit = 7bed2fda6fc9e306a21f12b835f51063b6a73a86
last code deploy url = https://fuman-terminal-21x9ngo5x-ginova777-9771s-projects.vercel.app
market state = weekend / non-trading day
latestDate = 2026-06-26
generator rows = 492
Supabase snapshot rows = 492
/api/scorecard rows = 492
summary.rows = 492
missing entry_time = 0
UI E2E = ok
resource chain = ok
production guard = ok
terminal-fast-bundle snapshotHit = true
terminal-fast-bundle snapshotFresh = true
terminal-fast-bundle partial = false
terminal-fast-bundle endpointCount = 15
```

策略分組：

| strategy | rows |
| --- | ---: |
| CB成績單 | 10 |
| 即時雷達成績單 | 80 |
| 權證成績單 | 120 |
| 策略1開盤入成績單 | 20 |
| 策略2成績單 | 46 |
| 策略3隔日沖成績單 | 4 |
| 策略4成績單 | 70 |
| 策略5成績單 | 22 |
| 買賣超成績單 | 120 |

Live source probe:

| key | rows | runId | updatedAt |
| --- | ---: | --- | --- |
| strategy1 | 20 | `strategy1-20260626-20260626133042` | `2026-06-26T13:31:59.486+00:00` |
| strategy2 | 46 | `strategy2-20260626-091024` | `2026-06-26T01:11:01.410099+00:00` |
| strategy3 latest endpoint | 12 | `strategy3-20260626-20260626123108` | `2026-06-26T12:31:08.720Z` |
| strategy4 | 70 | `strategy4-20260626-20260626122649` | `2026-06-26T12:26:49.545+00:00` |
| strategy5 | 22 | `strategy5-20260628-20260627222045` | `2026-06-27T22:20:45.802+00:00` |
| institution | 120 | `institution-20260626-20260627221922` | `2026-06-27T22:19:22.51+00:00` |
| warrant | 120 | `warrant-flow-20260626-20260627222002` | `2026-06-27T22:20:02.117+00:00` |
| cb | 10 | `cb-detect-20260628-062052` | `2026-06-27T22:20:52.082+00:00` |
| realtime-radar | 80 | `(none)` | `2026-06-26T02:42:10.869Z` |

策略3基準：

```text
runId = strategy3-20260625-20260625151019
record_date = 2026-06-26
source_date marker = 2026-06-25
entry_time = 13:00
rows = 4
```

`8261 富鼎` 顯示基準：

```text
entry_price = 255.5
high_price = 281
raw pnl = 25.5
/88 display pnl = 25,500
```

## Windows Task Scheduler Contract

正式工作名稱：

```text
Fuman Scorecard Daily Automation 1400
```

正式觸發：

```text
Daily 14:00 Asia/Taipei
```

正式 Action：

```text
powershell.exe
```

正式 Arguments：

```text
-NoProfile -ExecutionPolicy Bypass -File C:\fuman-terminal\run-scorecard-daily-automation.ps1
```

查詢排程：

```powershell
schtasks /Query /TN "Fuman Scorecard Daily Automation 1400" /V /FO LIST
```

手動觸發：

```powershell
schtasks /Run /TN "Fuman Scorecard Daily Automation 1400"
```

若存在舊排程：

```text
Fuman Scorecard Snapshot 1538
```

必須停用或刪除，不可讓它覆蓋 `scorecard_latest`。

## 部署規則

資料更新不需要 Vercel deploy；只要 source / snapshot 正確，`/api/scorecard` 會讀最新 Supabase snapshot。

只有 `/88.html`、`api/scorecard.js`、或驗證腳本等程式碼改動才需要部署。

正式程式上傳與 Vercel production deploy 不可從 `C:\fuman-terminal` 或 `C:\fuman-terminal-sync` 執行。`C:\fuman-terminal` 只能視為 production mirror / daily data runner 位置，不是正式發佈工作樹。

正式部署必須使用乾淨 GitHub worktree：

```powershell
git status --short
npm run verify:publish-gate
npm run guard:production
git add <changed files>
git commit -m "<message>"
git push origin main
npm run guard:production
vercel --prod
```

部署後檢查：

```text
/88 HTML contains scorecard-hero
/88 HTML contains PNL_MULTIPLIER = 1000
/88 HTML contains scorecard-history-date
/88 HTML does not contain scorecard-basis panel
/api/scorecard latestDate and rows match selected latestDate rows
verify-scorecard-ui-e2e.js ok
guard:production ok
```

若 production guard 擋下 `terminal-fast-bundle snapshot-only-miss`，不可跳過 guard。先跑既有 snapshot repair：

```powershell
npm run snapshot:desktop -- --remote --endpoint-snapshots --min-endpoints=10 --source=scorecard-production-guard-repair
npm run guard:production
```

確認 `snapshotHit=true`、`snapshotFresh=true`、`partial=false`、`endpointCount>=10` 後才可部署。

## 導管與接源閉環演練

每次改動成績單導管、來源、UI 顯示或驗證腳本，都要跑完整閉環。只改文件時也至少要跑 live source/API/UI guard，確認文件記載仍符合正式站。

### 1. Source contract

`scripts/generate-terminal-scorecard-source.js` 必須維持 9 個正式來源，且 `TASKS` / source override / verifier 三者一致：

| key | required source | required result |
| --- | --- | --- |
| `strategy1` | `/api/open-buy-latest` | rows > 0 |
| `strategy2` | `/api/strategy2-latest` | rows > 0, only `09:00-12:00` after scorecard filter |
| `strategy3` | `strategy3_scan_runs/results` previous trading day | rows > 0, `entry_time=13:00`, source date marker present |
| `strategy4` | `/api/strategy4-latest` | rows > 0 |
| `strategy5` | `/api/strategy5-latest` | rows > 0 |
| `institution` | `/api/institution-latest` | rows > 0 |
| `warrant` | `/api/warrant-flow-latest` | rows > 0 |
| `cb` | `/api/cb-detect-latest` | rows > 0, `entry_price=row.stockPrice` |
| `realtime-radar` | `/api/realtime-radar-latest` | rows > 0 |

### 2. Pipeline contract

閉環順序必須是：

```text
live complete source
  -> generate-terminal-scorecard-source.js
  -> scorecard-source-supabase-ops.js
  -> trade_records / strategy_daily_summary
  -> export-scorecard-supabase-source.js
  -> publish-scorecard-snapshot.js
  -> scorecard_latest
  -> /api/scorecard
  -> /88
```

不可只修最後一層 JSON 或只 redeploy Vercel。

### 3. Required rehearsal commands

```powershell
node --check scripts\generate-terminal-scorecard-source.js
node --check scripts\scorecard-source-supabase-ops.js
node --check scripts\export-scorecard-supabase-source.js
node --check scripts\verify-scorecard-resource-chain.js
node --check scripts\verify-scorecard-ui-e2e.js
npm run verify:scorecard
npm run verify:scorecard-chain
npm run verify:scorecard-ui-e2e
npm run guard:production
```

### 4. Live API invariants

`/api/scorecard` 必須同時滿足：

```text
ok = true
latestDate = selectedDate on default request
historyDates.length > 0
records.length = summary.rows
all required fields filled
all 9 strategies present
strategy2 rows only 09:00-12:00
strategy3 rows entry_time = 13:00
CB rows entry_price > 0 and not CB price
display pnl on /88 = raw pnl * 1000
```

### 5. Live UI invariants

`/88` 必須同時滿足：

```text
scorecard-history-date exists
scorecard-theme-toggle exists
theme toggle shows ☀ / ☾ only
theme toggle color includes #facc15
scorecard-basis panel does not exist
PNL_MULTIPLIER = 1000
損益(元) column exists
```

## 不可做的事

不要用以下方式假裝修好：

- 只改 `data\scorecard-latest.json`
- 只發布舊 DuckDB fallback
- 只 bump version
- 只 redeploy Vercel
- 跳過 Supabase source tables
- 跳過 `v_scorecard_source_health`
- 跳過 `verify-scorecard-resource-chain.js`
- 跳過 `verify-scorecard-ui-e2e.js`
- 讓同日同策略舊列殘留
- 讓 `entry_time` 空白
- 讓 CB 進場價變成 0 或 CB 價格
- 讓策略3使用同日 latest run 作為同日成績單
- 讓 `/88` 顯示原始價差而不是乘 1000 後金額

## 正確維護順序

1. 確認今天是否開盤；休市日用最後開盤日。
2. 產生 terminal complete-run scorecard source。
3. 檢查策略2時間窗、策略3來源日、CB entry_price、全部 entry/high/pnl。
4. 回填 `public.trade_records` 與 `public.strategy_daily_summary`，先清同日同策略舊列。
5. 確認 `v_scorecard_source_health.status = ready`。
6. 匯出 `data\scorecard-latest.json`。
7. 發布 `scorecard_latest` Supabase snapshot。
8. 跑 snapshot verify。
9. 跑 resource chain verify。
10. 跑 UI E2E。
11. 確認 `/api/scorecard` 與 `/88` 顯示新日期與正確筆數。
