# Daytrade 1m Timeline Runbook

This is a release-owner source contract. It does not itself deploy, start a writer, or write Supabase.

## Order of Operations

1. Apply `DaytradeIntraday1mTimelineContract_20260803.sql` in Supabase.
2. Deploy and start the dedicated source writer on the approved writer host.
3. Run `Run-DaytradeIntraday1mGapRepair.ps1 -Apply -Synthesize` once per closed minute, or schedule the wrapper during 09:00-13:30. Use `-Final` after 13:30 to audit the complete 09:00-13:30 set.
4. Run `npm run verify:daytrade-intraday-1m-timeline -- --trade-date=YYYY-MM-DD` read-only before replay or formal publish.

The repair command is sequential and rate-limited. It calls Fugle intraday candles only for symbols with a missing minute. A real REST candle replaces a synthetic row at the same `(symbol, candle_time)` key. Synthetic rows are written only after REST returns no candle and are marked `synthetic_flat`, volume-ineligible, and excluded from replay signal inputs.

## Replay Gate

Replay is allowed only when every audited symbol has an empty `missing_minutes` array. Synthetic rows may close the timeline, but never make volume, relative volume, ranking, or buy/sell conditions usable. Symbol `6257` at 09:16 and 09:17 must show real WebSocket or REST rows for an exact replay; synthetic rows are not evidence of the original signal.

The raw table has a database trigger that rejects an update which would replace a real usable candle with a synthetic or non-usable row. Quote-derived 1m rows are disabled by default in the writer and, if legacy rows remain, are excluded from the timeline and volume-usable view.

## WebSocket Evidence

The collector uses `trades`, `aggregates`, and `candles`, sends one-symbol subscriptions with `intradayOddLot:false`, waits for an authenticated event before subscribing, and records authentication, subscription ack, last message, and last candle time. A reconnect clears authentication state and requires a new auth event before resubscription.
