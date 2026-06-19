# Codex Operating Rule

## Supabase / Fugle Shared Source Handoff

This project has a live Supabase/Fugle shared source used by intraday strategies. Before changing any Supabase/Fugle collector, writer, health view, strategy coverage check, or daytrade data contract, read this section and verify live data directly.

## Official Publish Target

The only official user-facing terminal is:

```text
https://fuman-terminal.vercel.app
```

`https://fuman-terminal-sync.vercel.app` is not the production terminal. Do not deploy there and report the terminal as updated. Strategy scans may be correct in `C:\fuman-terminal-sync`, and source sync may be correct, while users still see old data if `C:\fuman-terminal` has not been deployed to the `fuman-terminal` Vercel project.

## Desktop API-Only Latest Run Contract

The desktop terminal is API-only for strategy/chip/warrant display. Do not repair desktop display by pointing the frontend back to static `/data/*.json` files, by asking the user to manually run PowerShell checks, or by using Vercel deploy as a scan refresh mechanism.

The official data flow is:

```text
full scan
-> write a new Supabase complete run
-> /api/*-latest reads Supabase with no-store
-> API selects the newest valid non-empty complete run
-> frontend polling detects runId changes
-> frontend forces API reload
-> terminal display updates
```

### API-Only Data Refresh Authority

API-only data updates must not depend on frontend version strings, service-worker cache versions, Vercel deployment side effects, or static asset cache busting. The authoritative data freshness signal is the backend complete-run identity:

```text
Supabase complete run
run_id / runId
result rows for that runId
/api/*-latest no-store response
frontend polling/realtime comparing runId
```

Required rule:

```text
Data changed because a new valid Supabase complete run exists.
The API exposes that run through a new runId.
The frontend sees the runId change and reloads that API payload.
```

Strict prohibitions:

```text
Do not bump version.json only to make strategy/chip/warrant data appear fresh.
Do not change terminal-core.js CACHE/version strings as a data refresh mechanism.
Do not deploy Vercel only to solve stale API data.
Do not rely on browser hard refresh, service-worker replacement, or asset query strings to publish scan results.
Do not report an API-only data fix as complete just because the frontend version changed.
```

Allowed version use:

```text
Use version.json / terminal-core.js / fuman-sw.js version changes only when frontend static assets changed and browser cache busting is required.
Do not change versions when the fix is only scanner logic, Supabase rows, latest API selection, or runId polling behavior.
```

Verification for API-only data fixes:

```text
1. Run or confirm the scanner wrote a new Supabase complete run.
2. Confirm /api/*-latest returns ok=true, no-store headers, count > 0, and the expected runId.
3. Confirm the relevant strategy ids/rows exist in the API payload.
4. Confirm frontend polling/reload is keyed by runId, not by version string.
5. Run npm run monitor:terminal-api for production health when the change touches production behavior.
```

Latest APIs must send these headers:

```text
Cache-Control: no-store, max-age=0, must-revalidate
CDN-Cache-Control: no-store
Vercel-CDN-Cache-Control: no-store
```

Complete-run gate:

```text
status = complete
complete = true
result_count > 0 when the run/view exposes result_count
actual result rows length > 0
```

If the newest complete run is empty, invalid, running, incomplete, or has no result rows, the API must skip it and continue searching recent complete runs until it finds the latest valid non-empty complete run. Empty complete runs must never overwrite the previous valid official result.

This rule is intentional for rest days, holidays, early morning before scan completion, partial source outages, and failed scans:

```text
If no newer valid non-empty complete run exists, keep serving the previous valid complete run.
When a later trading day publishes a valid non-empty complete run, the runId changes and the frontend switches automatically.
```

Do not implement a latest API that only reads `limit=1` from a latest view and returns empty/404 when that newest complete run has zero rows. The API/view layer must explicitly avoid empty complete runs.

Endpoints currently expected to follow this contract:

```text
/api/open-buy-latest
/api/strategy2-latest
/api/strategy3-latest
/api/strategy4-latest
/api/strategy5-latest
/api/institution-latest
/api/institution-tdcc-breakout-latest
/api/warrant-flow-latest
```

Related files:

```text
api/open-buy-latest.js
api/strategy2-latest.js
api/strategy3-latest.js
api/strategy4-latest.js
api/strategy5-latest.js
api/institution-latest.js
api/institution-tdcc-breakout-latest.js
api/warrant-flow-latest.js
api/terminal-home.js
terminal-app.js
terminal-chip-flow.js
terminal-runtime-config.js
```

Frontend refresh rule:

- Polling/realtime should compare backend version state such as `runId`.
- When `runId` changes, force a no-store API reload for the affected view.
- Do not make the user click twice or manually refresh to see a new complete run.
- Do not let lazy loading swallow the first strategy/chip click; if the app module is still loading, replay the click after load.

TDCC breakout is API-only:

```text
/api/institution-tdcc-breakout-latest
```

Do not route desktop TDCC breakout back to `/data/institution-tdcc-breakout-top.json`; static desktop data may be disabled and can return HTTP 410.

### Buy/Sell Chip Incident Pattern

Known production incident from 2026-06-19:

```text
User symptom:
- 外資+投信佔5日均量 clicked but no rows displayed.
- 外資連3買 + 1000張連3週增 clicked but no rows displayed.

Root cause:
1. Live terminal-chip-flow.js was still using old logic and classified foreignTrustVolumePct as a TDCC mode.
2. foreignTrustVolumePct therefore tried to read TDCC data instead of /api/institution-latest.
3. Live /api/institution-tdcc-breakout-latest was missing and returned HTTP 404.
4. The main institution API still had data; this was not a Supabase institution data outage.
```

Required fix when this happens:

```text
1. In terminal-chip-flow.js, isTdccMode() must return only mode === "tdcc1000".
2. foreignTrustVolumePct must render through the normal buy/sell table path using /api/institution-latest.
3. terminal-runtime-config.js must set institutionTdccBreakout to /api/institution-tdcc-breakout-latest.
4. api/institution-tdcc-breakout-latest.js must exist and return HTTP 200 on production.
5. Do not route either strategy back to /data/*.json.
6. Verify production JS, runtime config, institution API, and TDCC API directly.
```

Required production verification:

```text
/api/institution-latest returns ok=true and count > 0
foreignTrust5dCandidates > 0
/api/institution-tdcc-breakout-latest returns HTTP 200 and ok=true
terminal-chip-flow.js contains: return mode === "tdcc1000";
terminal-chip-flow.js does not contain: tdcc1000 || foreignTrustVolumePct
terminal-runtime-config.js contains: institutionTdccBreakout: "/api/institution-tdcc-breakout-latest"
npm run monitor:terminal-api returns ok=true
```

Do not tell the user this is a data/scan/Supabase issue until these frontend and endpoint checks pass. If the API has data but the user's desktop is blank, check live frontend JS and runtime config before changing scanners.

## Automatic Production Health Monitor

The user must not be responsible for manually checking production health. The Windows machine should run the monitor automatically:

```text
Scheduled task: Fuman Terminal API Health
Frequency: every 15 minutes
Runner: C:\fuman-terminal\run-terminal-api-health.ps1
Script: C:\fuman-terminal\scripts\monitor-terminal-api-health.js
Status file: C:\fuman-runtime\state\terminal-api-health-latest.json
NPM command: npm run monitor:terminal-api
```

The monitor checks production `https://fuman-terminal.vercel.app` for:

```text
version.json expected version
/api/institution-latest count > 0
foreign + investment trust / 5-day average volume candidates > 0
/api/open-buy-latest count > 0
/api/strategy3-latest count > 0
/api/strategy4-latest count > 0
/api/strategy5-latest count > 0
/api/warrant-flow-latest count > 0
/api/institution-tdcc-breakout-latest HTTP 200 and ok
no-store cache headers on APIs
terminal-chip-flow.js isTdccMode must be tdcc1000-only
terminal-runtime-config.js institutionTdccBreakout must be /api/institution-tdcc-breakout-latest
```

If Telegram or LINE environment variables are configured, the monitor sends alerts only for critical failures and uses a cooldown to avoid repeated noise. Normal checks stay quiet.

Known good production reference from 2026-06-19:

```text
version = desktop-api-only-all-20260618-23
institution count = 486
foreignTrust5dCandidates = 169
open-buy count = 14
strategy3 count = 2
tdcc breakout count = 3
strategy4 count = 187
strategy5 count = 80
warrant-flow count = 120
```

## Keeping Production Healthy

Do not make the user manually verify production with ad hoc PowerShell commands. The expected operating model is:

```text
scanner publishes data
latest APIs enforce non-empty complete-run gates
frontend reloads on runId changes
Windows health monitor checks production every 15 minutes
Codex investigates only when monitor/user reports a failure
```

Normal daily operation:

```text
1. Let scheduled scans publish Supabase complete runs.
2. Let /api/*-latest read the newest valid non-empty complete run.
3. Let frontend polling/realtime detect runId changes and reload.
4. Let "Fuman Terminal API Health" monitor production every 15 minutes.
5. Check C:\fuman-runtime\state\terminal-api-health-latest.json only when debugging or reporting status.
```

After any code change that touches scanner output, latest APIs, frontend polling/reload, runtime config, TDCC breakout, or monitor logic, verify at minimum:

```text
node --check api/open-buy-latest.js
node --check api/strategy2-latest.js
node --check api/strategy3-latest.js
node --check api/strategy4-latest.js
node --check api/strategy5-latest.js
node --check api/institution-latest.js
node --check api/institution-tdcc-breakout-latest.js
node --check api/warrant-flow-latest.js
node --check scripts/monitor-terminal-api-health.js
npm run monitor:terminal-api
```

For live production status, the authoritative automated check is:

```text
npm run monitor:terminal-api
```

This command must remain a read-only production health check. It should not deploy, mutate Supabase scan data, bump versions, rewrite generated data, or repair by static fallback.

Windows Task Scheduler must keep this task enabled:

```text
Task name: Fuman Terminal API Health
Task to run: powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\fuman-terminal\run-terminal-api-health.ps1
Repeat: every 15 minutes
Expected Last Result: 0
```

If production becomes blank or stale, debug in this order:

```text
1. Read C:\fuman-runtime\state\terminal-api-health-latest.json.
2. Identify which endpoint failed or returned count 0.
3. Check that the endpoint has no-store headers.
4. Check that the endpoint skips empty complete runs and returns the latest non-empty runId.
5. Check Supabase run/result tables for that runId.
6. Check frontend polling/reload only after the API returns a correct payload.
7. Do not use /data/*.json or static fallback to hide the incident.
```

Production must be considered healthy only when all of these are true:

```text
version.json matches the expected deployed version
/api/institution-latest returns count > 0
foreign + investment trust / 5-day average volume candidates > 0
/api/open-buy-latest returns count > 0
/api/strategy3-latest returns count > 0
/api/strategy4-latest returns count > 0
/api/strategy5-latest returns count > 0
/api/warrant-flow-latest returns count > 0
/api/institution-tdcc-breakout-latest returns HTTP 200 and ok
latest APIs return no-store headers
live terminal-chip-flow.js does not classify foreignTrustVolumePct as TDCC
live terminal-runtime-config.js points institutionTdccBreakout to /api/institution-tdcc-breakout-latest
frontend updates when runId changes
```

If a new trading day produces a valid non-empty complete run, production should switch automatically without manual reload or deploy. If a new trading day produces only running, incomplete, invalid, or empty complete runs, production should continue showing the previous valid formal result.

## Strategy2 Authoritative Display Contract

Strategy2 is finalized as:

```text
tick-driven hot pool + candidate-hit + complete-run backing
event-first
complete-run-authoritative
```

One-line operating rule:

```text
During market hours, quote ticks drive the hot pool and candidate-hit provides fast provisional detection.
Convergence, correction, rest-day display, and terminal display are backed by complete-run through /api/strategy2-latest.
```

Authoritative terminal results must come from the Supabase complete-run path:

```text
public.v_strategy2_latest_complete_run
public.strategy2_scan_runs
public.strategy2_scan_results
/api/strategy2-latest
Cache-Control: no-store
gate=complete-run-authoritative
```

Realtime speed signals:

```text
quote-tick
candidate-hit
```

These are speed/provisional signals only. They may wake the frontend, refresh the hot pool, and show candidate state quickly, but they must never replace the formal complete-run result.

Formal correction signal:

```text
complete-run
```

When `complete-run` arrives, the frontend must refetch `/api/strategy2-latest` with a cache-busting/no-store request and correct the Strategy2 screen from that response.

Broadcast/SSE contract:

```text
Broadcast topic: fuman-strategy2-complete
Broadcast events: quote-tick, candidate-hit, complete-run
SSE fallback: /api/strategy2-stream
Formal API: /api/strategy2-latest
```

Intraday official scan flow:

```text
intraday complete scan
-> public.publish_strategy2_complete_run()
-> public.strategy2_scan_runs / public.strategy2_scan_results
-> /api/strategy2-latest no-store
-> frontend polling / Realtime / SSE auto-refresh
```

`public.publish_strategy2_complete_run()` failure is a scanner failure. Do not only warn and then claim the scan succeeded.

Trading-day replacement rule:

```text
If a newer trading day publishes a non-empty complete-run, it automatically replaces the previous valid trading day's complete-run.
If the newest complete-run is empty or invalid, /api/strategy2-latest must skip it and keep serving the latest valid complete-run.
```

This means the terminal may display the previous valid trading day's Strategy2 complete-run during rest days, holidays, or before the next valid scan is complete. Once the next non-empty complete-run exists, it becomes the displayed authority automatically.

Frontend display rules:

- The desktop terminal may render a prior trading day's `complete-run-authoritative` payload across date boundaries.
- A `complete-run-authoritative` payload must not be discarded only because its date is not `marketAiTodayKey()`.
- A `complete-run-authoritative` payload must not be filtered out only because reconstructed rows do not have today's live quote fields.
- Static/local fallback data may remain blocked by same-day and quote freshness guards.
- Do not use `strategy2_latest` as the terminal display source.

Strict prohibitions:

- Do not downgrade Strategy2 to polling-only.
- Do not use static JSON to fill the desktop terminal Strategy2 screen.
- Do not fallback to yesterday's static data.
- Do not use `strategy2_latest` as the terminal display source.
- Do not use a slow readiness/cache view as the terminal display source.
- Do not remove the complete-run gate for speed.
- Do not manually insert fake `strategy2_latest` rows or fake Realtime signals.

Known good live reference from 2026-06-18:

```text
runId = strategy2-20260618-190153
date = 2026-06-18
entryCount = 104
aCount = 104
records = 601
events = 104
qualityStatus = ok
cacheSource = supabase-api
gate = complete-run-authoritative
```

If the API has rows but the desktop terminal is blank, first check frontend guards around:

```text
loadStrategy2IntradayCache()
ensureStrategy2IntradayTodayCache()
renderIntradayRadar()
isIntradayTradable()
strategy2IntradayCacheAuthoritative
isStrategy2AuthoritativePayload()
```

Related files:

```text
api/strategy2-latest.js
api/strategy2-stream.js
terminal-app.js
scripts/scan-intraday-signals.js
scripts/fugle-websocket-collector.js
```

## Mobile Ultra Terminal Contract

The official customer-facing mobile terminal is:

```text
https://fuman-terminal.vercel.app/mobile
```

Keep this URL permanently available. If `/mobile` or any required mobile data file returns 404, treat it as a production incident. The mobile page must be committed to `origin/main`, not only deployed from a dirty local tree. A local `vercel --prod` can appear successful and still be overwritten later by GitHub/Vercel automation if the files are not in `main`.

The mobile terminal is designed for lowest phone CPU and heat:

```text
phone renders scan-side conclusions only
phone does not compute AI rankings, strategy matches, sector sorting, risk lists, or analysis text
```

Required mobile assets:

```text
mobile.html
api/mobile-boot.js
data/mobile-runtime-config.json
data/mobile-boot.json
data/mobile-digest.json
data/mobile-ai-latest.html
data/mobile-ai-lite.html
data/mobile-ai-ultra.html
data/mobile-analysis/{code}.json
data/mobile-terminal-latest.json
data/mobile-stock-analysis-latest.json
data/mobile-strategy1-ultra.html
data/mobile-strategy2-ultra.html
data/mobile-strategy3-ultra.html
data/mobile-strategy4-ultra.html
data/mobile-strategy5-ultra.html
data/mobile-chip-ultra.html
data/mobile-warrant-ultra.html
scripts/publish-mobile-update-event.js
scripts/verify-mobile-ai-fragment.js
scripts/verify-mobile-realtime.js
```

`data/mobile-runtime-config.json` may contain the Supabase anon key because it is a public key used by the browser for Realtime subscriptions. Never put the Supabase `service_role` key in `mobile.html`, any `data/*.json`, Vercel public assets, GitHub, or frontend runtime config. The service role key belongs only on the scanner/server side, currently:

```text
C:\fuman-runtime\secrets\supabase-service-role-key.txt
```

The mobile Realtime project is:

```text
https://cpmpfhbzutkiecccekfr.supabase.co
table: public.mobile_update_events
```

Realtime update flow:

```text
scan/generate mobile files
publish/deploy verified files
live verification passes
scripts/publish-mobile-update-event.js inserts public.mobile_update_events
event row includes boot_hash and changed_keys
mobile.html receives Supabase Realtime WebSocket postgres_changes INSERT
mobile.html compares event.boot_hash with the current boot hash
if boot_hash is unchanged, mobile does nothing
if boot_hash changed, mobile.html refetches /api/mobile-boot
/api/mobile-boot reads data/mobile-boot.json but returns no-store/no-CDN headers
hash changes decide which versioned small fragment to fetch
fragment and analysis URLs must include ?v=hash or ?v=updatedAt
120 second polling remains as a fallback only
```

Do not publish a mobile update event immediately after local file generation if the files have not been deployed/live-verified yet. If an event is sent too early, phones may refetch before the new `mobile-boot.json` and versioned fragments are visible. The event should be sent only after live publish verification, as in `run-live-freshness-gate.ps1` and `postdeploy`.

`/api/mobile-boot` is the primary phone boot endpoint. It must remain a Vercel function/API response with these headers:

```text
Cache-Control: no-store, max-age=0, must-revalidate
CDN-Cache-Control: no-store
Vercel-CDN-Cache-Control: no-store
```

`/data/mobile-boot.json` remains the generated source file and static fallback, but mobile.html should not use it as the primary update check because static CDN cache can delay edge visibility.

Mobile page behavior that must remain true:

- It fetches `/data/mobile-runtime-config.json`; it must not hardcode the anon key in `mobile.html`.
- It fetches `/api/mobile-boot` for boot/manifest state; do not change the primary boot fetch back to `/data/mobile-boot.json`.
- It uses Realtime event `boot_hash` to skip unchanged updates without fetching.
- It appends version hashes to fragment URLs, for example `/data/mobile-ai-ultra.html?v=<ultraHash>`.
- It appends a version to per-stock analysis URLs, for example `/data/mobile-analysis/2327.json?v=<bootUpdatedAt>`.
- It opens a Realtime WebSocket only while the page is visible.
- It closes Realtime while hidden and reconnects on visibility return.
- It keeps the 120 second polling fallback.
- When a Realtime event arrives and the boot hash changed, it retries quickly if the new boot has not appeared yet.
- It uses `visualViewport` plus `orientationchange` to update `html[data-orientation="portrait|landscape"]` immediately.
- Phone portrait/landscape switching must not refetch `/api/mobile-boot`, recompute AI, rebuild the page, or clear cached fragments. Only lightweight CSS/layout state may change.
- Mobile cache safety must be enforced by `npm run verify:mobile-cache-contract`, not by adding runtime work to the phone. The phone must stay on the hot path of boot hash compare, versioned fragment fetch, and simple render only.
- Mobile API-only safety must be enforced by `npm run verify:mobile-api-only`. The phone's latest truth is `/api/mobile-boot` with `no-store`; static JSON files may exist as scan-side artifacts, but `mobile.html` must not poll `/data/mobile-boot.json`, `data-manifest.json`, `data-status-index.json`, `mobile-terminal-latest.json`, `mobile-digest.json`, `*-backup.json`, cache sync, freshness gate, release pipeline, or Vercel deploy as data repair.
- Realtime/polling must compare backend version state (`boot_hash`, and future runId-compatible fields) and then fetch no-store API plus versioned fragments. If a backend contract is incompatible, use an explicit `force_reload` event path; do not make the phone self-heal by loading full static data.
- Low-end phones must not idle-prefetch other tabs. `mobile.html` must respect `boot.lowPower.disablePrefetchOnLowEnd` using lightweight `Save-Data`, `deviceMemory`, and `hardwareConcurrency` checks.
- Realtime update events must be debounced/merged before refetching boot so a burst of scan events wakes the phone once, not once per event.
- Mobile ultra strategy/chip/warrant fragments are capped at Top 5 by the scanner (`boot.lowPower.tabTopLimit`). AI ultra remains Top 3. Do not move this slicing to the phone.
- Mobile sunlight mode is local-only: `mobile.html` toggles `html[data-sun]` and persists `fuman_mobile_sun` in localStorage. Do not load full `styles.css`, images, fonts, or extra data for sunlight mode.
- It stores watchlist data only in phone localStorage key `fuman_mobile_watchlist_v1`.
- The "看分析" modal first reads precomputed per-stock files at `data/mobile-analysis/{code}.json`.
- `data/mobile-stock-analysis-latest.json` is fallback only and should not be downloaded on first paint.
- `mobile-stock-analysis-latest.json` must include terminal strategy matches and `signalsText`, for example `策略4-波段：分區A、突破缺口、量叉`.

### Mobile Cache Contract

The mobile terminal intentionally has many generated `/data/mobile-*` files. Do not delete them only because a health check reports many mobile static files. They are scan-side precomputed conclusions and are part of the low-CPU mobile design. The safety rule is not "fewer files"; the safety rule is:

```text
phone fetches the smallest needed versioned file
phone never computes from large raw data
phone never accepts stale boot/fragment state when the network is available
```

Use this gate whenever touching mobile boot, mobile fragments, service worker cache behavior, Vercel headers, or mobile Realtime update flow:

```powershell
npm run verify:mobile-cache-contract
npm run verify:mobile-cache-contract:live
```

This gate is build/deploy verification only. It must not add runtime work to `mobile.html`, must not add extra phone polling, and must not make the phone download more data. If the gate fails, fix the cache/header/hash contract rather than adding mobile-side computation.

The contract enforced by `scripts/verify-mobile-cache-contract.js` is:

- `mobile.html` uses `/api/mobile-boot` as the primary boot endpoint.
- `/api/mobile-boot` returns browser/CDN/Vercel `no-store` headers.
- Static `/data/mobile-boot.json` may exist as generated source/fallback, but it is not the primary phone boot endpoint.
- Mobile fragments and per-stock analysis URLs stay versioned with `?v=hash` or `?v=updatedAt`.
- Supabase Realtime events include `boot_hash`; if the hash is unchanged, the phone does nothing.
- Tab switching reuses the current boot and cached fragments; it does not refetch boot.
- Service Worker data requests stay network-first.
- Service Worker fallback cache must respect query strings, especially fragment `?v=hash`; do not use `ignoreSearch:true` for versioned mobile fragment fallback.
- `mobile.html` must not register the full service worker.
- `mobile.html` must not preload large fallback files before boot hash is known.

Run these checks before claiming the mobile terminal is healthy:

```powershell
npm run verify:mobile-ai-fragment
npm run verify:mobile-api-only
npm run verify:mobile-cache-contract
npm run verify:mobile-layout
npm run verify:mobile-realtime
npm run verify:mobile-ai-fragment:live
npm run verify:mobile-api-only:live
npm run verify:mobile-cache-contract:live
npm run verify:mobile-layout:live
```

The live spot checks are:

```powershell
Invoke-WebRequest https://fuman-terminal.vercel.app/mobile -UseBasicParsing
Invoke-WebRequest https://fuman-terminal.vercel.app/api/mobile-boot -UseBasicParsing
Invoke-WebRequest https://fuman-terminal.vercel.app/data/mobile-runtime-config.json -UseBasicParsing
Invoke-WebRequest https://fuman-terminal.vercel.app/data/mobile-boot.json -UseBasicParsing
Invoke-WebRequest https://fuman-terminal.vercel.app/data/mobile-analysis/2327.json -UseBasicParsing
Invoke-WebRequest https://fuman-terminal.vercel.app/data/mobile-stock-analysis-latest.json -UseBasicParsing
```

The live `/api/mobile-boot` response must show no-store headers. If it does not, the phone can still be delayed by a stale edge boot payload even when Realtime is working.

To test push delivery after a verified publish:

```powershell
npm run mobile:update-event -- --source=manual-verify
```

`scripts/publish-mobile-update-event.js` also attempts to clean old `mobile_update_events` rows. Supabase must grant `DELETE` on `public.mobile_update_events` to `service_role`. Maintenance SQL lives at:

```text
ops/public-slot/MobileUpdateEventsMaintenance.sql
```

If Realtime verification fails, do not remove the fallback polling to hide the problem. Check:

```text
anon can SELECT public.mobile_update_events
service_role can INSERT public.mobile_update_events
service_role can DELETE old public.mobile_update_events rows
event rows include boot_hash and changed_keys
table is in supabase_realtime publication
mobile runtime config points to cpmpfhbzutkiecccekfr
service_role key is not leaked into public files
```

Do not replace this setup with Vercel Serverless SSE unless the long-connection behavior has been load-tested. Supabase Realtime is the current long-connection layer for the mobile terminal.

For strategy4 urgent publishes, use the fast lane from `C:\fuman-terminal-sync`:

```powershell
npm run strategy4:publish:fast
```

That lane must scan strategy4, regenerate slim/zone files, bump the frontend/service-worker cache version, sync to `C:\fuman-terminal`, deploy the official `fuman-terminal` project, and verify `https://fuman-terminal.vercel.app/data/strategy4-latest.json`. Do not treat a successful `fuman-terminal-sync` deployment as production evidence.

The fastest possible strategy4 path is Supabase-backed: `scripts\scan-strategy4-cache.js` writes `public.strategy4_scan_results` with a `run_id`, and the terminal reads `api/latest-signals?strategy=strategy4` with `Cache-Control: no-store`. `api/strategy4-latest.js` remains the strategy-specific implementation, and `api/refresh` is an alias for callers that want a refresh-style endpoint. The API must read the latest `strategy4_scan_runs.status=complete` run and must never read a running run. Keep static `data/strategy4-*.json` as the deploy fallback.

When running strategy4 manually or from automation, use:

```powershell
$env:FULL_SCAN='1'
$env:STRATEGY4_SUPABASE_RUN_ID='1'
node C:\fuman-terminal\scripts\scan-strategy4-cache.js
```

Do not use `scan_date` / `scan_time` as the primary read gate anymore. `legacy-scan-time` is fallback only.

## Strategy2 Run ID Complete Gate

Strategy2 is an intraday fast-path scanner. During market hours, do not route Strategy2 through deploy, version bump, GitHub push, or the full release chain for each scan. The correct intraday authoritative path is:

```text
quote tick / candidate-hit speed signals -> scan Strategy2 -> publish complete run_id batch to Supabase -> /api/strategy2-latest no-store
```

The official Strategy2 scan scripts are:

```text
C:\fuman-terminal\run-strategy2-intraday.ps1
C:\fuman-terminal\scripts\scan-intraday-signals.js
C:\fuman-terminal-sync\run-strategy2-intraday.ps1
C:\fuman-terminal-sync\scripts\scan-intraday-signals.js
```

Strategy2 Node publishing may preserve the legacy compatibility write, but terminal display must not read it:

```text
1. strategy2_latest is legacy compatibility only and must not be the desktop terminal display source.
2. publish_strategy2_complete_run() publishes the complete run_id batch and is the formal display authority.
```

`strategy2_latest` may use the anon key for old-page compatibility only. `publish_strategy2_complete_run()` must use the Supabase service role key from:

```text
C:\fuman-runtime\secrets\supabase-service-role-key.txt
```

The complete run payload must include at least:

```text
events
records
entryCount
qualityStatus
schemaVersion
dataContractSource
```

Required Strategy2 complete-run contract:

```text
schemaVersion = strategy2-run-id-complete-v1
dataContractSource = supabase:strategy2_intraday_ready_cache
qualityStatus = ok or degraded
run_id format = strategy2-YYYYMMDD-HHMMSS
```

Supabase complete-run objects:

```text
public.strategy2_scan_runs
public.strategy2_scan_results
public.v_strategy2_latest_complete_run
public.publish_strategy2_complete_run(text, date, jsonb)
```

`publish_strategy2_complete_run()` is responsible for:

```text
1. writing public.strategy2_scan_runs with complete=true
2. splitting payload.events into public.strategy2_scan_results where row_kind='event'
3. splitting payload.records into public.strategy2_scan_results where row_kind='record'
4. optionally updating public.strategy2_latest for legacy compatibility only
```

If `publish_strategy2_complete_run()` fails, the scanner must fail. Do not downgrade the failure to a warning or claim the Strategy2 scan succeeded.

Future Strategy2 readers should migrate to:

```text
public.v_strategy2_latest_complete_run
public.strategy2_scan_results
```

Do not use `scan_time` as the primary latest gate for Strategy2. Use the latest non-empty complete run. Legacy JSON and `strategy2_latest` are compatibility fallback only and must not feed the desktop terminal Strategy2 display.

After a formal Strategy2 scan, verify:

```text
public.strategy2_scan_runs where strategy='strategy2' and complete=true order by finished_at desc limit 1
public.strategy2_scan_results where run_id = latest run_id
optional legacy compatibility only: strategy2_latest where id='latest'
```

The latest run must contain both `row_kind='event'` and `row_kind='record'` when signals/records exist, and must keep:

```text
complete = true
schema_version = strategy2-run-id-complete-v1
data_contract_source = supabase:strategy2_intraday_ready_cache
```

### Data Contract And Unit Governance

The largest recurring risk is not Supabase or Fugle availability; it is an unlocked data contract. Every strategy-facing field must make its unit explicit and must be validated before publishing strategy caches.

Do not let strategies guess whether a field is shares, lots, TWD, thousand TWD, raw Fugle units, or already converted units. Supabase should clean data into strategy-ready views; strategies should only make trading decisions.

Required naming convention for new or repaired strategy-facing columns:

```text
volume_shares
volume_lots
trade_value_twd
avg_volume_5_lots
avg_volume_20_lots
cumulative_bid_volume_lots
cumulative_ask_volume_lots
cumulative_bid_ask_volume_lots
quote_updated_at
```

Avoid generic strategy-facing names such as `volume`, `avg_volume5`, or `trade_value` unless the table is a raw-source table and the unit is documented in `payload.volume_unit`. For strategies, prefer `*_lots`, `*_shares`, or `*_twd`.

Priority design:

```text
1. Supabase view normalizes all volume fields into volume_lots / avg_volume_5_lots.
2. Strategy scripts read only strategy-ready view fields such as avg_volume_5_lots.
3. Publish gate blocks cache publication when unit sanity checks fail.
4. Cache files include schemaVersion, volumeUnit, source, and generatedAt.
```

Recommended strategy view pattern:

```text
Raw Fugle daily volume remains volume_shares if it comes in shares.
Strategy view exposes volume_lots = volume_shares / 1000.
Strategy view exposes avg_volume_5_lots and avg_volume_20_lots.
Strategies must not calculate or infer lot conversion from raw tables.
```

Minimum data-quality gate before publishing strategy caches:

```text
volume_lots > 0
avg_volume_5_lots is present for volume-filtered strategies
volume_shares / volume_lots is approximately 1000 when both exist
trade_value_twd approximately equals close * volume_shares, within a reasonable tolerance
reject obviously impossible low-price/high-volume or high-price/low-volume anomalies
block publish if schemaVersion is missing, volumeUnit is missing, or unit check fails
```

Cache contract:

```json
{
  "schemaVersion": "strategy-cache-vN",
  "volumeUnit": "lots",
  "source": "supabase-strategy-view",
  "generatedAt": "ISO-8601"
}
```

If a cache has no `schemaVersion`, no `volumeUnit`, or an old schema version, force a rebuild. Do not silently reuse old cache data.

Keep realtime quote data separate from daily OHLCV data. Intraday bid/ask cumulative fields are quote-layer fields and must not be mixed into daily K-bar inference. Use a separate realtime quote table/view, for example:

```text
fugle_realtime_quote_latest or equivalent view
cumulative_bid_volume_lots
cumulative_ask_volume_lots
cumulative_bid_ask_volume_lots
quote_updated_at
```

Centralize exclusions in a shared module or Supabase view. Do not scatter product/blacklist rules across strategy scripts. At minimum exclude or explicitly flag:

```text
ETF / 00 prefix
warrants
convertible bonds
blacklist
cement
defense / military
finance and aviation if the strategy policy requires it
suspended or inactive symbols
```

For strategy4 specifically, the preferred path is:

```text
1. Create or use a Supabase strategy-ready daily OHLCV view such as strategy4_daily_ohlcv_view.
2. The view must expose avg_volume_5_lots and avg_volume_20_lots.
3. Strategy4 must read avg_volume_5_lots directly and must not guess units.
4. Strategy4 publish must run a volume/trade-value unit gate before writing cache.
5. Strategy4 cache must reject old schemaVersion or missing volumeUnit.
```

Live REST base:

```text
https://cpmpfhbzutkiecccekfr.supabase.co/rest/v1
```

Local keys and runtime state:

```text
C:\fuman-runtime\secrets\supabase-anon-key.txt
C:\fuman-runtime\secrets\supabase-service-role-key.txt
C:\fuman-runtime\state\fugle-websocket-status.json
C:\fuman-runtime\cache\intraday\fugle-ws-quotes.json
```

Shared source scripts:

```text
C:\fuman-terminal-sync\ops\public-slot\Run-PublicSlotSharedSource.ps1
C:\fuman-terminal-sync\ops\public-slot\Start-PublicSlotSharedSource.cmd
C:\fuman-terminal-sync\ops\public-slot\Watchdog-PublicSlotSharedSource.ps1
C:\fuman-terminal\scripts\fugle-websocket-collector.js
```

Current intended runtime shape:

```text
writer process: exactly 1 Run-PublicSlotSharedSource.ps1
collector process: exactly 1 fugle-websocket-collector.js
collector cache: ok=true, subscribed=1600, quotes around 1600, pending normally 0-160 during rotation
Start-PublicSlotSharedSource.cmd: -RestQuoteBatchSize 20 -RestQuoteEverySeconds 10 -Direct1mBatchSize 3 -Direct1mEverySeconds 60 -FutoptQuoteBatchSize 10 -FutoptQuoteEverySeconds 60
```

Do not raise `Direct1mBatchSize` casually. Fugle direct 1m has returned 429 at 10 symbols/minute. The current design is: keep quote freshness broad and fast, derive/update 1m rows from quotes, and rotate direct 1m in a small priority batch.

Health gate for strategies:

```text
source_status.status should be ok
source_status.payload.quotes_ok should be true
source_status.payload.intraday_1m_ok should be true
source_status.payload.daily_volume_ok should be true
source_status.payload.degraded_but_usable_for_intraday should be false in normal mode
source_status.payload.quote_age_seconds should be <= 120
v_fugle_quotes_live_health.coverage_120s should normally be high, around >= 0.85 after a stable 120s window
v_fugle_quotes_live_health.quote_age_seconds should be <= 120
```

Important quote timestamp contract:

```text
fugle_quotes_live.updated_at = shared source write / supply freshness time
fugle_quotes_live.last_trade_time = Fugle raw last trade / quote time
```

Do not change `updated_at` back to Fugle `last_trade_time`. Some stocks do not trade every minute; using last trade time for supply freshness makes coverage look stale even when the shared source just refreshed the row.

Known view/display caveat:

`v_fugle_quotes_live_health` must calculate freshness from `fugle_quotes_live.updated_at`, not `last_trade_time`. If raw `fugle_quotes_live.updated_at` rows are fresh but `v_fugle_quotes_live_health.coverage_120s` is low, the health view definition is wrong or stale. Use/update:

```text
outputs/fix-v-fugle-quotes-live-health.sql
```

Actual Supabase column names that differ from older strategy notes:

```text
fugle_daily_volume_avg: avg_5d_volume, avg_20d_volume, days_5, days_20
fugle_preopen_snapshot: best_bid_price, best_ask_price, bid1_price, ask1_price
v_fugle_preopen_snapshot_history: best_bid_price, best_ask_price, observed_at
futopt_quotes_live: future_symbol, last_price, change_percent, total_volume
v_fugle_intraday_1m_status: today_candle_count exists; rows_today may not exist in current deployed view
```

Before reporting Supabase/Fugle as healthy, run a live check equivalent to:

```powershell
$url='https://cpmpfhbzutkiecccekfr.supabase.co'
$anon=(Get-Content -LiteralPath 'C:\fuman-runtime\secrets\supabase-anon-key.txt' -Raw).Trim()
$h=@{apikey=$anon; Authorization="Bearer $anon"}
Invoke-RestMethod -Uri "$url/rest/v1/source_status?source_name=eq.fugle_shared_source&select=status,updated_at,message,payload&order=updated_at.desc&limit=1" -Headers $h
Invoke-RestMethod -Uri "$url/rest/v1/v_fugle_quotes_live_health?select=*&limit=1" -Headers $h
Invoke-RestMethod -Uri "$url/rest/v1/fugle_quotes_live?select=symbol,updated_at,last_trade_time,price,total_volume,trade_value,change_percent&order=updated_at.desc&limit=20" -Headers $h
Invoke-RestMethod -Uri "$url/rest/v1/v_fugle_intraday_1m_status?select=symbol,latest_candle_time,today_candle_count,ready_ge_35,latest_candle_age_seconds,updated_at&has_today_data=eq.true&order=latest_candle_time.desc&limit=20" -Headers $h
Invoke-RestMethod -Uri "$url/rest/v1/fugle_daily_volume?select=symbol,trade_date,volume,updated_at&order=updated_at.desc&limit=20" -Headers $h
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'Run-PublicSlotSharedSource\.ps1|fugle-websocket-collector\.js' } | Select-Object ProcessId,Name,CreationDate,CommandLine
Get-Content -LiteralPath C:\fuman-runtime\state\fugle-websocket-status.json
```

Recent healthy reference from 2026-06-16 around 13:14 Asia/Taipei:

```text
source_status=ok
quotes=1600
quote_age_seconds=33
intraday_1m_ok=true
daily_volume_ok=true
latest_candle_time=2026-06-16 13:11 Asia/Taipei
intraday_1m_rows_today=1155
avg_volume5_eligible=391
daytrade_hot_symbols=300
v_fugle_quotes_live_health fresh_quote_count_120s=1600
v_fugle_quotes_live_health coverage_120s=0.9639
collector ok=true subscribed=1600 quotes=1600 pending=0
```

If `source_status` is ok but strategy output still says stale, first check whether the strategy is querying old columns or an unsorted `source_status` row. Always order `source_status` by `updated_at.desc`.

Mobile-readable summary: `FRESHNESS-GATE-MOBILE.md`

Strategy2 data governance: `STRATEGY2-FRESHNESS-GOVERNANCE.md`

Realtime radar data governance: `REALTIME-RADAR-FRESHNESS-GOVERNANCE.md`

Strategy5 data governance: `STRATEGY5-FRESHNESS-GOVERNANCE.md`

Version/live sync governance: `VERSION-LIVE-SYNC-GOVERNANCE.md`

Every Codex touching this project must first sync and read the operating rules:

```powershell
git pull --ff-only origin main
npm run verify:publish-gate
```

Read `AGENTS.md`, `FRESHNESS-GATE-MOBILE.md`, `STRATEGY2-FRESHNESS-GOVERNANCE.md`, `REALTIME-RADAR-FRESHNESS-GOVERNANCE.md`, and `STRATEGY5-FRESHNESS-GOVERNANCE.md` before changing data flow, scheduled tasks, publish scripts, strategy2 A-zone output, realtime radar output, strategy5 output, or freshness rules.

Also read `VERSION-LIVE-SYNC-GOVERNANCE.md` before changing frontend version files, deploying UI changes, or responding to a live/source version mismatch.

`freshness:gate` also performs a repo sync preflight. If this checkout is behind `origin/main` or has unexpected dirty files, the gate must fail before publishing.

External data-source timeouts, HTTP 403/404, and fetch failures must remain observable in logs and health summary. They are source warnings unless the final live freshness verifier fails.

Do not modify Supabase-related code, tables, upload, readback, timeout, or retry behavior unless the user explicitly asks for Supabase work.

The only approved data publish entrypoint is:

```powershell
npm run freshness:gate
```

For routine scheduled refreshes, this fast gate is also approved:

```powershell
npm run freshness:gate:fast
```

Both gates must end with `verify:data-freshness:live` before the terminal is considered current.

`verify:data-freshness:live` must validate the terminal freshness gate artifact:

```text
data/live-freshness-ok.json
```

This artifact is the live, terminal-readable proof that the published data passed the gate. It must include a unique gateId for this publish, the current terminal version, manifest count, CB row count, manifest CB count, verifier name, and checked time. Do not treat a publish as terminal-current until this artifact is visible on Vercel and the live verifier accepts it.

Mobile UI is part of the release gate. The market heatmap on mobile must remain a two-column grid:

```css
#market-view #heatmap {
  grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
}
```

Do not reintroduce a mobile one-column heatmap override. Any change touching mobile market overview, `styles.css`, `index.html`, service worker versioning, or release scripts must pass:

```powershell
npm run verify:mobile-layout
npm run verify:mobile-layout:live
```


## Auto Main Release Chain For Codex

Other Codex agents must keep terminal release automation on the guarded chain. Before claiming data or UI is current, automatically detect repo state, version drift, and live alignment first:

```powershell
git fetch origin main
git status -sb
npm run verify:publish-gate
npm run verify:version
npm run verify:live-version
```

If the checkout is behind `origin/main`, ahead/behind has diverged, or the tree has unexpected dirty files, stop and fix sync/dirty state before deploy. Do not manually copy data, manually bump versions, deploy from a stale tree, or push GitHub separately.

Codex must treat the release chain as an automated detection loop, not a manual checklist. The required order is:

```text
detect current main -> sync main -> detect version drift -> bump version if needed -> deploy production -> live verify -> push GitHub -> verify live freshness
```

Use the project scripts to do that detection. A Codex agent may not skip directly to `vercel --prod`, `git push`, or manual file copy unless it first proves the guarded chain is blocked and reports the blocker.

Required detection commands:

```powershell
git fetch origin main
git status -sb
npm run verify:publish-gate
npm run verify:version
npm run verify:live-version
```

If local version and live version differ, Codex must not edit version strings backwards and must not guess the correct cache key. Run the guarded chain so `scripts/bump-version.js` advances the version and all versioned assets move together:

```powershell
npm run release:main
```

When data freshness is part of the change, run the freshness gate first, then release main:

```powershell
npm run freshness:gate
npm run release:main
npm run verify:data-freshness:live
```

The terminal is current only when all of these are true:

- `npm run verify:version` passes locally.
- `npm run verify:live-version` passes against `https://fuman-terminal.vercel.app`.
- `npm run verify:data-freshness:live` passes.
- `data/live-freshness-ok.json` is visible on Vercel with the current version and gateId.
- `git status -sb` shows no unexpected source changes except explicitly acknowledged generated cache residue.
- `origin/main` contains the final release/gate commit.

The only normal release path is:

```text
sync main -> bump if needed -> deploy -> live verify -> push GitHub
```

Run it through:

```powershell
npm run release:main
```

`npm run release:main` is responsible for `git fetch`, `git pull --ff-only origin main`, version bump detection, `npm run sync:source`, Vercel production deploy, `npm run verify:live-version`, `npm run verify:warrant-freshness:live`, `npm run verify:data-freshness:live`, and final `git push origin HEAD:main`. If any step fails, the terminal is not current yet.
Main release/deploy must use the guarded release chain:

```powershell
npm run release:main
```

This wrapper enforces: sync `origin/main` -> bump version if needed -> deploy -> verify live version -> verify warrant freshness live -> verify data freshness live -> push GitHub.

Version detection and live alignment must be automatic. `npm run verify:live-version` detects the local frontend version, reads the live `version.json`, fetches versioned assets, compares live `terminal-app.js` against local `terminal-app.js`, and verifies market event reminders. If it fails with `version-json check failed` or `terminal-app hash mismatch`, do not edit version strings backwards. Re-align by running the guarded chain:

```powershell
npm run release:main
```

If the working tree is not clean and the user explicitly needs a UI-only live repair before GitHub push, sync and deploy the current official source, then immediately run live verification:

```powershell
npm run sync:source
npm run deploy
npm run verify:live-version
```

After the live repair, return to the guarded daily chain when the repo is clean so the final flow remains: main -> bump -> deploy -> live verify -> push GitHub.

Do not run scoped publishing commands such as:

```powershell
.\run-cache-sync.ps1 -Scope warrant
.\run-cache-sync.ps1 -Scope institution
.\run-cache-sync.ps1 -Scope strategy2
.\run-cache-sync.ps1 -Scope strategy3
.\run-cache-sync.ps1 -Scope strategy4
.\run-cache-sync.ps1 -Scope strategy5
.\run-cache-sync.ps1 -Scope cb
```

Those commands are intentionally blocked by `run-cache-sync.ps1`.

Raw scanners may refresh runtime data, but publishing must be centralized through `npm run freshness:gate` so `verify:data-freshness:live` is the final success condition.

Strategy3 data is a critical publish artifact. `strategy3-latest.json`, `strategy3-backup.json`, and `strategy3-scorecard-source.json` must be copied back into the official source repo by the freshness gate, committed with `npm run snapshot:data`, and then released through `npm run release:main` so the daily chain is: main -> bump -> deploy -> live verify -> push GitHub.

Strategy2, realtime radar, market overview, and AI interpretation have a two-layer freshness model because they are intraday ledgers, not slow end-of-day publish artifacts.

Intraday fast path, 08:45-13:30 Asia/Taipei:

- Strategy2 A-zone scans, realtime radar scans, market overview refreshes, and AI interpretation refreshes may update runtime/latest JSON, cache JSON, or Supabase readback rows directly so the terminal can display the newest intraday state quickly.
- The terminal may read the latest runtime JSON or cache output for display.
- strategy2-intraday-*.json cannot bypass the freshness gate for close, archival, official publish, or versioned terminal release.
- The fast path only runs necessary freshness checks: data timestamp is current, source health is OK, quote/candle coverage is acceptable, and stale/source-unhealthy reasons are visible when blocked.
- The fast path must not bump versions, deploy Vercel, push GitHub, or run the full main release chain on every scan tick/refresh.
- Do not insert `npm run freshness:gate`, `npm run release:main`, deploy, or GitHub push into the 3-second Strategy2 A-zone hot path, realtime radar scan loop, market overview refresh loop, or AI interpretation refresh loop.

Slow path for close, archival, official publish, or versioned terminal release:

```text
freshness:gate -> release:main -> live verify -> push GitHub
```

Use the project scripts:

```powershell
npm run freshness:gate
npm run release:main
npm run verify:data-freshness:live
```

The slow path is required before claiming official published data, archived history, GitHub main, Vercel live data, or terminal version alignment is current. If the slow path is blocked by a dirty tree, stale main, deploy failure, live verify failure, or GitHub push failure, report the blocker and do not pretend the official publish is complete. The intraday fast path may continue writing runtime/latest JSON, cache JSON, and Supabase readback rows as long as its source-health and staleness checks are visible.

Strategy2 raw-source readiness must be detected before the A-zone scan window. Starting at 08:00 Asia/Taipei, run the strategy2 Supabase/Fugle coverage preflight:

```powershell
npm run strategy2:coverage:watch
```

The scheduled wrapper is:

```powershell
.\run-strategy2-supabase-coverage-watch.ps1
```

This preflight only checks raw-source coverage and writes `C:\fuman-runtime\state\strategy2-supabase-coverage.json`; it must not publish JSON, copy cache files, or replace `npm run freshness:gate`. It must verify the raw sources strategy2 needs from Supabase REST base URL `https://cpmpfhbzutkiecccekfr.supabase.co/rest/v1`: `source_status`, `v_fugle_quotes_live_health`, `fugle_quotes_live`, `fugle_intraday_1m`, `v_fugle_intraday_1m_status`, `stock_universe`, `fugle_daily_volume_avg`, preopen snapshots, and futopt mapping/quotes. Important: `v_fugle_intraday_1m_status` does not provide `rows_today`; use `today_candle_count`. If coverage is low at 08:00-09:10, report the blocker early instead of letting A-zone appear empty without explanation.

Realtime radar, market overview, and AI interpretation follow the same two-layer model as Strategy2. During 08:45-13:30 they are intraday fast-path ledgers that may update `realtime-radar-latest.json`, market overview latest/cache JSON, AI interpretation latest/cache JSON, scanner output, failed batch details, stale quote details, and filter/interpretation reasons quickly, with source-health/staleness reasons visible. For close, archival, official publish, or versioned terminal release, they must go through `npm run freshness:gate`, `npm run release:main`, and the final live verifier instead of scoped sync or manual copy.

Strategy5 data is governed separately as well: `strategy5-latest.json`, `strategy5-backup.json`, `strategy-match-index.json`, 籌碼老K, 外資投信連買準突破, and multi-strategy confluence output must not be published by scoped sync or manual copy. They must pass through the freshness gate and final live verifier.

Watchlist strategy/chip matches are API-only and snapshot-governed. The official production flow is:

```text
完整掃描 -> Supabase snapshot -> /api/watchlist-match-index no-store -> 回傳 runId -> 前端 polling 偵測 runId -> 變更就清 cache 並重畫終端
```

Rules for this flow:

- `scripts/generate-watchlist-match-index.js` is the only writer for the official `watchlist_match_index` Supabase snapshot and `data/strategy-match-index.json` local/runtime fallback.
- `watchlist_match_index` is the only official watchlist strategy/chip cache. It must include strategy 1/2/3/4/5 plus chip sources `institution`, `warrant`, and `cb` when those source APIs match a watchlist code.
- `/api/watchlist-match-index` must stay `no-store`, must prefer Supabase `watchlist_match_index`, must return a top-level `runId`, and may fall back to local `data/strategy-match-index.json` only when Supabase readback fails.
- The frontend must use `/api/watchlist-match-index` first. It must poll the returned `runId`; when the `runId` changes, clear the in-memory watchlist strategy cache and redraw the terminal.
- `scripts/generate-slim-cache.js` must never write or upsert `watchlist_match_index`, and must never replace the full watchlist match index with static/slim/legacy-only data.
- Warrant matches must read `matches`, `rows`, `volumeMatches`, and `singleSignals`. Do not drop `volumeMatches` or `singleSignals`; doing so hides valid warrant hits.
- Strategy2 matches may contain multiple independent signals for one stock. Keep distinct Strategy2 signal keys such as `strategy2:早盤逐筆追蹤` and `strategy2:真跳空` instead of collapsing them into one generic `strategy2` chip. Multiple rows for the same Strategy2 signal may still merge details.
- Data refreshes do not require deploy: rerunning the full scan, writing a new Supabase snapshot, changing `runId`, or changing watchlist hit counts should update through API-only polling.
- Deploy is required only when program code or frontend assets change: `/api/watchlist-match-index`, `terminal-watchlist-module.js`, `scripts/generate-watchlist-match-index.js`, CSS/HTML/JS, service worker, or boot/versioned assets.
- Regression checks must be source-driven, not single-stock hardcoded. For any sampled or user-reported watchlist code, compare source API hits against `/api/watchlist-match-index`: if strategy/chip/warrant/CB source data contains a hit, the index must contain the corresponding label/key. If source data still contains a hit but the watchlist terminal does not show it, repair the parser, generator, Supabase snapshot, API runId, or frontend cache before claiming the terminal is current.

Warrant flow is governed separately from institution/buy-sell flow. `warrant-flow-latest.json`, `warrant-flow-slim.json`, `warrant-priority-top.json`, `warrant-single-signal-top.json`, and the `volumeMatches` fields for `30 分量 / 流通 / 倍數` must not be published by scoped sync or manual copy. They must pass:

```powershell
npm run verify:warrant-freshness
npm run verify:warrant-freshness:live
```

`verify:warrant-freshness:live` is part of the guarded main release chain. If warrant latest/slim disagree, or live `volumeMatches` is missing, stop and repair warrant generation before claiming the terminal is current. Do not let institution/buy-sell count failures hide warrant freshness, and do not let warrant freshness bypass the central release chain.

Windows Task Scheduler should use these official tasks:

- `Fuman Freshness Gate Fast 0845-1645`
- `Fuman Freshness Gate Full 0610 2010`
- `Fuman Terminal Local Freshness Verify 0830-2230`
- `Fuman Publish Gate Verify 0820`

Old data scripts are legacy shims only; they must redirect to `legacy-entrypoint-guard.ps1`.

Local terminal data repair is automated by:

```powershell
npm run freshness:local-repair
```

It verifies `C:\fuman-terminal\data`; if local data is stale, it runs `npm run freshness:gate:fast` and verifies again.

Before claiming the terminal is current, run:

```powershell
npm run verify:publish-gate
npm run verify:warrant-freshness:live
npm run verify:data-freshness:live
```

## Desktop API-Only Deploy Gate

Desktop production deploys must not be blocked by the old static `/data/*.json` freshness gate. The desktop terminal is API-only, so predeploy should verify the API-only contract instead of requiring static files that scanners intentionally no longer publish.

Default predeploy flow should include:

```text
guard:source
verify:bump
sync:source
verify:version
verify:sw
verify:mobile-layout
verify:desktop-api-only
verify:source-sync
```

`verify:data-freshness` is the old static JSON gate. Do not run it by default for desktop API-only deploys because it expects files such as:

```text
/data/open-buy-latest.json
/data/institution-latest.json
/data/warrant-flow-latest.json
/data/strategy4-latest.json
/data/strategy5-latest.json
```

Those files may intentionally be absent or disabled under API-only mode. Missing static JSON must not be used as a reason to claim the API-only desktop terminal is broken.

Run the static freshness gate only when explicitly requested for static archive/history work:

```powershell
$env:FUMAN_VERIFY_STATIC_DATA_FRESHNESS = "1"
npm run deploy
```

For desktop API-only production health, use:

```text
npm run monitor:terminal-api
```

That monitor checks the real production API endpoints, no-store headers, buy/sell frontend contract, and TDCC breakout endpoint. It is the correct gate for `/api/*-latest` display health.

If `npm run deploy` is blocked by `verify:data-freshness` while the desktop is API-only, fix `scripts/prepare-deploy.js` so it runs `verify:desktop-api-only` by default and only runs `verify:data-freshness` when `FUMAN_VERIFY_STATIC_DATA_FRESHNESS=1` is set. Do not restore static JSON output to satisfy the old gate.

## Buy/Sell Chip Nightly Schedule

Buy/sell chip data should use the B plan:

```text
21:00 buy/sell complete scan
21:15 watchdog check; rerun only if the 21:00 scan failed
```

Expected Windows scheduled tasks:

```text
Fuman 買賣超 Cache 2100
- Start time: 21:00
- Runner: C:\fuman-terminal-sync\run-institution.ps1
- Purpose: full institution scan and Supabase complete run publish

Fuman 買賣超 Watchdog 2120
- Start time: 21:15
- Runner: C:\fuman-terminal-sync\run-flow-watchdog.ps1 -Scope institution -ExpectedTime 21:00
- Purpose: verify the 21:00 institution cache; rerun only when stale/missing/too small
```

Morning buy/sell full-cache tasks should stay removed unless explicitly requested again:

```text
Fuman 買賣超 Cache 0600
Fuman 買賣超 Watchdog 0620
```

Reason: institution buy/sell data is after-hours data. The main official update should happen at 21:00, with a 21:15 watchdog. A 06:00 buy/sell rerun adds another failure point and does not materially improve freshness for the desktop API-only display.

