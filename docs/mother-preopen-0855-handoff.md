# TG-MOTHERPOOL-TRIAL-0855-20260930

Status: IMPLEMENTATION_DRAFT / NOT_DEPLOYED / NOT_NATURALLY_VERIFIED.

## Producer and evidence

The authenticated daytrade collector callback in `scripts/fugle-websocket-collector.js`
captures original aggregates/trades before quote merging. The new journal does not
create connections or change the subscription plan. Its bounded asynchronous queue
reports disk failures and overflow through collector `preopenJournal` health.

Existing provider-side and provider-trade journals explicitly reject trial events.
The existing Telegram trial archive accepts 08:59 only. Neither proves an 08:55
archive. Historical 08:55 recovery remains unproven; latest quotes are not accepted.

Fugle stock aggregates documents `lastTrial.time`, `lastTrial.price`, `openPrice`
and `openTime`: https://developer.fugle.tw/docs/data/websocket-api/market-data-channels/aggregates/

## Input requiring Telegram agreement

The formal candidate file path is not yet identified. `seven-stage1.json` is a
full-market scan, not an agreed candidate union. Do not infer ranking cutoffs.
Telegram must provide the union (long, short, alert and experimental candidates),
using this proposed input contract:

```json
{
  "contract": "telegram_mother_preopen_candidates_v1",
  "base_date": "YYYY-MM-DD",
  "trade_date": "YYYY-MM-DD",
  "symbols": [{"stock_id": "6531", "name": "example"}]
}
```

All symbols are deduplicated, never truncated. The exact candidate file bytes are
hashed. Dates are checked with the existing authoritative calendar evidence
contract and previous-session resolver; no calendar-yesterday shortcut.
The calendar JSON must match the writer's `market_calendar` row shape.

## Proposed shared paths

Raw journal: `C:\fuman-runtime\data\mother-pool\preopen-raw\YYYY-MM-DD\STOCK.jsonl`.
Publication root: `C:\fuman-runtime\data\mother-pool\preopen\YYYY-MM-DD`.
Read `receipt.json` first, then the two immutable hashed revision files referenced
by `files`: `revisions/UUID/trial-0855.json` and `actual-open.json`.
This replaces the proposed two mutable top-level JSON files, so a consumer cannot
accidentally combine two generations. Receipt replacement is atomic; publications
have an exclusive file lock. Old revisions remain readable. A finalized receipt
requires an explicit revision reason for any subsequent publication.

These paths are proposed by the implementation and have not been provisioned in
production. `scripts/read-mother-preopen.cjs` verifies dates, run identity and file
hashes. It is a local read only and never fetches quotes.

## Semantics

Only native event time inside [08:55:00,08:56:00) qualifies. The event's own trial
flag is required. Full provider microseconds are retained for last-event ordering
and conflict detection. Any conflicting price at the same event timestamp blocks
confirmation for that stock. Test/synthetic/mismatched data is rejected and recorded
in diagnostics. Provisional prices do not become selected prices before finalization.

Opening fallback currently requires both native openPrice and openTime on the
correct date. Missing opening time leaves WAITING; no timestamp is invented.
Confirmed opening fallback leaves the trial missing/conflict status intact.
08:56, 08:59 and closing trials cannot replace 08:55. Counts refer to requested
symbols; opening coverage is separate. `complete` remains false pending natural
capture and Telegram acceptance. There is no notification or order path.

## Execution and remaining integration

Existing collector task: `Fuman Fugle Daytrade WebSocket Collector 0600-1330`,
enabled, next start observed as 2026-10-01 06:00 Asia/Taipei.
This task does NOT yet contain the new deployed journal.

`scripts/build-mother-preopen.cjs` accepts explicit candidates, calendar, raw-root,
output-root and producer-version arguments; it publishes from archived originals.
It is an offline builder, not an installed automatic schedule.

After the candidate path is confirmed, remaining implementation must connect a
bounded natural finalizer to the existing collector lifecycle (08:55 provisional,
08:56 final, later opening revisions), supply calendar and subscription evidence,
and verify that journal health/drain is clean before publication. Do not describe
the draft callback plus offline builder as natural scheduling completion.

Requested coverage and missing symbols remain UNKNOWN until the candidate union
is available. Compare it against acknowledged aggregates/trades subscriptions,
not generic candle subscriptions or cache row count. Capacity changes require a
concrete coverage plan and must preserve existing strategy subscriptions.

## Verification

`node scripts/test-mother-preopen.cjs`: isolated passing tests for last-event
selection, boundary exclusion, conflicts, synthetic/date rejection, missing open
time, actual opening fallback, immutable revisions, duplicate suppression and
independent file hash/date readback. These are fixtures, not natural market data.

Not yet accepted: deployment, automatic finalizer, candidate coverage, live journal
failure recovery across restarts, real 08:55 capture, Telegram consumer/UI readback,
and natural 6531 sample agreement. No runtime, schedules, database or external
notifications have been modified by this draft.
