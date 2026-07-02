# Dedicated Daytrade Source Release Owner Runbook

This runbook is for release owner execution only. It does not grant production YES.

## Current Decision

Dedicated daytrade source is source-ready only.

Production unattended: NO.

## Apply SQL

Open Supabase SQL editor:

```text
https://supabase.com/dashboard/project/cpmpfhbzutkiecccekfr/sql/new
```

Paste and run:

```text
ops/public-slot/DaytradeSourceBootstrap.sql
```

Expected result:

- `public.fugle_daytrade_source_speed_scorecard` exists.
- `public.source_status` has `source_name = fugle_daytrade_source`.
- Initial gate is `D`.
- Initial status is `stopped`.
- This must not be interpreted as writer ready.

Then apply the dedicated daytrade table contract:

```text
ops/public-slot/DaytradeSourceDedicatedTables.sql
```

Expected result:

- `public.fugle_daytrade_priority_symbols` exists.
- `public.fugle_daytrade_quotes_live` exists.
- `public.fugle_daytrade_intraday_1m` exists.
- `public.fugle_daytrade_daily_volume_avg` exists.
- `public.fugle_daytrade_futopt_quotes_live` exists.
- `public.v_fugle_daytrade_priority_readiness` exists.
- `public.v_fugle_daytrade_source_contract_health` exists.
- Anon/authenticated may read.
- Only service role may write.

## Verify After SQL

Run read-only verification:

```text
npm run verify:daytrade-source-speed -- --json-only
```

Expected immediately after bootstrap:

```text
gateGrade=D
sourceStatus=stopped
stopNewSignals=true
formalEntryAllowed=false
```

This is correct until a dedicated writer is implemented and started.

## Writer / Scanner

Do not start shared writer as the daytrade writer.

Dedicated writer must write only:

```text
source_status.source_name = fugle_daytrade_source
fugle_daytrade_source_speed_scorecard
fugle_daytrade_priority_symbols
fugle_daytrade_quotes_live
fugle_daytrade_intraday_1m
fugle_daytrade_daily_volume_avg
fugle_daytrade_futopt_quotes_live
```

Writer code readiness check:

```text
npm run verify:daytrade-source-writer
```

Dry-run without Fugle fetch or Supabase writes:

```text
npm run daytrade-source:writer:dry-run
```

Approved release-owner apply mode only:

```text
npm run daytrade-source:writer
```

PowerShell wrapper:

```text
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ops/public-slot/Run-DaytradeSourceWriter.ps1 -LocalCheck
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ops/public-slot/Run-DaytradeSourceWriter.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ops/public-slot/Run-DaytradeSourceWriter.ps1 -Apply
```

Default PowerShell mode is dry-run/no-fetch/once. `-Apply` is required to write.

Formal entry may only use priority-first gates:

```text
gate_mode=priority_first
priority_pool_symbols >= 300
priority_fresh_quote_coverage_120s >= 0.95
selected_symbols_fresh_ok=true
last_429_age_seconds > 90
cooldown_until not in the future
```

Full-market coverage is scorecard only during opening and must not block priority pool.

Scanner may read this source only after the dedicated writer exists and the read-only verifier returns A from production evidence. Scanner must not call Fugle, start writers, or fallback to `fugle_shared_source`.

## Deploy / Mirror

Do not deploy from a dirty or behind worktree.

Do not edit `C:\fuman-terminal` as source. It remains production mirror only.

Required before deploy:

```text
git pull --ff-only origin main
clean worktree
npm run verify:publish-gate
npm run guard:production:pre
npm run deploy
npm run verify:live-version
npm run guard:production
npm run monitor:production
```

## Final YES Conditions

Production daytrade source YES requires all of:

- SQL applied.
- Dedicated writer running.
- `source_status.source_name=fugle_daytrade_source`.
- `status=ok`.
- `gate_mode=priority_first`.
- priority pool A.
- no active cooldown / recent 429.
- read-only verifier returns `gateGrade=A`.
- deploy hygiene clean.
- production evidence captured.

Anything less is NO / PARTIAL.
