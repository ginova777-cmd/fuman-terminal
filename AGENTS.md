# Fuman Terminal AGENTS - Latest Operator Contract

Last updated: 2026-07-01 Asia/Taipei.

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

## All-Terminal UI Acceptance

UI acceptance must cover every terminal route and every data-backed strategy surface touched by the change. Do not validate only the data contract, JSON schema, row counts, scan receipt, snapshot contract, or Supabase readback. The actual rendered desktop and mobile UI must also be verified.

For all strategies and terminal data surfaces, UI E2E or an equivalent rendered-page verifier must prove these states when they are possible for the affected surface:

```text
empty
blocked
degraded
0-result
```

Required UI evidence:

```text
empty: the user sees a deliberate empty state, not a blank table, stale rows, broken skeleton, or spinner that never resolves
blocked: the blocking reason is visible in the UI, with the affected strategy/source named and no misleading success state
degraded: the UI shows degraded-but-usable status, source warning, stale/partial coverage reason, incident banner, or fallback source where applicable
0-result: a completed healthy scan with zero matches renders as an explicit no-result state, not as loading, failure, or missing data
```

This is a cross-strategy rule for Strategy1/open-buy, Strategy2, Strategy3, Strategy4, Strategy5, realtime radar, market overview, AI interpretation, warrant flow, chip/institution flow, CB detect, watchlist, mobile views, and any future terminal module. A release, hotfix, readiness report, or verification reply is incomplete unless it includes both data-contract proof and UI-state proof for the affected states.

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

## Full Scan Strict Gate

Complete scan means every required strategy/chip/CB receipt completed for this scan. `criticalFailures=0` alone is not enough.

The hard order is:

```text
full scan receipts complete -> desktop_route_snapshot write -> post-scan immediate-display verifier -> UI/health/readiness/schedule
```

Do not write the final full-scan desktop snapshot when any required receipt is degraded, fallback, partial, warned, stale, missing, or non-zero exit. After writing the snapshot, immediately run `scripts\verify-post-scan-snapshot-refresh-contract.js` so the desktop bundle, snapshot API, and live API agree on runId/count/date before publish or stable reporting.

`run-full-scan.ps1` must keep these strict fields and failure text:

- `strictRequiredStrategies`: `open-buy`, `strategy3`, `institution`, `warrant-flow`, `strategy4`, `strategy5`, `cb-detect`;
- `allCompleteOk`: must be `true` before publish;
- `strictFailures`: must be empty before publish;
- `Full scan strict gate failed`: the blocking error when any required receipt is degraded, fallback, partial, stale, warned, missing, or non-zero exit.
- `post-scan immediate-display verifier`: the immediate-display verifier must run after the full-scan snapshot write and fail the scan summary if it fails.

`run-publish-gate.ps1` must reject publish unless the latest `scan-summary.json` has `allCompleteOk=true`, empty `strictFailures`, and complete receipts for `institution`, `warrant-flow`, and `cb-detect` as well as the strategy receipts.

Each required receipt must be from the current scan window and must have:

```text
status=complete
exitCode=0
complete=true
fallback=false
warnings=[]
qualityStatus not partial/degraded/incomplete
blockingReason empty
```

Publishable scan-summary fields:

```text
scan-summary.json ok=true
scan-summary.json allCompleteOk=true
scan-summary.json strictFailures=[]
```

## Release SHA Verification

Formal verification may pin the deployment with:

```powershell
$env:FUMAN_RELEASE_SHA = git rev-parse HEAD
```

`FUMAN_DEPLOY_SHA` is accepted as an equivalent fallback. When a release SHA is set, production guards must compare local `HEAD` and live `/api/release-manifest.gitSha` with that release SHA, not with a later moving `origin/main` commit.

## API Read-Only Patrol

The API unattended patrol is read-only with respect to Supabase, scanner cache, runtime source state, shared source, and Vercel deploys. It may write only its own scorecard/report/log files under `C:\fuman-runtime`.

## Supabase REST / DB Pool Incident Mode

When Supabase REST returns `522`, `retry_after`, `owner_action_required`, or direct DB pooler says it cannot check out a connection, treat it as a production source incident. Do not keep rerunning heavy verifiers to "see if it passed this time".

First enter incident mode:

```powershell
npm run supabase:incident:enter -- --ttl-minutes=45 --reason="Supabase REST 522 / DB pool checkout timeout"
```

During active incident mode, these actions are forbidden unless the release owner explicitly clears the lock:

- `guard:production`;
- `monitor:production`;
- `verify:production-api-freshness`;
- `verify:api-unattended-scorecard`;
- `snapshot:desktop`;
- `scorecard:sync`;
- battle verifiers across multiple strategies;
- replay/backtest loops;
- Supabase upsert/backfill/summary refresh jobs started by Codex.

Before any heavy Supabase action, agents must run:

```powershell
npm run supabase:incident:check -- --class=guard --action=<action-name>
```

If it blocks, the agent must stop, preserve previous good latest, and report the blocked receipt under `C:\fuman-runtime\data\scan-receipts`. A blocked incident is not a strategy failure and must not be "fixed" by retry storms.

Allowed while incident mode is active:

- one release-owner light probe at a time;
- UI display from already published good latest;
- source writers that are already scheduled for market operation, if they use their own source contract and do not launch full verification fan-out;
- writing blocked receipts and alerts.

Terminal display must not go blank during incident mode. API/front-end behavior must be:

- serve previous good latest when current Supabase read fails;
- show stale/degraded/incident banner;
- do not write empty results;
- do not update latest pointers;
- do not let each strategy fan out into its own heavy Supabase view calls on page load.

Exit incident mode only after the release owner runs a single light probe successfully, then one guarded production monitor, then the needed strategy verifier one at a time:

```powershell
npm run supabase:probe:light
npm run supabase:incident:exit
```

Canonical command:

```powershell
pwsh.exe -NoProfile -ExecutionPolicy Bypass -File .\run-api-unattended-scorecard.ps1
```

Scheduled multi-checkpoint patrol is `Fuman API Unattended Patrol` at `08:55`, `09:05`, `09:30`, `13:35`, `16:10`, and `22:00` Asia/Taipei. It must run only read-only checks: `guard:production`, `monitor:production`, `verify:production-api-freshness`, and the API unattended scorecard. On failure it must write a patrol state file and send a workflow alert receipt.

The runner must resolve the current release SHA from the checked-out production mirror/source, set `FUMAN_RELEASE_SHA`, and pass `--release-sha=<sha>` into `scripts\verify-api-unattended-scorecard.js`.

The scorecard must read live `/api/release-manifest` and include:

- `expectedReleaseSha`;
- `liveGitSha`;
- `deployId`;
- `matchedExpectedRelease`.

If live manifest SHA/deployId is missing, or live SHA differs from the fixed release SHA, API unattended status is `NO`. Do not use a moving `main` or a live view snapshot to prove a past run was healthy.

## Release Owner Merge Queue

Production `main` is release-owner-only. Strategy/source Codex agents must not push `main`, deploy Vercel, or edit `C:\fuman-terminal`; they must work on `agent/<scope>-<yyyymmdd>` branches and hand off the branch name, commit SHA, changed file list, read-only scorecard, and whether Supabase/cache/runtime was written.

The default production integration window is the `22:00 Asia/Taipei merge queue`. During that window, the release owner integrates one branch at a time, reruns gates, and deploys only with `npm run deploy`. Direct `vercel --prod` is forbidden outside the guarded wrapper. See `RELEASE-OWNER-RUNBOOK.md`.

## Mirror Clean Ownership

`C:\fuman-terminal` mirror cleanup is owned by the release owner. Other Codex agents must not clean, reset, edit, deploy from, or run write flows from the mirror. If they find the mirror dirty or behind, they must stop and hand off: branch name, commit SHA, deployId if any, changed file list, scorecard, and whether Supabase/cache/runtime/schedules were written.

Mirror clean must be conservative:

1. Confirm the formal release SHA from `origin/main` or the production manifest.
2. Run `git status --short --branch` and `git diff --name-only`.
3. For dirty files, compare the working tree against `origin/main` with `git diff --name-only origin/main -- <files>`.
4. If the dirty files already match `origin/main`, stash first with `mirror-dirty-before-ff-<shortSha>`, then fast-forward the mirror.
5. If any dirty file differs from `origin/main`, do not overwrite it. Report the file list and owner; require a release-owner decision.
6. Align only with `git merge --ff-only origin/main`. Do not use `git reset --hard`, `git checkout --`, or manual deletion for mirror hygiene unless the user explicitly approves that exact destructive action.

After mirror cleanup, the release owner must verify:

```powershell
git status --short --branch
git rev-parse HEAD
git rev-parse origin/main
npm run verify:source-sync
npm run verify:publish-gate
npm run guard:production
```

Expected reportable state:

- `C:\fuman-terminal` is clean;
- `HEAD == origin/main == production manifest gitSha`;
- mirror dirty contents, if any, were preserved in a named stash before cleanup;
- `verify:source-sync`, `verify:publish-gate`, and `guard:production` all pass.

Never use a dirty mirror as proof that production is healthy. Use the clean release clone for deploy evidence, and use mirror hygiene only to prove the local production mirror is not polluted.

## Verification Fence And Mirror

During a final verification window, use a scheduler fence: do not allow another full scan or publish gate to start while UI E2E, health, readiness, freshness, and post-scan snapshot validation are reading the release state. After validation, restore the production schedules and verify next run times.

`C:\fuman-terminal` is a production mirror only. Do not treat it as the formal source of truth and do not deploy from it when dirty. Source changes must be made in the release clone, committed, pushed, deployed from a clean release clone, then synchronized through the official source-sync path if the mirror needs updating.

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

When no release SHA is pinned, both hashes must match before reporting stable. When a release SHA is pinned, local `HEAD` and live `/api/release-manifest.gitSha` must match the pinned release SHA; a newer `origin/main` is a separate post-validation fact, not a failure of the pinned release.

`scripts\verify-publish-gate.js` must protect these markers:

- route-scoped post-scan verifier: `selectedTasks`, `--routes=$routeKey`, `FUMAN_POST_SCAN_SNAPSHOT_ROUTES`;
- snapshot retry: `Desktop route snapshot refresh retry`;
- stale receipt guard: `ignored stale scanner receipt`;
- full scan strict gate: `strictRequiredStrategies`, `allCompleteOk`, `strictFailures`, `Full scan strict gate failed`;
- full scan immediate-display gate: `post-scan immediate-display verifier`, `scripts\verify-post-scan-snapshot-refresh-contract.js`, `SKIP desktop route snapshot write because strictFailures`;
- publish receipt strict gate: `institution`, `warrant-flow`, `cb-detect`, `allCompleteOk`, `strictFailures`;
- release SHA guard: `FUMAN_RELEASE_SHA`, `FUMAN_DEPLOY_SHA`, `/api/release-manifest`;
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

- release SHA and live manifest SHA match;
- latest full scan `scan-summary.json` ok / criticalFailures / allCompleteOk / strictFailures;
- latest desktop snapshot updatedAt / endpointCount / misses;
- post-scan contract gates;
- data freshness result;
- readiness result;
- UI E2E result;
- production health result;
- scheduler result;
- commit hash if source changed.

Do not paste old historical AGENTS content back into the answer or this file.
