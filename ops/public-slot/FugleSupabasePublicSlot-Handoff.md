# Fugle Supabase Public Slot Handoff

Project URL:

```text
https://cpmpfhbzutkiecccekfr.supabase.co
```

## Goal

Only one shared source process should call Fugle / TAIFEX APIs. All strategy scripts should read Supabase first and only fallback to Fugle when Supabase data is missing or stale.

## Final Raw Data Tables

### 1. `fugle_quotes_live`

Latest stock quote per symbol.

```text
symbol, name, market, updated_at
price, open_price, high_price, low_price, previous_close, change_percent
total_volume, trade_value
bid_volume, ask_volume, ask_bid_ratio, ask_ratio
stock_type
limit_up_price, limit_down_price
last_trade_time
is_halted, is_trial
payload
```

### 2. `fugle_intraday_1m`

One-minute stock candles.

```text
symbol, market, trade_date, candle_time
open, high, low, close, volume
updated_at
payload
```

Retention target:

```text
At least latest 200 one-minute candles per symbol.
Preferably latest 2-5 trading days.
```

### 3. `fugle_daily_volume`

Daily stock volume for recent average volume calculations.

```text
symbol, market, trade_date
volume
updated_at
payload
```

### 4. `futopt_tickers`

Stock futures / TXF contract master.

```text
future_symbol
name
product
contract_type
end_date
exchange
underlying_name
underlying_symbol
session
updated_at
payload
```

### 5. `futopt_quotes_live`

Stock futures / TXF live quote.

```text
future_symbol
updated_at
last_price
open_price
high_price
low_price
previous_close
change_percent
total_volume
product
session
payload
```

Store TXF here with:

```text
product = TXF
```

### 6. `fugle_preopen_snapshot`

Preopen trial quote / auction / order book.

```text
symbol, name, market, updated_at
reference_price
trial_price
is_trial
is_limit_up_bid
best_bid_price
best_ask_price
bid_volume
ask_volume
bid1_price, bid1_volume
bid2_price, bid2_volume
bid3_price, bid3_volume
bid4_price, bid4_volume
bid5_price, bid5_volume
ask1_price, ask1_volume
ask2_price, ask2_volume
ask3_price, ask3_volume
ask4_price, ask4_volume
ask5_price, ask5_volume
bid_levels_json
ask_levels_json
payload
```

### 7. `stock_tickers`

Stock universe master.

```text
symbol
name
market
stock_type
industry
type
is_etf
is_suspended
updated_at
payload
```

## PowerShell Helpers

Writer helper, for the shared source machine only:

```text
C:\Users\ginov\Documents\Codex\2026-06-10\fugle-api-1-c-users-qutie\outputs\SupabaseSharedSource.ps1
```

Reader helper, for strategy machines:

```text
C:\Users\ginov\Documents\Codex\2026-06-10\fugle-api-1-c-users-qutie\outputs\SupabaseSharedReader.ps1
```

Final schema:

```text
C:\Users\ginov\Documents\Codex\2026-06-10\fugle-api-1-c-users-qutie\outputs\SupabaseFugleRaw-FinalSchema.sql
```

## Required Key Split

Shared source writer:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

Strategy readers:

```text
SUPABASE_URL
SUPABASE_ANON_KEY
```

Never put `service_role` on viewer or strategy machines.

## Strategy Rule

Strategies should:

```text
1. Read Supabase.
2. Check freshness.
3. If missing/stale, show source abnormal unless an explicit emergency fallback mode is enabled.
4. Never continuously poll Fugle when Supabase is healthy.
```

## Operational Rules

Time:

```text
All timestamp columns are stored as timestamptz / UTC.
Display code may convert to Asia/Taipei.
Do not store mixed Taiwan local string times in timestamp columns.
```

Volume:

```text
All public slot volume fields are normalized to lots.
This includes stock quote volume, 1m volume, daily volume, futures volume, and bid/ask volumes.
```

Universe:

```text
The shared source owns the blacklist and API universe.
Current exclusions: Google Sheet blacklist, 00-prefix / ETF-like symbols, cement, defense / military-related symbols.
Strategy readers should not maintain a separate Fugle API universe.
```

Retention:

```text
fugle_intraday_1m: retain latest 5 trading days and at least 200 rows per symbol.
fugle_daily_volume: retain at least latest 20 trading days.
```

Session:

```text
Use market_calendar.session and source_status.payload.session.
Allowed values: closed, preopen, regular, afterhours.
fugle_preopen_snapshot can be stale after preopen; do not treat that as a regular-session quote failure.
```

Futures:

```text
futopt_quotes_live must include TXF at minimum.
futopt_tickers is the mapping table for underlying_symbol -> future_symbol when stock futures coverage is expanded.
```

Schema:

```text
These tables are raw public slot data only.
Do not add strategy result fields into these raw tables.
Strategy results should use separate result tables later.
```
