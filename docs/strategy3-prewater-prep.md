# Strategy3 Pre-Water Prep

Scope: local-only prep. Do not hit Supabase, do not write Supabase, do not deploy, and do not declare A grade from this document alone.

## Required Water Sources

| Source | Formal table/view/RPC | A-grade threshold | Fail-closed behavior |
|---|---|---|---|
| quote | `fugle_quotes_latest` | quote age within threshold, fresh coverage >= 0.95, rows >= 1000 | block latest, preserve previous good, write blocked receipt |
| intraday_1m | `v_strategy3_intraday_1m_status` | rowCount >= 1000, `ready_ge_35` sufficient, latest candle present, live stale <= 120s | block latest, no empty overwrite |
| MA20 / MA35 | `v_strategy3_intraday_1m_status` readiness fields | `ready_ma20_continuous` and `ready_ma35_continuous` at A threshold | block latest |
| daily volume | `stock_daily_volume` | latest trade date, rows >= 1000 | block latest |
| preopen | preopen snapshot/source status | Strategy3 NOT_REQUIRED unless checkpoint says required | explicit NOT_REQUIRED or block checkpoint |
| futopt / TXF | dedicated daytrade futopt/TXF health | ready when dedicated daytrade gate requires it | daytrade formal entry blocked |
| chip / institutional | chip blacklist/exclusion files/views | exclusions available; institution not Strategy3-required | do not use as Strategy3 formal source substitute |
| warrant | warrant flow endpoints/views | NOT_REQUIRED for Strategy3 | not applicable |
| CB | CB endpoints/views | NOT_REQUIRED for Strategy3 | not applicable |
| scorecard | snapshot `scorecard_latest`, `/api/scorecard` | `cacheSource=supabase-snapshot` after recovery | production guard blocks |
| mobile / frontend | snapshot `desktop_route_snapshot`, `/api/terminal-fast-bundle` | snapshotHit/fresh true, partial false, endpoint count >= 10 | production guard blocks |

## Dedicated Daytrade Dependency

The dedicated daytrade source must not be replaced by the shared Strategy3 formal chain. Formal entry requires:

- `source_status.source_name = fugle_daytrade_source`
- `fugle_daytrade_source_speed_scorecard`
- `v_fugle_daytrade_source_latest_scorecard`
- `v_fugle_daytrade_source_contract_health`
- `gateGrade=A`
- `formalEntryAllowed=true`

If the gate is B/C/D, Strategy3 can only remain blocked/observation for daytrade-dependent formal entry.

## Recovery Commands To Run Later

Do not run these during Supabase incident.

1. Light source probe  
   `npm run supabase:probe:light`  
   Expected PASS: no 522/timeout; run twice 5-10 minutes apart.

2. Source contract health  
   `npm run verify:fugle-source-contract && npm run verify:daytrade-source-speed`  
   Expected PASS: dedicated daytrade gate A.

3. Strategy source coverage  
   `node --use-system-ca scripts/check-strategy3-source-chain.js`  
   Expected PASS: formal chain ready, no formal fallback.

4. Readback/latest  
   `node --use-system-ca scripts/verify-strategy3-battle-state.js --strict-live`  
   Expected PASS: evidence complete, readback count aligned.

5. Capture latest pointer before any Strategy3 scanner run  
   `npm run verify:strategy3-live-before`  
   Expected PASS: writes `outputs/strategy3-live-readback/strategy3-before-*.json` with `latestPointer.runId`, `resultCount`, and `readbackCount`.

6. Blocked-run proof when source is bad / empty / fallback formal-source  
   `npm run verify:strategy3-live-blocked -- --compare-before=outputs/strategy3-live-readback/strategy3-before-YYYYMMDDTHHMMSSZ.json`  
   Expected PASS: latest pointer unchanged, `latestOverwriteAllowed=false`, `preservePreviousGood=true`, `evidenceStatus=insufficient`, `unattendedStatus=NO`, and a fresh `strategy3-blocked-*.json` receipt exists.

7. Complete-run proof when source is ready  
   `npm run verify:strategy3-live-readback`  
   Expected PASS: API/run/result readback agree, `readbackCount === resultCount`, actual Supabase run payload passes Strategy3 prewater verifier, business-field blank total is zero, no formal source fallback, `evidenceStatus=complete`, `unattendedStatus=YES`.

8. Replay / unattended scorecard  
   `node --use-system-ca scripts/verify-api-unattended-scorecard.js --strategy=strategy3 --read-only`  
   Expected PASS: no missing evidence, no hidden fallback, no empty overwrite.

9. A-grade scorecard  
   Fill the daytrade dependency scorecard from receipts and verifier JSON only.

## Live Readback Verifier

`scripts/verify-strategy3-live-readback.js` is read-only against Supabase/API. It is intentionally not part of local prewater strict because it must not run during an incident.

It checks:

- `v_strategy3_latest_complete_run` latest pointer
- `strategy3_scan_runs` run payload
- `strategy3_scan_results` result readback count
- `/api/strategy3-latest` normalized payload
- actual Strategy3 prewater payload contract
- actual Strategy3 business-field blank audit
- formal source fallback disclosure
- blocked receipt freshness from runtime scan receipts
- before/after latest pointer equality when `--expect-blocked`

Required recovery sequence:

```bash
npm run supabase:probe:light
# wait 5-10 minutes
npm run supabase:probe:light
npm run supabase:incident:exit
npm run verify:strategy3-prewater-strict
npm run verify:strategy3-live-before
# release owner runs Strategy3 scanner here
npm run verify:strategy3-live-readback
```

Blocked-source proof sequence:

```bash
npm run verify:strategy3-live-before
# release owner runs Strategy3 scanner while source is intentionally bad/degraded
npm run verify:strategy3-live-blocked -- --compare-before=outputs/strategy3-live-readback/strategy3-before-YYYYMMDDTHHMMSSZ.json
```

## Refill Plan

Quote coverage: run the dedicated daytrade writer in release-owner window, priority-first, respecting adaptive 429 cooldown. Success is priority coverage >= 0.95 and quote age <= 90s.

Intraday 1m: prewarm priority pool and refresh full status. Strategy3 needs at least 35 bars for readiness and enough continuous rows for MA20/MA35.

Daily volume: refill `stock_daily_volume` from the approved daily source. Success is latest trade date and rows >= 1000.

Futopt/TXF: refill dedicated daytrade futopt/TXF feed. Success is ready status with stale rows cleared.

Preopen: refill preopen snapshot only when checkpoint requires it; otherwise emit explicit NOT_REQUIRED evidence.

## Local Verifiers

Run without Supabase:

```bash
npm run verify:strategy3-prewater
npm run verify:strategy3-prewater:fixtures
npm run verify:strategy3-prewater:static
```

Fixture names:

- `ready`
- `quote-low`
- `stale-1m`
- `ma-insufficient`
- `futopt-stale`
- `source-status-timeout`
- `supabase-timeout`
- `supabase-522`
- `empty-result`
- `fallback-used`
- `degraded-run`

Blocked fixtures must keep latest blocked, preserve previous good, include a blocked receipt path, set `evidenceStatus` to insufficient/non-complete, and avoid fake `unattendedStatus=YES`.
