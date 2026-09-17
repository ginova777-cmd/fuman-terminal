# Historical minute source probe

## TIB source mapping

The 2254 HTTP 200 response was rejected because its explicit market is TIB. Its saved raw response (`outputs/historical-2254-diagnostic.json`) contains 980 rows. Fugle's official intraday ticker documentation identifies TIB as Taiwan Innovation Board; historical candles documentation specifies whole-lot minute volume in lots, distinct from ESB shares. References: https://developer.fugle.tw/docs/data/http-api/intraday/tickers/ and https://developer.fugle.tw/docs/data/http-api/historical/candles/ .

The historical adapter now accepts explicit TIB only with TWSE exchange and EQUITY type, preserves market/exchange and assigns a distinct `Fugle.historical.candles.1.TIB` source. Its independent price/volume evidence verifier checks that source pairing. Saved 2254 data re-adapts to 980 rows. Wrong exchange and missing type rejection tests pass. This is historical source compatibility, not proof of ordinary-share/daytrade eligibility, current WS mapping, sufficient baseline samples or production completion.

Actual authenticated, read-only Fugle request succeeded for 2330 / 2026-09-16 at 2026-09-17T09:04:24.736Z. HTTP 200, 265 normalized rows. Evidence: `outputs/historical-2330-20260916-source-probe-approved.json`; raw response SHA256 `61b7d1da5f7f7bc15cc74bf43e8d0dc09d05b0b7473671bb1ee79f135d3e5e8e`.

The first sandbox attempt failed transport and is preserved separately as `outputs/historical-2330-20260916-source-probe.json`. The approved read-only request succeeded without writing runtime, Supabase, schedules or notifications.

Official endpoint reference: https://developer.fugle.tw/docs/data/http-api/historical/candles/ . Request uses timeframe=1, an explicit prior-date interval and provider OHLCV. The adapter preserves actual fetch availability; it does not backdate observations.

This proves one symbol/day is retrievable, not historical coverage for the universe. Calendar provenance, 20-session coverage, sufficient same-minute samples, Writer integration, independent DB readback and natural event acceptance remain incomplete. Artifact complete=false and calendar_verified=false are intentional.
