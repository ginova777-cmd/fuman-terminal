# B01 integration evidence — not deployed

Base production SHA: `8bf58ab003af28efb2cca436f19a1516f2660457`.

Scoped port: latest natural candle mapping/order/evidence, early full-active-universe flush after lease and active-symbol fetch but before slow enrichment, bounded anon exact-bar readback using completion-time freshness, source-status evidence attachment. Early mode does not advance historical seed checkpoints. Existing production Writer identity and MA20 code retained.

Executed successfully in this worktree:

- `node --check scripts/run-daytrade-source-writer.js`
- `node scripts/test-daytrade-early-candle-flush.js`
- `node scripts/test-b01-full-market-evidence-wiring.js`
- `node scripts/test-readback-b01-candles.js`
- `node scripts/test-b01-candle-readback.js`
- `node scripts/test-daytrade-writer-identity.js`
- `node scripts/test-daytrade-preopen-ma20-scope.js`
- `git diff --check`
- `npm run verify:contracts` — exit 0; data contracts passed, Strategy4 static contracts intentionally disabled (API-only).

These are isolated tests, not DB execution. Formal deployment, current DB column compatibility, production anon readback, natural freshness/coverage and all 43 item acceptance remain pending. No runtime, DB, schedules or notifications changed. No COMPLETE claim.

## Collector volume contract

Inspection confirmed actual candle normalization is in `lib/fugle-websocket-quotes.js`, called by Collector. It previously converted missing/invalid `data.volume` to zero and unconditionally marked it usable. The candidate now preserves null/unusable for missing, blank, malformed, boolean, object, nonfinite and negative values; explicit natural zero remains valid. `node scripts/test-b01-collector-writer-volume.js` invokes the actual normalizer and Writer mapper and passed all these cases. Early flush, Writer identity and MA20 regressions passed again. Existing cached records are not rewritten or retroactively proven by this test.

## Production read-only compatibility check

Incident guard inactive. Initial sandbox metadata query failed; approved read-only retry succeeded at 2026-09-17T08:22:07Z. All 19 requested Writer columns exist and are not generated. Existing `get_fugle_daytrade_intraday_1m_latest_n(text[],integer)` exposes natural/volume quality booleans and anon EXECUTE=true. Evidence: `C:/Users/ginov/Documents/Codex/2026-09-03/new-chat-4/outputs/b01-deployment-schema-approved-v1.json`. This checks metadata, not write permissions/constraints/triggers or actual candidate insertion.

Actual anon POST readback of frozen 306-symbol plan returned 306 symbols / 918 rows across four HTTP 200 batches (300/300/300/18). All 306 passed the audit's field checks. Evidence: `C:/Users/ginov/Documents/Codex/2026-09-03/new-chat-4/outputs/b01-anon-postclose-deployment-check-v2.json`. This is postclose, existing production data; not full-market, candidate deployment or 120-second natural intraday acceptance. Both reports retain complete=false.
