# Fuman Terminal AGENTS

Last updated: 2026-06-23

This is the first file every Codex must read before touching Fuman Terminal.

The current priority is Strategy1 open-buy API-only stability. The user does not want another temporary frontend patch that gets overwritten later. Fixes must survive GitHub/Vercel redeploys, scheduled jobs, stale local build output, and old static cache files.

## Official Targets

Only this production URL is official:

```text
https://fuman-terminal.vercel.app
```

This is not the official user-facing terminal:

```text
https://fuman-terminal-sync.vercel.app
```

Important local paths:

```text
C:\fuman-terminal       production app / Vercel deploy repo
C:\fuman-terminal-sync  sync / scanner / scheduled-task repo
C:\fuman-runtime        runtime cache, secrets, generated data
```

Do not report production fixed after only editing local files, deploying the wrong Vercel project, or verifying only the sync project.

## Global Data Rule

Fuman Terminal is Supabase / API-only.

Official data flow:

```text
scanner / collector / writer
-> Supabase complete run or Supabase snapshot
-> no-store /api endpoint
-> frontend polling / rendering
-> production UI
```

Never use these as official data freshness authority:

```text
static /data/*.json
data/open-buy-latest.json
data/open-buy-backup.json
data/open-buy-page-*.json
data/live-freshness-ok.json
version.json
terminal-core.js version bump
service worker cache bump
Vercel deploy side effect
browser hard refresh
manual fake JSON patch
```

Static JSON can exist only as legacy diagnostics or retired artifact cleanup input. It must not drive Strategy1 production data.

## Strategy1 Name And Positioning

Strategy1 is:

```text
策略1「明日開盤入 / open-buy」
```

It is not a generic frontend table and not a static JSON page. It is a Supabase complete-run and readiness-gated flow.

Main operational meaning:

```text
21:30 產生明日候選
08:45 準備與檢查個股期貨 / source coverage
08:55 盤前最終確認五檔 / 試搓 / 委買委賣
09:00 只執行 08:55 全部過關的 BUY 名單
09:10 不強就出，不凹單
```

21:30 produces candidates. It does not directly allow hanging limit-up orders.

08:55 is the executable upgrade gate. Only after preopen price, gap, bid/ask depth, and support pass may a candidate become executable.

## Strategy1 UI Contract

Production Strategy1 main UI must show only two cards:

```text
1. 21:30 候選
2. 08:55 最終
```

Never restore a third card:

```text
排除/降級
有賺就走
快跑
WATCH
BLOCK
stale
quote mismatch
尾盤倒貨
短線過熱
量價不一致
```

Those states belong only in:

```text
strategy1_open_buy_results
strategy1_open_buy_audit
debug output
source audit
```

Frontend main list and the two cards must only display:

```text
decision = BUY
```

WATCH and BLOCK must remain saved in Supabase for debugging, but not shown in the Strategy1 main list.

## Strategy1 API Contract

Official API:

```text
/api/open-buy-latest
```

Official Supabase authority:

```text
strategy1_open_buy_runs
strategy1_open_buy_results
v_strategy1_ready_status
v_strategy1_preopen_features
v_strategy1_futopt_preopen_join
v_strategy1_preopen_history_coverage
strategy1_futopt_preopen_latest
```

The API must not read or fallback to:

```text
data/open-buy-latest.json
data/open-buy-backup.json
data/open-buy-page-*.json
strategy1_open_buy_latest.payload
v_strategy1_open_buy_latest_complete_run
LATEST_RUN_VIEW
OPEN_BUY_RUN_VIEW
latestRunView
latest_run_view
gate = latest-payload
```

Formal latest run must satisfy:

```text
status = complete
complete = true
expected_total = scanned_count
run_trade_date = latest_trading_day
gate = complete-run-authoritative+decision-ready
```

Readiness gate:

```text
v_strategy1_ready_status.decision_ready = true
```

If any of the readiness inputs is not ready, do not show BUY:

```text
daily_ready
chip_ready
preopen_ready
futopt_ready
```

Correct blocked API state may look like:

```text
status = 503
error = strategy1_decision_not_ready
lastError = daily_not_ready
gate = complete-run-authoritative+decision-ready
latest_run_source = strategy1_open_buy_runs
ready_status_view = v_strategy1_ready_status
```

That is a data readiness block. It is not a reason to bring back a third UI card or any static fallback.

`strategy1_open_buy_results` rows must include:

```text
decision = BUY / WATCH / BLOCK
block_reason
setup_type
```

`/api/open-buy-latest` response must include:

```text
gate = complete-run-authoritative+decision-ready
expectedTotal
scannedCount
resultCount
buyCount
watchCount
blockCount
meta.expected_total
meta.scanned_count
meta.result_count
meta.buy_count
meta.watch_count
meta.block_count
cacheSource = supabase-api when ready
decisionReady
lastError
```

`matches` and `rows` must contain only `decision=BUY`.

## Strategy1 21:30 Base Candidate Rules

21:30 complete scan creates tomorrow's base candidates.

It must cover:

```text
前一天強收
收最高或接近最高
成交量放大但不要失控
站上 MA35
紅 K 強攻、收在日內強勢區
短線不能連噴太多天
偏好第一根或第二根攻擊
嘎空燃料
融券餘額仍高
融券回補率不能太高
借券賣出餘額仍高
借券回補率不能太高
法人 / 主力代理是否持續買入
法人明顯倒貨降分
同族群至少 2-3 檔同步強加分
族群沒有同步降分
高周轉 / 當沖熱門
尾盤是否倒貨
漲停鎖住品質
流動性細分
```

Setup classification:

```text
A級 開盤無腦入
B級 突破候選
C級 深跌反彈
C級 洗盤反彈
```

A級:

```text
21:30 候選，08:55 全過才可考慮盤前掛漲停
```

B級:

```text
可列 Strategy1 觀察；只有 08:55 非常強才升級，否則 09:00 後確認
```

C級 深跌反彈:

```text
不盤前掛漲停；只做 09:01 站回開盤價 / VWAP 後短打
```

C級 洗盤反彈:

```text
不盤前掛漲停；只做開盤後不破低、站回開盤價後確認
```

## Strategy1 Stock Pool Hard Exclusions

Hard exclusions:

```text
ETF / 00 開頭
水泥
軍工 / 國防 / 航太
金融
航空
權證
可轉債
黑名單
```

Do not use this as Strategy1 hard exclusion:

```text
近 5 日均量 <= 3000 張
```

It may be a scoring / liquidity factor, not a pool-killing hard exclusion.

## Strategy1 08:45 Prepare

08:45 is not only coverage/source/debug. It must check individual stock futures too.

Individual stock futures preopen strong conditions:

```text
個股期貨漲幅 >= 2%
相對 TXF >= 1%
成交量 >= 80
報價新鮮 <= 300 秒
```

Individual stock futures strength can add symbols to the 08:45 observation pool, but must not alone mark a stock as A級開盤無腦入.

08:45 prepare must also expose source coverage and freshness:

```text
preopenCoverage
futopt freshness
quote age
history coverage
five-level coverage when available
```

If source coverage is insufficient, display data incomplete / source not ready. Do not say there are no symbols merely because coverage is incomplete.

## Strategy1 08:55 Final Confirmation

08:55 must check:

```text
08:45 個股期貨盤前強
08:45-08:55 現股試搓強攻
試搓穩定度
試搓跳空是否過高
委買 / 委賣支撐
五檔 / 委買委賣
```

Stock preopen attack conditions:

```text
試搓漲幅合理偏強
試搓不轉弱
委買有基本張數
盤前委託不薄
```

Absorbing sell pressure type:

```text
委賣明顯大於委買
但試搓價連續撐住
可列入 08:55 可預掛候選
```

Large / high-liquidity hot preopen stocks such as 3711:

```text
可接受試搓 6%-8%
委買 >= 100 張
盤不薄
8% 以上仍視為過熱
```

`v_strategy1_preopen_features` is the 08:55 practical primary source. Scanner must prioritize:

```text
preopen_attack_ok
preopen_attack_type
preopen_attack_confidence
```

Do not rescan raw full-market history to recalculate this as the primary path.

Raw snapshots/history are fallback only.

`low_data_attack` means symbols like 3006 / 3711: preopen attack looks strong but snapshot count or five-level depth is limited. If:

```text
preopen_attack_ok = true
```

then it can be included as preopen attack. `preopen_attack_confidence` is for debug/source audit only. Do not split the main list into high/low confidence.

`v_strategy1_futopt_preopen_join` is the merged stock futures + stock preopen source. It must read the cache:

```text
strategy1_futopt_preopen_latest
```

Do not join the full futopt raw table inside the view at runtime.

`v_strategy1_preopen_history_coverage` is a source readiness gate.

## Strategy1 Audit

Each Strategy1 scan must write audit:

```text
run_id
trade_date
scanned_count
buy_count
watch_count
block_count
decision_ready
message
```

## Old Files And Caches That Caused Strategy1 Problems

These are known interference sources:

```text
data/open-buy-latest.json
data/open-buy-backup.json
data/open-buy-page-*.json
strategy1_open_buy_latest.payload
v_strategy1_open_buy_latest_complete_run
api/terminal-home.js old independent Strategy1 read path
run-open-buy-preopen.ps1 calling /api/open-buy-latest for candidates
strategy1-preopen-* runs being selected as latest complete base run
loadPreopenStrengthCodes() expanding 08:55 scan to all-market preopen strong names
loadStockFutureStrengthCodes() expanding 08:55 scan to all-market futures strong names
legacy-entrypoint-guard.ps1 blocking new 08:45 prepare runner
fuman-terminal-sync.vercel.app being deployed instead of fuman-terminal.vercel.app
generate-slim-cache.js old static open-buy diagnostics
C:\fuman-terminal\.vercel\output stale build output
origin/main containing old terminal-app.js and overwriting CLI hotfix via Vercel/GitHub auto deploy
```

Rules:

```text
08:55 default must confirm 21:30 base candidates, not expand to 125/135 all-market symbols.
Preopen runs must not become the next 21:30 base candidate source.
Homepage Strategy1 must delegate to /api/open-buy-latest, not keep a separate latest view path.
```

## 2026-06-23 Three-Card Rollback Incident

Incident:

```text
Production Strategy1 showed:
16:00 候選
08:55 最終
有賺就走 / 快跑
```

Root cause:

```text
CLI production deploy had been fixed to two cards.
But origin/main still contained old three-card terminal-app.js, terminal-live-check.js, api/mobile-fragment.js, and scripts/generate-slim-cache.js.
Vercel/GitHub later deployed origin/main and overwrote production with the old bundle.
```

Conclusion:

```text
CLI deploy alone is not enough.
Fix must be committed and pushed to origin/main.
```

Rollback guard commit:

```text
e605a076 Guard strategy1 open-buy two-card contract
```

Verified production deployment:

```text
dpl_G9fbAHjmhPaprt7Zdij3kFfkSLZB
```

Verified production version:

```text
strategy1-two-cards-20260623-02
```

## Strategy1 Files That Must Stay In Sync

UI and bundle:

```text
terminal-app.js
terminal-live-check.js
api/mobile-fragment.js
scripts/generate-slim-cache.js
terminal-hotfix.js
```

Version and cache:

```text
index.html
terminal-core.js
terminal-modules.js
fuman-sw.js
refresh.html
version.json
```

API:

```text
api/open-buy-latest.js
api/terminal-home.js
```

Guards:

```text
scripts/verify-strategy1-open-buy-ui-contract.js
scripts/prepare-deploy.js
scripts/verify-publish-gate.js
package.json
```

Docs:

```text
AGENTS.md
```

If production still serves old UI, check:

```text
C:\fuman-terminal\.vercel\output
```

Remove stale output before redeploy only after confirming the resolved absolute path is inside:

```text
C:\fuman-terminal\.vercel\output
```

Deleting `.vercel/output` is not data repair. It only prevents stale local build output from being redeployed.

## Strategy1 Anti-Rollback Guard

Guard script:

```text
scripts/verify-strategy1-open-buy-ui-contract.js
```

NPM command:

```text
npm run verify:strategy1-open-buy-ui
```

This guard must fail if it sees:

```text
16:00 候選
有賺就走
快跑
Strategy1 open-buy card count != 2
mobile fragment old copy
slim cache generator old copy
frontend version mismatch
terminal-hotfix.js missing runtime rollback guard
```

Deploy preflight must run it:

```text
scripts/prepare-deploy.js
```

Publish gate must run it:

```text
scripts/verify-publish-gate.js
```

Publish gate must also reject:

```text
v_strategy1_open_buy_latest_complete_run
LATEST_RUN_VIEW
OPEN_BUY_RUN_VIEW
latestRunView
latest_run_view
```

Runtime fallback guard must remain:

```text
terminal-hotfix.js
installStrategy1OpenBuyRollbackGuard
```

Purpose:

```text
If someone accidentally rolls back only terminal-app.js, but terminal-hotfix.js remains current, the browser removes the third card and rewrites old 16:00 copy back to 21:30.
```

This runtime guard is last-resort protection. It does not replace fixing source and pushing origin/main.

## Required Strategy1 Verification

Local verification:

```text
npm run verify:strategy1-open-buy-ui
npm run verify:version
npm run verify:publish-gate
```

Syntax checks:

```text
node --check terminal-app.js
node --check terminal-live-check.js
node --check terminal-hotfix.js
node --check api/open-buy-latest.js
node --check api/terminal-home.js
node --check scripts/verify-strategy1-open-buy-ui-contract.js
```

Forbidden string scan:

```text
rg -n "16:00 候選|有賺就走|快跑|LATEST_RUN_VIEW|OPEN_BUY_RUN_VIEW|latestRunView|latest_run_view|v_strategy1_open_buy_latest_complete_run" terminal-app.js terminal-live-check.js api/mobile-fragment.js scripts/generate-slim-cache.js api/open-buy-latest.js api/terminal-home.js
```

Expected result:

```text
no matches
```

Live production bundle check must show:

```text
version = strategy1-two-cards-20260623-02 or newer
terminal-app.js has 16:00 候選 = false
terminal-app.js has 有賺就走 = false
terminal-app.js swing-card active count = 2
terminal-app.js has 21:30 候選 = true
terminal-app.js has 08:55 最終 = true
terminal-hotfix.js has installStrategy1OpenBuyRollbackGuard = true
```

Live production API may be blocked by readiness:

```text
status = 503
error = strategy1_decision_not_ready
lastError = daily_not_ready
gate = complete-run-authoritative+decision-ready
latest_run_source = strategy1_open_buy_runs
ready_status_view = v_strategy1_ready_status
```

That is valid if readiness is false.

## Strategy1 Deploy Procedure

When fixing Strategy1:

```text
1. Read AGENTS.md.
2. Confirm official production target is https://fuman-terminal.vercel.app.
3. Fix source in a clean worktree based on latest origin/main when rollback risk exists.
4. Keep C:\fuman-terminal and C:\fuman-terminal-sync in sync.
5. Run Strategy1 guard, version verify, publish gate.
6. Commit and push to origin/main.
7. Deploy official production project.
8. Live verify production bundle and API.
9. Only then report fixed.
```

Never say fixed after only:

```text
local source edit
Vercel deploy success
version bump
browser screenshot from old cache
sync project deploy
API check without frontend bundle check
frontend check without API gate check
```

## Last Known Good Production State

Latest verified UI state:

```text
URL = https://fuman-terminal.vercel.app
version = strategy1-two-cards-20260623-02
terminal-app.js has 16:00 候選 = false
terminal-app.js has 有賺就走 = false
terminal-app.js cards = 2
terminal-app.js has 21:30 候選 = true
terminal-app.js has 08:55 最終 = true
terminal-hotfix.js has installStrategy1OpenBuyRollbackGuard = true
```

Latest verified API state at the time:

```text
/api/open-buy-latest status = 503
error = strategy1_decision_not_ready
lastError = daily_not_ready
gate = complete-run-authoritative+decision-ready
latest_run_source = strategy1_open_buy_runs
ready_status_view = v_strategy1_ready_status
```

This API state means readiness was blocked; it does not mean the UI should show old cards or fallback data.
