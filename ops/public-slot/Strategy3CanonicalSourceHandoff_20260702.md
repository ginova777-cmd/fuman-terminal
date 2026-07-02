# Strategy3 Canonical Shared Source Handoff - 2026-07-02

Release-owner note: this is code/SQL readiness only. It is not production YES until SQL is applied, the source writer has produced live data, Strategy3 gate is A, scanner completes, API evidence is verified, and alert path evidence exists.

## Decision

Strategy3 must not run its own full-market Fugle direct 1m fetch.

Strategy3 uses the canonical shared Supabase source:

- Quote: `fugle_quotes_latest`
- 1m K: shared canonical `fugle_intraday_1m`
- Strategy3 readiness view: `v_strategy3_intraday_1m_status`
- Strategy3 gate view: `v_strategy3_source_gate`
- Daily volume: `stock_daily_volume`

Strategy3 is not allowed to publish formal results unless `v_strategy3_source_gate.gate_grade = A`.

## Strategy3 Stable Speed Profile

```json
{
  "mode": "stable",
  "restQuoteBatchSize": 5,
  "restQuoteEverySeconds": 30,
  "restQuoteDelayMilliseconds": 3000,
  "fugleCollectorBatchSize": 10,
  "fugleCollectorConcurrency": 1,
  "fugleCollectorRequestDelayMilliseconds": 6000,
  "fugleCollectorAdaptiveInitialRpm": 10,
  "fugleCollectorAdaptiveMinRpm": 5,
  "fugleCollectorAdaptiveMaxRpm": 20,
  "direct1mEnabled": true,
  "direct1mUsage": "priority-repair-only",
  "direct1mBatchSize": 1,
  "direct1mEverySeconds": 90,
  "direct1mDelayMilliseconds": 8000,
  "direct1mPrewarmStart": "07:00",
  "direct1mPrewarmSymbolCount": 300,
  "direct1mPrewarmBatchSize": 2,
  "direct1mPrewarmBars": 120,
  "rateLimit429CooldownMilliseconds": 600000,
  "rateLimit429MaxCooldownMilliseconds": 1200000,
  "priorityOnlyAfter429Milliseconds": 900000
}
```

## A Gate

`v_strategy3_source_gate` returns A only when all required Strategy3 source layers are acceptable:

- shared source is not `stopped/error/failed/critical`
- same-day quote rows >= 1000
- quote age <= 900 seconds
- Strategy3 09:00-12:59 session-ready symbols >= 1000
- MA20 continuous ready >= 1000
- MA35 continuous ready >= 1000
- intraday 1m stale seconds <= 120
- daily volume rows >= 1000

If any condition fails, Strategy3 remains C/D and formal publish must fail closed.

## Code Changes

- `lib/supabase-public-slot.js`
  - Strategy3 latest-N 1m RPC now defaults to `get_strategy2_intraday_1m_latest_n`.

- `lib/strategy3-tv-candles.js`
  - Fugle direct 1m diagnostic fallback is disabled by default.
  - It only runs when `STRATEGY3_ALLOW_FUGLE_1M_DIAGNOSTIC_FALLBACK=1`.

- `scripts/scan-strategy3-cache.js`
  - Reads `v_strategy3_source_gate`.
  - `sourceCoverage.status` is `ready` only when gate is A.
  - Formal source fallback is disabled by default.
  - If canonical Supabase source is missing or zero rows, scanner exits instead of publishing degraded data.

- `api/strategy3-latest.js`
  - Reads `v_strategy3_source_gate`.
  - API reports degraded when Strategy3 source gate is not A.
  - API does not use unrelated shared-source degradation as ready evidence.

- `ops/public-slot/Strategy3CanonicalSharedSource.sql`
  - Adds speed profile view.
  - Rebuilds `v_strategy3_intraday_1m_status` from canonical shared 1m table.
  - Adds `v_strategy3_source_gate`.

## Release Owner Steps

1. Apply SQL:
   `ops/public-slot/Strategy3CanonicalSharedSource.sql`

2. Read-only check:
   ```sql
   select *
   from public.v_strategy3_source_gate
   limit 1;
   ```

3. Expected before production A:
   - `gate_grade = A`
   - `status = ok`
   - `session_ready_symbols >= 1000`
   - `ready_ma20_continuous >= 1000`
   - `ready_ma35_continuous >= 1000`
   - `intraday_1m_stale_seconds <= 120`
   - `quote_age_seconds <= 900`
   - `daily_volume_rows >= 1000`

4. Only after gate A, run Strategy3 scanner through the approved release-owner schedule.

5. Verify API and alert path:
   - `/api/strategy3-latest?live=1&verify=1`
   - `npm run verify:strategy3-battle-state`
   - `npm run verify:strategy3-alert-path`

## Current Verdict Until Live Evidence Exists

- Code readiness: pending verification until checks pass.
- SQL applied: NO until release owner applies it.
- Writer/source live: NO evidence in this branch.
- Scanner new run: NO.
- API production unattended: NO.
- Production YES: NO.

