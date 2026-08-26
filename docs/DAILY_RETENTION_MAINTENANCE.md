# Fuman Daily Retention Maintenance

## Purpose

Keep operational data bounded without deleting production inputs, current strategy results, or user-facing terminal data. Cleanup is a separate execution layer and never runs inside an intraday strategy verifier.

## Canonical schedule (Asia/Taipei)

The cleanup window starts after the 17:00 Strategy4 closure and ends before the 21:00 Strategy5 run.

| Time | Windows task | Scope | Retention rule |
| --- | --- | --- | --- |
| 17:10 | `Fuman API-Only Retired Artifact Cleanup 1535` | Retired API/static/runtime artifacts | Only retired artifacts covered by its contract |
| 17:40 | `Fuman Supabase Vercel History Cleanup 1545` | Historical Supabase/Vercel cleanup | Guarded history-retention policy; production aliases protected |
| 18:10 | `Fuman Global Cost Janitor Scorecard 1555` | Read-only receipt/cost audit | No deletion; verifies stages 1 and 2 |
| 18:40 | `Fuman Daytrade Intraday Retention 1605` | `fugle_daytrade_intraday_1m` | Keep 15 days; 5,000 rows per batch; at most 60 batches |
| 19:10 | `Fuman Daily Retention Maintenance 1625` | Runtime, stale priority cache, source observability | Runtime 7/15/30-day rules and observability 15 days |

Task names retain their historical numeric suffixes for compatibility with existing receipt contracts. The Windows trigger and this document are authoritative for the actual execution time.

Install or repair the complete schedule with:

```powershell
npm run cleanup:five-stage:install
```

## Scheduler safety

Every stage must use:

- S4U logon and Highest run level.
- Start when available.
- Start on battery and do not stop on battery.
- `MultipleInstances=IgnoreNew`.
- A 20-minute execution limit.
- No automatic retry.
- A 30-minute cadence, leaving a 10-minute isolation buffer.

## Protected data

The cleaner must never delete or overwrite:

- Current-day canonical runs or strategy results.
- Daily OHLCV and daily volume.
- Formal candidates.
- The newest 15 days of formal one-minute evidence.
- Desktop, mobile, `/88`, or latest scorecards.
- `production-health.jsonl`.
- Production Vercel aliases.

If the protected window cannot be read or its date is invalid, cleanup fails closed.

## Receipts and verification

Each stage writes a dated receipt under `C:\fuman-runtime\status` or the existing cleanup receipt directory. The 19:10 stage runs `verify-daily-retention-maintenance.js` after the cleanup receipts exist.

The unique Root Monitor performs the final read-only cleanup receipt audit only at 23:10. Intraday checkpoints do not run cleanup verification and never start a cleanup stage as compensation.

Final acceptance requires:

- All five tasks exist and are enabled.
- All five tasks completed their natural daily run successfully.
- All required receipts are current, applied, and contract-valid.
- Protected-window verifiers pass.
- No cleanup stage launched a strategy, changed a canonical run, deployed, killed a process, or retried automatically.

Missing or invalid evidence produces `NO` and a blocker; it never triggers a second cleanup or strategy run.
