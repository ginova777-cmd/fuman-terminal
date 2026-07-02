# Public Slot Operational Rules

## Source Status

The shared source must write `source_status` every 10-30 seconds.

Recommended source names:

```text
fugle_shared_source
fugle_quotes_live
fugle_intraday_1m
fugle_daily_volume
futopt_quotes_live
fugle_preopen_snapshot
```

Strategies should show source errors when `source_status.updated_at` is older than 45-90 seconds or `status != ok`.

Health fields must use one consistent source of truth:

```text
payload.last_quote_at
payload.quote_age_seconds
source_status.stale_seconds
message quote_age_seconds
```

`quote_age_seconds` is calculated from `last_quote_at`, not from the quote cache file write time. The file age may be exposed only as `quote_cache_file_age_seconds` for debugging.

Do not assume `symbols >= 1000` means healthy. Blacklist filtering can legitimately reduce active symbols. Use:

```text
raw_symbols
active_symbols
blacklist_count
quotes
quote_count
```

Recommended quote health:

```text
status = ok
quotes >= 800
quote_age_seconds <= 120
active_symbols >= 500 or quotes >= 800
```

## Fallback Rule

Strategies should not continuously fallback to Fugle API.

Default behavior:

```text
Supabase healthy -> read Supabase only
Supabase stale -> show source error
Supabase stale and explicit emergency mode -> limited fallback with cooldown
```

Use `Get-PublicSlotFallbackDecision` in `SupabasePublicSlotReader.ps1`.

## Retention Rule

`fugle_intraday_1m` should retain:

```text
latest 5 trading days
and at least latest 200 rows per symbol
```

Run periodically:

```sql
select public.cleanup_fugle_intraday_1m(5);
```

`fugle_daily_volume` should retain at least latest 20 trading days.

Run periodically:

```sql
select public.cleanup_fugle_daily_volume(20);
```

## Startup Schedule Rule

Recommended daily flow:

```text
06:00 start shared source conservative warmup: quotes, stock_tickers, futopt_tickers, market_calendar, daily_volume / avg_volume5, intraday 1m prewarm
08:00 verify shared source warmup is stable and priority symbols are non-zero
08:30 verify quotes / preopen / intraday 1m are continuously writing
08:45 seven-strategy viewer can start reading Supabase-first
09:00 regular market opens
```

Do not use aggressive realtime quote speed before open just to make coverage look healthy. The important part is making the 06:00-08:45 warmup stable, especially terminal-priority pool construction, `fugle_intraday_1m` accumulation, `fugle_daily_volume` readiness, and `fugle_preopen_snapshot` writes.

Strategy readers should use:

```text
v_fugle_intraday_1m_status
v_fugle_intraday_1m_latest_200
```

instead of pulling the whole `fugle_intraday_1m` table.

`source_status.payload` should expose 1m coverage:

```text
intraday_1m_symbols_today
intraday_1m_latest_candle_time
intraday_1m_rows_today
intraday_1m_stale_seconds
```

## Time Rule

Database timestamps are stored as `timestamptz` in UTC ISO format.

Display can convert to Asia/Taipei. Do not store mixed local string times in timestamp columns.

Affected columns include:

```text
source_status.updated_at
source_status.last_success_at
source_status.last_error_at
fugle_quotes_live.updated_at
fugle_quotes_live.last_trade_time
fugle_intraday_1m.candle_time
fugle_intraday_1m.updated_at
fugle_daily_volume.updated_at
futopt_quotes_live.updated_at
fugle_preopen_snapshot.updated_at
stock_tickers.updated_at
market_calendar.updated_at
```

## Volume Rule

All public slot volume fields are normalized to lots.

```text
fugle_quotes_live.total_volume
fugle_quotes_live.bid_volume
fugle_quotes_live.ask_volume
fugle_intraday_1m.volume
fugle_daily_volume.volume
futopt_quotes_live.total_volume
fugle_preopen_snapshot.bid_volume
fugle_preopen_snapshot.ask_volume
bid1_volume ~ bid5_volume
ask1_volume ~ ask5_volume
```

If a Fugle source returns shares, the shared source must convert shares to lots before writing Supabase.

## Universe / Blacklist Rule

Blacklist and universe filtering must be centralized in the shared source.

Current exclusion sources:

```text
Google Sheet blacklist
00-prefix / ETF-like symbols
cement names/symbols
defense / military-related names/symbols
```

Strategy readers should read the public slot universe / quotes and should not maintain a separate Fugle API universe.

## Session Rule

Use `market_calendar.session` and `source_status.payload.session` to distinguish:

```text
closed
preopen
regular
afterhours
```

`fugle_preopen_snapshot` can be stale after preopen. Readers should not treat stale preopen data as a regular-session failure.

## Futures Coverage Rule

`futopt_quotes_live` must at least include TXF. Stock futures can be added as the shared source coverage expands.

`futopt_tickers` is the mapping table for `underlying_symbol -> future_symbol`; strategies should not hard-code this mapping when table data is available.

## Payload Rule

Every raw table has `payload jsonb`.

If Fugle / TAIFEX field meaning is unclear, keep the original raw value in `payload` so strategy logic can be corrected without refetching.

## Key Rule

`service_role` is only for the shared source machine.

Strategy machines and viewers get only `anon`.

## Schema Rule

These tables are raw public slot data only. Do not add strategy result fields here.

Strategy results should use separate result tables later.
