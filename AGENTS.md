# Fuman Terminal AGENTS - Latest Operator Contract

Last updated: 2026-06-29 Asia/Taipei.

This file intentionally replaces the old accumulated AGENTS history. Keep only the latest executable contract here. Do not append legacy incident notes back into this file.

## Main Rule

When the user asks for a complete scan / fresh / readiness / UI / health / immediate terminal display, treat it as this exact flow:

1. Run or verify the real full scan.
2. Refresh `desktop_route_snapshot`.
3. Verify post-scan immediate display.
4. Verify production health.
5. Verify daily battle readiness.
6. Verify data freshness.
7. Verify UI E2E for the affected desktop/mobile routes.
8. Verify Task Scheduler entries and no stale lock.

Do not answer from terminal appearance alone. The receipts, snapshot contract, UI E2E, health, readiness, and schedule must agree.

## Commands

Full scan:

```powershell
pwsh.exe -NoProfile -ExecutionPolicy Bypass -File .\run-full-scan.ps1
```

Post-scan immediate display:

```powershell
node --use-system-ca scripts\verify-post-scan-snapshot-refresh-contract.js --max-age-ms=600000
```

Freshness:

```powershell
npm run verify:data-freshness
```

Readiness:

```powershell
node --use-system-ca scripts\verify-daily-battle-readiness.js
```

Health:

```powershell
npm run monitor:production
```

UI E2E, focused example:

```powershell
npm run verify:terminal-ui-e2e -- --base-url=https://fuman-terminal.vercel.app --only=mobile-phone-portrait-night,mobile-phone-portrait-sun --routes=ai,watch --route-timeout=120000 --eval-timeout=60000
```

Strategy4 UI E2E:

```powershell
npm run verify:terminal-ui-e2e -- --base-url=https://fuman-terminal.vercel.app --only=desktop-night,desktop-sun,mobile-phone-portrait-night,mobile-phone-portrait-sun --routes=strategy4 --route-timeout=120000 --eval-timeout=60000
```

## Do Not Use As Read-Only Verification

`npm run freshness:gate` maps to the daily release path. It can run release/full-scan/sync behavior and modify runtime state. Do not use it as a harmless read-only check.

Use `npm run verify:data-freshness`, `npm run monitor:production`, readiness, UI E2E, and the post-scan snapshot contract for verification.

## Post-Scan Immediate Display

`refresh-desktop-route-snapshot.ps1` is the canonical helper. It must:

- write `desktop_route_snapshot` with `scripts\write-desktop-route-snapshot.js --fail-on-partial`;
- retry transient snapshot write failures;
- map `-Source` to the matching route;
- pass `--routes=<route>` into `scripts\verify-post-scan-snapshot-refresh-contract.js`;
- fail if the selected route is not immediately display-ready.

Current route-scoped source mapping:

| Source | Contract route |
| --- | --- |
| `open-buy` / `strategy1` | `strategy1` |
| `strategy3` | `strategy3` |
| `strategy4` | `strategy4` |
| `strategy5` | `strategy5` |
| `institution` | `institution` |
| `warrant` / `warrant-flow` | `warrant` |
| `cb` / `cb-detect` | `cb` |

The verifier must support `--routes=` and `FUMAN_POST_SCAN_SNAPSHOT_ROUTES`. Single-route scanner runs must not fail because unrelated routes did not hit desktop snapshot.

`bundleHit` may satisfy immediate display when live API, snapshot API, and `desktop_route_snapshot` bundle align on runId/count/date. This prevents false failures when the terminal can display the fresh bundle even if one handler returns `supabase-api`.

## Full Scan Receipts

`run-full-scan.ps1` must reject stale child receipts. A runner receipt whose `finishedAt` is older than that task's `startedAt` is not valid for the current scan.

This protects against the old `open-buy.json` failure receipt being reused after a new scanner run.

Runtime scan receipts live under:

```text
C:\fuman-runtime\data\scan-receipts
```

Do not commit runtime receipts or logs with code fixes unless explicitly creating a baseline.

## Strategy4 Latest Contract

Strategy4 is API-only:

- no static `data/strategy4*.json` publish path;
- no slim/static Strategy4 cache generation;
- no scoped publish bypass;
- latest terminal path is `/api/strategy4-latest?canvas=1&compact=1&shell=1&limit=70&live=1`;
- full scan publishes Supabase complete run/results;
- postflight verifies live compact API before refreshing desktop snapshot;
- after scanner success or preserve-latest behavior, call `refresh-desktop-route-snapshot.ps1 -Source "strategy4"`.

Strategy4 contract verification must self-heal cache misses by temporarily enabling:

```text
STRATEGY4_SUPABASE_ALLOW_EXTERNAL_FALLBACK=1
```

`run-strategy4.ps1` must keep the marker:

```text
Strategy4 contract seed fallback enabled for cache-miss self-heal.
```

## Strategy2 Readiness

After-hours `runtime-session-history` may not expose an API runId directly. Readiness verification may infer the runId from the latest complete run when cache source is `runtime-session-history`.

The verifier marker is:

```text
inferredRunIdFromLatestComplete
```

## Anti-Rollback

All source fixes that prevent rollback must be committed and pushed to `origin/main`. A local-only edit can be washed back by background `git pull --ff-only origin main`.

Before reporting stable:

```powershell
git status --short
git rev-parse HEAD origin/main
```

Both hashes must match when the fix must survive future sync.

`scripts\verify-publish-gate.js` must protect these markers:

- route-scoped post-scan verifier: `selectedTasks`, `--routes=$routeKey`, `FUMAN_POST_SCAN_SNAPSHOT_ROUTES`;
- snapshot retry: `Desktop route snapshot refresh retry`;
- stale receipt guard: `ignored stale scanner receipt`;
- open-buy failed snapshot receipt write;
- Strategy4 fallback marker: `STRATEGY4_SUPABASE_ALLOW_EXTERNAL_FALLBACK`;
- Strategy2 inferred runId marker: `inferredRunIdFromLatestComplete`;
- this AGENTS latest-contract text.

If any marker is removed, publish gate must fail.

## Scheduler Checks

At minimum verify:

```powershell
schtasks /Query /TN "Fuman Strategy4 Cache 1600" /V /FO LIST
```

Expected Strategy4 task:

- enabled;
- daily;
- start time 16:00 Taipei;
- `Last Result: 0`;
- action runs `C:\fuman-terminal\run-strategy4.ps1`;
- start in `C:\fuman-terminal`.

Also check no full scan lock remains:

```powershell
Test-Path C:\fuman-runtime\locks\full-scan.lock
```

Expected: `False`.

## Report Format

When reporting to the user, include only current facts:

- latest full scan `scan-summary.json` ok / criticalFailures;
- latest desktop snapshot updatedAt / endpointCount / misses;
- post-scan contract gates;
- data freshness result;
- readiness result;
- UI E2E result;
- production health result;
- scheduler result;
- commit hash if source changed.

Do not paste old historical AGENTS content back into the answer or this file.
