# Daytrade Source Boundary Contract

## Formal authority

The formal daytrade path uses `fugle_daytrade_source` and the dedicated WebSocket/source-contract verifier. It is the only source allowed to decide formal entry, canonical gate, latest-pointer updates, publish permission, or unattended YES.

## Diagnostic-only shared source

The legacy Strategy2 coverage monitor is preserved as `scripts/check-strategy2-shared-source-diagnostic.js`. It may read `fugle_shared_source` for comparison and incident diagnosis only. Its output must never authorize formal entry, canonical gate, latest updates, publish, or unattended YES.

## Strategy3

The production Strategy3 API wrapper routes only to Strategy3 V2. The legacy shared-probe handler and its query switch are removed; Strategy3 V2 reads the dedicated Mother Pool and local Fugle daytrade candle/quote caches directly.

## Retired modules

`strategy1`, `realtime-radar`, and `heatmap` remain retired in the active module registry. Their legacy files are retained only where required for rollback/audit and must not re-enter active scan, publish, or closure paths.

## Acceptance

Run `node --use-system-ca scripts/verify-daytrade-source-boundary.js` before considering this boundary complete. A source-boundary PASS is structural only; natural 07:00/08:45/09:00 evidence and production readback are still required before Unattended YES.
