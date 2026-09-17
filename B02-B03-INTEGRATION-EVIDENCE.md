# B02 / B03 integration evidence — 2026-09-17

Status: LOCAL_INTEGRATION_TESTED, NOT_DEPLOYED. This is not a production receipt.
Base commit: 00e6d801b68904fa2b499b31d367e7250d9bd852.

## Source and field chain

- B02 volume: existing native cumulative volume evidence; explicit shares/lots; lots × 1000.
- B02 amount: aggregates or REST quote `total.tradeValue`, TWD; `total.time` is the source event timestamp. No price × volume fallback.
- Collector caches tradeValueEvidence; Writer maps WebSocket / REST evidence, computes full-universe volume and value rankings and writes `source_status.payload.volume_value_ranking`.
- B03 retains official outstanding-share evidence and the existing turnover ranking; malformed inputs and conversion overflow are isolated, not coerced to valid values.
- One anon source_status read is shared, but B02 and B03 are independently verified against the exact expected payload. They produce separate receipts. A failing verifier or receipt write must not suppress the other verification.
- B02 saves a run-ID history receipt plus the daily latest receipt. B03 retains its run-ID history and daily receipt. Receipt write errors remain visible to the runner.

## Executed local checks

All commands below exited 0 in this candidate after the changes:

1. `node --check scripts/run-daytrade-source-writer.js`
2. `node scripts/test-b02-b03-independent-receipts.js`
3. `node scripts/test-daytrade-volume-value-ranking.js`
4. `node scripts/test-daytrade-turnover-completion-contract.js` — 34 checks
5. `node scripts/test-daytrade-early-candle-flush.js`
6. `node scripts/test-readback-b01-candles.js`
7. `npm run verify:contracts`

The Writer receipt test executes the extracted Writer block with injected I/O; it does not write to Supabase or production runtime. Arithmetic verifiers are tested separately. These tests do not establish natural production coverage or live anon permissions.

## Remaining acceptance

- Review and authorize publication / deployment of this candidate; no push, merge or deployment performed for this change.
- Verify production source_status read permission using the receiver's anon role without exposing credentials.
- Run the deployed Writer during a natural trading session; retain run ID, source event times, full-universe counts, per-stock gaps, exact same-batch readback and both receipts.
- Verify received amount and volume against raw provider events, and outstanding shares against applicable official master records.
- Preserve gaps; do not label every stock usable merely because its gap was correctly reported.
- This change does not complete A01–A19 / B01–B24 or prove industry flow calculations use these new amount fields.
# Native cumulative evidence follow-up

`test-native-cumulative-evidence.js` passed: invalid raw timestamp types and out-of-range timestamps now become explicit volume/value DATA_GAP rather than crashing normalization; missing input envelopes are isolated; numeric stock IDs are rejected instead of implicitly coerced. Valid raw cumulative volume and amount preserve provider fields and timestamps. No current-price-times-volume fallback was introduced.

Rechecked `test-daytrade-volume-value-ranking.js`, all 34 `test-daytrade-turnover-completion-contract.js` cases, and `test-b02-b03-independent-receipts.js`; all passed. This is isolated evidence only, not actual production anon readback or deployment. Full B02/B03 completion remains unproven.
