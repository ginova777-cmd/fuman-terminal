# Post-Scan Snapshot Refresh AGENTS - Latest

Last updated: 2026-06-29 Asia/Taipei.

This file keeps only the latest immediate-display contract. Old all-route behavior is retired.

## Goal

After any scanner writes or preserves a complete run, the terminal must be able to display it immediately through `desktop_route_snapshot`.

Required gates:

```json
{
  "dataExists": true,
  "healthViewCorrect": true,
  "terminalKeysVisible": true,
  "immediateDisplayReady": true
}
```

## Canonical Helper

Use:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\fuman-terminal\refresh-desktop-route-snapshot.ps1" -Source scanner-name
```

The helper must:

- run `scripts\write-desktop-route-snapshot.js --fail-on-partial`;
- retry transient snapshot write aborts;
- derive the route from `-Source`;
- call `scripts\verify-post-scan-snapshot-refresh-contract.js --max-age-ms=600000 --routes=<route>`;
- write/read runtime receipts under `C:\fuman-runtime\data\scan-receipts`.

## Route Mapping

| Source | Route |
| --- | --- |
| `open-buy`, `strategy1` | `strategy1` |
| `strategy3` | `strategy3` |
| `strategy4` | `strategy4` |
| `strategy5` | `strategy5` |
| `institution` | `institution` |
| `warrant`, `warrant-flow` | `warrant` |
| `cb`, `cb-detect` | `cb` |

Unknown source means full contract verification.

## Verifier

`scripts\verify-post-scan-snapshot-refresh-contract.js` must keep:

- `selectedTasks()`;
- CLI `--routes=`;
- env `FUMAN_POST_SCAN_SNAPSHOT_ROUTES`;
- payload `routes`;
- gates based on selected `tasks.length`, not all `TASKS.length`.

Single scanner runs must not fail because unrelated routes are missing/have non-snapshot cacheSource.

## Bundle Alignment

Immediate display is ready when:

- snapshot is fresh;
- route endpoint exists in `desktop_route_snapshot` bundle;
- live API, snapshot API, and bundle align on runId/count/date;
- row count meets route minimum.

`bundleHit` is valid evidence of terminal readiness when the above aligns, even if a handler reports `supabase-api`.

## Scanner Failure Behavior

If snapshot refresh fails, scanner runners must write a current failure receipt before exiting. Do not leave old failed receipts as the newest receipt.

`run-full-scan.ps1` must reject stale child receipts where `finishedAt` is before the current task `startedAt`.

For full-scan immediate display, snapshot readiness is necessary but not sufficient. The full scan summary must also keep `strictRequiredStrategies`, `allCompleteOk`, and `strictFailures`, and `status=degraded` on institution/warrant/CB/required strategy receipts must block 100% completion.

## Manual Checks

All routes:

```powershell
node --use-system-ca scripts\verify-post-scan-snapshot-refresh-contract.js --max-age-ms=600000
```

Single route:

```powershell
node --use-system-ca scripts\verify-post-scan-snapshot-refresh-contract.js --routes=strategy4 --max-age-ms=600000
```

Open-buy:

```powershell
node --use-system-ca scripts\verify-post-scan-snapshot-refresh-contract.js --routes=strategy1 --max-age-ms=600000
```

## Anti-Rollback

`scripts\verify-publish-gate.js` must fail if route-scoped verifier, snapshot retry, Strategy4 fallback, stale receipt protection, or full-scan strict all-complete markers are removed.
