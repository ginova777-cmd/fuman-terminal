# Fuman Terminal Codex Operating Contract

This file is the first document every Codex must read before touching Fuman Terminal.

The user wants a stable Supabase API-only trading terminal. Do not repair data freshness by bumping frontend versions, redeploying Vercel, restoring static JSON, or asking the user to manually refresh the browser. Data fixes must happen through scanners/writers, Supabase complete runs or snapshots, no-store APIs, and explicit verification.

## 1. Official Production Target

The only user-facing production terminal is:

```text
https://fuman-terminal.vercel.app
```

`https://fuman-terminal-sync.vercel.app` is not the official terminal. Do not report production fixed after only deploying or verifying the sync Vercel project.

Important local paths:

```text
C:\fuman-terminal       production app / deployment repo
C:\fuman-terminal-sync  scanner/source sync repo and many scheduled tasks
C:\fuman-runtime        runtime cache, secrets, generated data
```

Before changing production behavior, confirm which repo the scheduled task or scanner actually uses.

## 2. Global Data Authority

Official data flow:

```text
scanner / collector / writer
-> Supabase complete run or Supabase snapshot
-> no-store /api endpoint
-> frontend polling by runId / snapshotId / bootHash
-> UI refresh
```

Do not use these as data freshness authority:

```text
/data/*.json
data/live-freshness-ok.json
version.json
terminal-core.js version strings
service worker cache bump
Vercel deploy side effects
browser hard refresh
```

Static JSON may exist only for legacy diagnostics or explicit fallback. It must not be the official freshness authority.

The daily battle-state check is:

```text
npm run verify:publish-gate
```

Expected success:

```text
[publish-gate] ok
```

If this passes, the API-only governance chain is healthy. Use targeted verifiers such as `verify:warrant-freshness:live` and `verify:cb-detect-live` for specific data domains. If a legacy checker complains about `/data/*.json`, `live-freshness-ok.json`, or `verify-data-freshness`, treat it as obsolete and remove the old dependency instead of restoring the legacy verifier.

Retired static/cache artifacts are cleaned by:

```text
npm run cleanup:api-only-retired
install-api-only-cleanup-task.ps1
```

The cleanup task must only delete explicit API-only retired artifacts and old logs/archives. It must not delete Supabase writer code, runtime secrets, active mobile boot/digest files, or scanner source files that still belong to the API-only pipeline.
Strategy2 retired root copies are dangerous and must not be used:

```text
C:\fuman-terminal\scan-intraday-signals.js
C:\fuman-terminal\intraday-radar-rules.js
C:\fuman-terminal-sync\scan-intraday-signals.js
C:\fuman-terminal-sync\intraday-radar-rules.js
C:\fuman-terminal\.vercel\output\static\scan-intraday-signals.js
C:\fuman-terminal\.vercel\output\static\intraday-radar-rules.js
```

The only Strategy2 scanner/rules authority is under `scripts\`:

```text
C:\fuman-terminal-sync\scripts\scan-intraday-signals.js
C:\fuman-terminal-sync\scripts\intraday-radar-rules.js
C:\fuman-terminal\scripts\scan-intraday-signals.js
C:\fuman-terminal\scripts\intraday-radar-rules.js
```

`cleanup:api-only-retired` must delete the retired root/static copies if they reappear. Do not restore them for compatibility.

The cleanup task is intentionally broad for API-only governance. Retired root/static scanner copies, stale root-level latest/backup JSON, obsolete freshness wrappers, and stale first-screen repo fallbacks must be deleted when they reappear. The official scanner source lives under `scripts\`, and official data freshness comes from Supabase complete runs/snapshots through no-store APIs. Runtime first-screen files under `C:\fuman-runtime\data` may exist, but cleanup deletes them when they are stale rather than deleting today's fresh runtime snapshots.

## 3. Latest API Contract

Every strategy, chip, warrant, CB, market AI, heatmap, and mobile boot latest API should return stable metadata:

```text
ok
runId or snapshotId
usedDate
sourceDate
marketSession.marketDataDate
count
rows
matches, if legacy clients still need it
updatedAt
reason
transport.gate
cacheSource
```

If an API historically returned `matches`, keep `matches`, but also return:

```text
rows: matches
```

When both arrays exist:

```text
rows.length === matches.length
rows.length === count
```

No-store headers are required:

```text
Cache-Control: no-store, max-age=0, must-revalidate
CDN-Cache-Control: no-store
Vercel-CDN-Cache-Control: no-store
```

Trading-day rule:

```text
During a trading day, never silently fallback to an older trading date.
Only a confirmed closed/non-trading day may fallback to latest completed trading day.
If today data is missing on a trading day, return stale/failed with reason.
```

## 4. Supabase Read/Write Rules

Write path:

```text
create run/snapshot
write rows/payload
mark complete
read back by runId/snapshotId
verify count/date/content
only then publish update event or report success
```

Read path:

```text
select latest valid complete run/snapshot
validate date
validate count > 0 when applicable
validate source contract
return no-store API payload
```

Supabase REST/PostgREST may cap rows at 1000. Any API that can return more than 1000 rows must page with ranges. Do not assume `limit=3000` returns everything.

### Per-Strategy Health Gate Boundaries

Do not use one shared source health flag as a global kill-switch for every strategy. Each strategy has its own authority and gate:

```text
Strategy1: preopen / futopt / daily / chip ready + decision gate. Hard block BUY when 08:55 data is not ready.
Strategy2: quotes health controls candidate universe publication; intraday_1m health only controls A-zone technical upgrade.
Strategy3: complete run / TV confirmation / latest-N after-13:00 gate. Do not empty the run because shared intraday health wobbles.
Strategy4: current common-stock universe / daily OHLC / history coverage gate. Quote health is not the authority.
Strategy5: complete run / result readback gate. Shared source health is not the authority.
Institution / Warrant / CB: API contract gate: runId, usedDate/sourceDate, rows/count, schemaVersion when applicable, and readback.
```

Strategy2 special rule:

```text
quotes_ok=false -> do not publish the Strategy2 quote universe.
quotes_ok=true and intraday_1m_ok=false -> publish quote candidate universe, mark degraded_intraday_1m, and do not upgrade rows into technical A-zone.
source_status=error/stale/stopped must not by itself blank Strategy2 when quote readback is healthy.
```

## 5. Strategy 1 Open Buy / Preopen

Official API:

```text
/api/open-buy-latest
```

Supabase authority:

```text
strategy1_open_buy_runs
strategy1_open_buy_results
strategy1_ready_status
strategy1_futopt_preopen_latest
v_strategy1_preopen_features
v_strategy1_preopen_history_coverage
```

Required gate:

```text
status=complete
complete=true
run_trade_date = latest trading day
decision_ready=true when strict mode applies
gate = complete-run-authoritative+decision-ready
```

Rows should include:

```text
decision = BUY / WATCH / BLOCK
setup_type = open_attack / futopt_attack / stock_preopen_attack
block_reason
preopen_attack_confidence = high / medium / low_data
```

Save BUY/WATCH/BLOCK when debugging is needed. Frontend may show only BUY, but debug must be able to see why symbols were blocked.

Preopen requirements:

```text
08:45-08:55 snapshot history
symbols >= 1500 when ready
latest_snapshot_at >= 08:54:30
five-level bid/ask coverage >= 80% when available
futopt quote age <= 300 seconds
```

If snapshot_count is low or five-level order book is thin/missing, do not hard-block promising symbols only as `thin_blocked`; mark `preopen_attack_confidence=low_data` so strategy can downgrade instead of disappearing.

Before 08:45 Taipei time, Strategy1 may be not applicable. Freshness gate must not fail just because the opening run is not due yet.

## 6. Strategy 2 Intraday / Full-Window Ledger

Strategy2 is API-only and complete-run authoritative. It must show the full 08:45-12:00 intraday ledger on desktop after market close. If the user says the Strategy2 terminal has no data, do not restore static JSON, do not use Vercel as the fix, and do not route back to retired endpoints. Rebuild/publish the complete run, verify Supabase, verify the no-store API, then verify the frontend ledger display.

### Official Strategy2 APIs

Use only these runtime APIs:

```text
/api/latest-strategy?key=strategy2
/api/strategy2-stream
```

`/api/latest-strategy?key=strategy2` is the JSON payload authority. It must read `v_strategy2_latest_complete_run` first and return top-level:

```text
records
events
rows
matches
runId
date / usedDate
count
transport.gate = complete-run-authoritative
cacheSource
```

`/api/strategy2-stream` is only the run notification/SSE channel. It announces the latest complete runId and counts; it is not a replacement for the full JSON ledger.

### Supabase Authority

```text
v_strategy2_latest_complete_run
strategy2_scan_runs
strategy_cache_status
strategy2_scan_results, when needed for audit/detail
```

Required complete-run gate:

```text
strategy = strategy2
status = complete
complete = true
payload.records.length > 0
payload.events.length > 0 when entry events exist
run_id present
scan_date = current Taipei trading date
transport.gate = complete-run-authoritative
```

The latest complete run view must not point to an empty payload. If the latest view returns an empty payload but `strategy2_scan_runs` has a valid complete run with rows, repair the latest view/source ordering instead of displaying empty data.

### Daily Runtime Flow

Before/during 08:45-12:00:

```text
1. Use API polling only.
2. Build the common-stock mother pool from Supabase quotes/common-stock active views.
3. Exclude ETF, warrants, halted/test/non-common-stock, large exclusion list, and manual exclusions.
4. Use amplitude = current price vs open price. Do not use Fugle/Supabase change_percent as the +2% Strategy2 condition.
5. Candidate base:
   price 10-1000
   amplitude >= 2%
   amplitude < 9.9%
   today volume > 0
   not near limit-up
6. Liquidity passes if any of:
   avg5_volume > 3000
   amplitude >= 2% + today volume > 5000 + daily MA bullish when available
   today volume > avg5_volume * 2 + today volume >= 10000 + volume rank top 100
7. Poll/scan loop targets:
   LoopSeconds = 5
   PrefilterCount = 180
   DeepScanCount = 60
   FastTrackCount = 40
   BarsPerSymbol = 80
```

Signal rules:

```text
Opening/futures preopen:
08:45-09:00 individual stock futures / preopen records must enter the Strategy2 records ledger.

Rebound strengthening:
outer volume > inner volume
amplitude >= 2% vs open
above MA35
MACD strengthening
KDJ strengthening
current price >= open, or open-to-now >= 0.5%, or latest price near recent high

Intraday continuation:
09:10-12:00
amplitude >= 2% vs open
above MA35
MA35 rising
breaks previous two highs within previous 60 bars
current price >= open
MACD/KDJ/NPSY/RSI or volume confirmation
```

After 12:00 / after market close:

```text
1. Do not blank Strategy2.
2. Run/replay the full 08:45-12:00 window if the live terminal did not collect a complete ledger.
3. Publish a complete run with all records/events.
4. The desktop terminal must still show today's 08:45-12:00 ledger until midnight.
5. After 00:00 Taipei time, the display may clear for the next day and restart detection at 08:45.
```

Known replay/publish commands:

```text
node scripts\\replay-strategy2-full-window-from-1m.js
node scripts\\publish-strategy2-complete-run.js
```

The expected full-window replay shape is:

```text
records > 0
events >= 0
first = 08:45:00
last = 12:00:00
runId = strategy2-YYYYMMDD-HHMMSS
```

Example verified 2026-06-23 run:

```text
runId = strategy2-20260623-141634
records = 1597
events = 161
first = 08:45:00
last = 12:00:00
gate = complete-run-authoritative
```

### Desktop Terminal Display Contract

The desktop Strategy2 terminal must show the complete records ledger, not just merged events.

Frontend contract:

```text
terminal-runtime-config.js:
strategy2IntradayLatestApi = /api/latest-strategy?key=strategy2
strategy2IntradayCache = /api/latest-strategy?key=strategy2
strategy2IntradaySlim = /api/latest-strategy?key=strategy2
strategy2IntradayTop = /api/latest-strategy?key=strategy2
strategy2IntradayLiveTop = /api/latest-strategy?key=strategy2

terminal-app.js:
loadStrategy2IntradayPayload() reads /api/latest-strategy?key=strategy2.
loadStrategy2IntradayCache() must preserve payload.records as strategy2IntradayRecordRows.
renderIntradayRadar() must use strategy2IntradayRecordRows when scanClosed=true, so after close the table displays the full 08:45-12:00 ledger.
```

Do not collapse records into one row per code only. Merged `events` are useful for A-zone summaries, but the user-facing post-close backtest view requires `records` as逐筆資料.

The table must allow search/sort and must show at least:

```text
time
code
name
state
signal
entry/observed price
amplitude/percent
volume
risk/entry plan when available
reason
```

If the API returns records but the UI is empty, inspect frontend filters first:

```text
isIntradayVisibleSessionRow()
getIntradayEntryTime()
scanClosed branch in renderIntradayRadar()
strategy2IntradayRecordRows population
keyword filters
old localStorage payloads
service worker / terminal-app.js version
```

### Local Desktop API-Only Terminal

For local desktop verification without Vercel, use:

```text
C:\\fuman-terminal\\run-local-api-only-terminal.ps1
http://127.0.0.1:8787/?desktop=1
```

The local server:

```text
C:\\fuman-terminal\\scripts\\local-api-only-server.js
```

It serves static terminal files and executes `api/*.js` handlers directly. Use this when the user says the computer terminal has no data. Do not tell the user the data exists only because the API was checked; verify the desktop terminal bundle can load the ledger:

```text
Invoke-WebRequest http://127.0.0.1:8787/api/latest-strategy?key=strategy2
terminal-app.js contains strategy2IntradayRecordRows
terminal-app.js contains recordLedgerRow
```

### Verification Checklist

Minimum checks before reporting Strategy2 fixed:

```text

GET /api/latest-strategy?key=strategy2:
status = 200
date = current Taipei trading date
records.length > 0
runId present
transport.payloadGate or transport.gate = complete-run-authoritative

GET /api/strategy2-stream:
emits strategy2-run
runId matches latest complete run

Frontend:
node --check terminal-app.js
terminal-app.js contains strategy2IntradayRecordRows
terminal-app.js contains recordLedgerRow
desktop Strategy2 page displays the records ledger after close
```

Health/source-status rule:

```text
quotes_ok=false -> do not publish the Strategy2 quote universe.
quotes_ok=true and intraday_1m_ok=false -> publish quote candidate universe, mark degraded_intraday_1m, and do not upgrade rows into technical A-zone.
source_status=error/stale/stopped must not by itself blank Strategy2 when quote readback or complete-run readback is healthy.
After market close, source_status=stopped with a message like Stopped after 14:05 is afterhours_stopped_ok, not an empty Strategy2 state.
```

Do not mix Strategy2 A-near-entry terminal records with formal MA35-only entries. The terminal can show A-near-entry and full ledger rows; formal MA35 is auxiliary and should not erase the records ledger.

## 7. Strategy 3 Tail / 13:00

Official API:

```text
/api/strategy3-latest
```

Supabase authority:

```text
strategy3_scan_runs
strategy3_scan_results
strategy3_intraday_1m_status_latest
v_strategy3_intraday_1m_status
v_strategy3_quote_ready
get_strategy3_intraday_1m_latest_n(codes, limit)
```

Strategy3 is a 13:00 tail strategy. Do not fail daily live freshness before 13:00 Taipei time just because the Strategy3 run is not due yet.

Hard gate after due time:

```text
usedDate = current trading day
cacheSource = supabase-api
runId non-empty
count > 0
badUnder2 = 0
qualityGates present
```

Quality gates should expose:

```text
qualityGates.countOk
qualityGates.usedDateOk
qualityGates.cacheSourceOk
qualityGates.runIdOk
qualityGates.allPercentOk
qualityGates.badUnder2
qualityGates.minAbsPercent
```

If Strategy3 is long-only, main rows should require `percent >= 2`. If negative rebound candidates are kept, split them into a rebound/observe section instead of mixing them with the main long list.

## 8. Strategy 4 Swing / Daily OHLC

Official API:

```text
/api/strategy4-latest
```

Supabase authority:

```text
strategy4_scan_runs
strategy4_scan_results
strategy4_daily_ohlcv_view
strategy4_stock_universe_view
```

Universe rules:

```text
current Taiwan common stocks only
exclude ETF / warrant / CB / suspended / delisted / old merged symbols
2311 and 2325 must not be eligible
3711 must be eligible
history-ready universe excludes insufficient daily OHLC names
coverageRatio should be 1 when history gate is clean
```

Do not use Yahoo or Hong Kong daily K fallback for Taiwan stock history when Fugle / FinMind / Supabase OHLC is available. Do not reintroduce old Taiwan symbols such as 2311/2325 when the current symbol is 3711.

Patch / run order:

```text
Strategy4CurrentUniverseGate.sql
Strategy4HistoryReadyUniverseGate.sql
prewarm / backfill local cache when needed
full scan
verify universe total == scannedCount
```

## 9. Strategy 5 Composite

Official API:

```text
/api/strategy5-latest
```

Supabase authority:

```text
strategy5_scan_runs
strategy5_scan_results
```

Query contract:

```text
?top=1&compact=1&limit=50 must actually limit and compact payload
count = returned rows count
resultCount = full complete run result count
rows = returned rows
matches retained for legacy clients if needed
```

Publish contract:

```text
write running run
write result rows
write complete run
readback by run_id
readbackCount == resultRows.length
log runId / resultRows / readbackCount / status / complete
```

Do not move Strategy5 back to static JSON. Do not let watchlist match index overwrite `/api/strategy5-latest`.

## 10. Institution / Chip / Buying-Selling

Official APIs:

```text
/api/institution-latest
/api/institution-tdcc-breakout-latest
/api/watchlist-match-index
```

Supabase authority:

```text
institution_scan_runs
institution_scan_results
institution_tdcc_breakout
watchlist_match_index snapshot
```

Rows must be read with Supabase paging/range. If scanner wrote 1640 rows, API count must be 1640, not 1000.

API contract:

```text
cacheSource = supabase-api
runId non-empty
usedDate/sourceDate = trading day
count = full Supabase rows, or compact count with explicit resultCount
rows/data length matches the contract
```

Do not use Vercel deploy to refresh institution/chip data. Scanner writes Supabase; API reads Supabase. FinMind may be a scanner source provider, not a frontend data authority.

## 11. Warrant Flow

Official API:

```text
/api/warrant-flow-latest
```

Supabase authority:

```text
warrant_flow_scan_runs
warrant_flow_scan_results
watchlist_match_index snapshot
```

Required contract:

```text
cacheSource = supabase-api
schemaVersion >= warrant-flow-run-id-complete-v1
dataContract.ok = true
usedDate/sourceDate/marketDataDate are YYYYMMDD, not ROC date like 1150622
top/compact/limit query shapes response
volumeMatches are single warrant rows, not underlying aggregate rows
```

Each `volumeMatches` row must include:

```text
warrantCode
warrantName
underlyingCode
thirtyMinuteVolume
floatingUnits
volumeMultiple
```

Watchlist index must include warrant underlying matches for `volumeMatches` and `singleSignals`, or warrant signals will not light up in radar/watchlist.

Verify with:

```text
npm run verify:warrant-freshness:live
```

## 12. CB Detect

Official API:

```text
/api/cb-detect-latest
```

Supabase authority:

```text
cb_detect_latest snapshot
cb-detect-supabase-status.json for diagnostics
cb-detect-run-history.json for recent metadata
```

Scanner contract:

```text
npm run scan:cb-detect
write Supabase snapshot
readback same runId
verify count / usedDate / sourceCounts / excludedCounts
write status with lastSuccessAt / lastErrorAt / lastError / consecutiveFailures
keep recent run history
```

API contract:

```text
cacheSource = supabase-snapshot
runId non-empty
usedDate/sourceDate stable
rows array
count = rows.length
stale/issues visible
```

Verify with:

```text
npm run verify:cb-detect-live
```

## 13. Market AI / Heatmap / Mobile Boot

Official APIs:

```text
/api/market-ai-live
/api/market-ai-panel-live
/api/heatmap
/api/mobile-boot
```

Supabase authority:

```text
market_ai_snapshots
market_ai_live
market_ai_panel
mobile_boot
heatmap_latest
mobile_update_events
```

Trading-day rule:

```text
During a trading day, never silently fallback to an older trading date.
Only closed/non-trading-day sessions may fallback to latest completed trading day.
```

Required observability:

```text
cacheSource = supabase:market_snapshots when Supabase snapshot is used
fallback boolean
stale boolean
reason when stale/fallback/failed
snapshot.key
runId or snapshotId
bootHash when available
marketSession.today
marketSession.marketDataDate
```

For `/api/heatmap`:

```text
cacheSource = supabase:market_snapshots
snapshotMode = sector-top5
snapshot.key = heatmap_latest
```

For `/api/mobile-boot`:

```text
cacheSource = supabase:market_snapshots
fallback = false when fresh
stale = false when fresh
snapshot.key = mobile_boot
```

## 14. Shared Fugle Intraday Source

Shared source must serve daytrade candidates, not only symbols that changed recently.

Required 1m behavior:

```text
08:00 build today universe
08:55-09:00 build preopen_hot_symbols
09:00 write fugle_intraday_1m immediately
09:00-09:10 prioritize preopen hot / A-grade names
09:10 onward backfill missing 09:00+ candles
09:35 ready_ge_35_symbols should rise
```

Candidate priority:

```text
preopen strong
top 300 gainers
top 300 volume
top 300 trade value
avg volume 5 days > 3000
high turnover / daytrade candidates
```

Synthetic / flat candle rule:

```text
synthetic_flat OHLC can be used for MA35 / SMA5 / RSI / MACD / KD / NPSY / price trend
synthetic_flat volume must not be used for volume explosion / volume ratio / average volume / strict volume OK
```

Payload fields:

```text
payload.source = fugle_direct / quote_derived / synthetic_flat
payload.synthetic = true / false
payload.volume_source = direct / quote_delta / synthetic_zero
payload.volume_strategy_usable = true / false
```

Source status must expose separated health:

```text
quotes_ok
preopen_ok
futopt_ok
intraday_1m_ok
daily_volume_ok
quote_age_seconds
intraday_1m_stale_seconds
latest_candle_time
ready_ge_35_symbols
ready_ge_35_ratio
ready_ge_80_symbols
ready_ge_80_ratio
synthetic_ratio
writer_version / build_id when available
```

If 1m writer is stopped after market close, health views should report afterhours stopped OK, not live intraday failure.

## 15. Scorecard Contract

Scorecard is a dashboard/report layer, not the source of truth. It consumes APIs and append-only ledgers.

Every API used by scorecard should return:

```text
usedDate
sourceDate
marketSession.marketDataDate
runId
count
rows
updatedAt
reason
transport.gate
```

Do not calculate scorecard rows from mismatched dates. Do not mix a fallback report date with latest strategy data from another date unless clearly labeled.

Scorecard should not invent trades. If a source has only signal-day estimates, label it as signal-day estimate. If a source has real entry/exit outcomes, label it as backtested outcome.

## 16. What To Do When Something Looks Broken

Use this order:

```text
1. Check the official production API, not static JSON.
2. Check API metadata: runId, usedDate, sourceDate, count, cacheSource, transport.gate.
3. Check Supabase complete run/snapshot exists and is complete.
4. Check scanner/writer readback verification.
5. Check frontend polling only if API is already correct.
6. Deploy only when API code or frontend code changed.
```

Do not say fixed because:

```text
Vercel deployed
version changed
browser refreshed
static JSON was regenerated
sync project looks correct
```

Say fixed only when the official production API returns the correct no-store payload and the relevant verifier passes.






All sidebar strategy entries must behave like Strategy5 fastest-first main entry: clicking 策略1/2/3/4/5 must immediately select that strategy main result page and render it, without first showing waiting, overview, confluence, mixed, or generic Strategy Center pages. Main entry ids are 策略1=open_buy, 策略2=intraday_2m, 策略3=strategy3, 策略4=swing_radar, 策略5=strategy5_all. Do not first show FMN://strategy.scan, 綜合策略選股, 策略中心, 載入全台股股票池, or multi_strategy_confluence.

Runtime note: browser loads terminal.js through terminal-core.js. When changing strategy entry behavior, update/sync terminal.js, not only terminal-app.js, otherwise the visible app keeps showing old Strategy Center / 綜合策略選股 behavior.

Generic 策略中心 links with no specific 策略1-5 label must also bypass the overview and default to the main Strategy5 result page, never to 綜合策略選股.

Strategy view no-overview fallback: if strategy view opens with no selected strategy or tries to render 綜合策略選股 / FMN://strategy.scan, force strategy5_all immediately. index.html must also not contain visible 綜合策略選股 copy.

Do not leave visible generic Strategy Center chrome in setStrategyChrome or index.html. Fallback labels must not include 綜合策略選股 or FMN://strategy.scan; use direct main-result labels instead.

Rollback guard: run `npm run verify:strategy-direct-main` after any strategy-view/frontend entry change. This guard fails if 綜合策略選股, FMN://strategy.scan, visible 策略中心 heading, unsynced terminal.js/terminal-app.js, or missing direct-main fallback returns.
