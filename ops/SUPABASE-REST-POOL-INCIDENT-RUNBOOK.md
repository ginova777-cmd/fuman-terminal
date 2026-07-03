# Supabase REST / DB Pool Incident Runbook

This runbook exists to prevent retry storms when Supabase REST or the DB pool is already saturated.

## Trigger

Enter incident mode when any of these appear:

- Supabase REST HTTP 522.
- Cloudflare response says `retry_after` or `owner_action_required`.
- Direct DB pooler reports `unable to check out connection from the pool`.
- Multiple unrelated views/API surfaces fail at once.
- `guard:production` fails because `desktop_route_snapshot` or fast bundle cannot read Supabase.

## Immediate Action

```powershell
npm run supabase:incident:enter -- --ttl-minutes=45 --reason="Supabase REST 522 / DB pool checkout timeout"
```

Then stop running broad verification. Do not run `guard:production`, `monitor:production`, all-strategy scorecards, replay loops, or snapshot writers repeatedly.

## What Still Runs

Market-critical writers may keep running only if they are already scheduled and use source-specific hard gates. They must not launch all-strategy verifiers.

The terminal may keep serving previous good latest data with a stale/degraded banner. It must not clear the UI, write empty results, or update latest pointers from degraded reads.

## What Must Be Blocked

- Full scan.
- Desktop snapshot writes.
- Scorecard sync/backfill.
- API unattended all-strategy patrol.
- Battle verifiers for multiple strategies.
- Supabase summary/backfill/upsert jobs started manually.
- Any Codex "one more retry" loop.

## Recovery Sequence

1. Wait at least the `retry_after` window, minimum 10 minutes.
2. Run one light probe only.
3. If the probe fails, extend incident mode.
4. If the probe passes, run one production monitor.
5. Then run strategy verifiers one by one, not in parallel.
6. Exit incident mode only after the above stays green.

```powershell
npm run supabase:incident:status
npm run supabase:incident:exit
```

## Scorecard Language

During incident mode, do not write "strategy logic failed" unless the strategy-specific source and verifier fail after Supabase is readable again.

Correct wording:

```text
Supabase REST / DB pool incident active.
Heavy verification blocked to protect source availability.
Previous good latest preserved.
No empty results or latest pointer updates allowed.
```

## Non-Negotiable Rule

No strategy is allowed to turn a Supabase read outage into an empty latest result. Source failure means preserve previous good and write blocked evidence.
