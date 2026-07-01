-- Fuman shared source read-only observability patch, 2026-07-01.
-- Purpose:
-- 1. Make stock-future quote mapping visible on futopt_quotes_live.
-- 2. Give strategy/audit Codex agents a read-only scorecard view.
-- 3. Do not start writers, refresh caches, or overwrite source_status.

alter table public.futopt_quotes_live
  add column if not exists underlying_symbol text,
  add column if not exists underlying_name text;

create index if not exists idx_futopt_quotes_live_underlying_updated
  on public.futopt_quotes_live (underlying_symbol, updated_at desc);

comment on column public.futopt_quotes_live.underlying_symbol is
  'Read-only mapping copied from futopt_tickers by the shared source writer. Used for source health/audit visibility.';

comment on column public.futopt_quotes_live.underlying_name is
  'Read-only mapping copied from futopt_tickers by the shared source writer. Used for source health/audit visibility.';

create or replace view public.v_fuman_shared_source_readonly_scorecard as
with latest as (
  select
    s.source_name,
    s.status,
    s.updated_at,
    s.message,
    s.stale_seconds,
    s.payload
  from public.source_status s
  where s.source_name = 'fugle_shared_source'
  order by s.updated_at desc nulls last
  limit 1
),
parsed as (
  select
    source_name,
    status,
    updated_at,
    message,
    stale_seconds,
    payload,
    payload ->> 'writer_version' as writer_version,
    payload ->> 'writer_computer' as writer_computer,
    payload ->> 'writer_owner_computer' as writer_owner_computer,
    payload ->> 'build_id' as build_id,
    payload ->> 'scanner_block_reason' as scanner_block_reason,
    payload ->> 'quote_status' as quote_status,
    payload ->> 'intraday_1m_status' as intraday_1m_status,
    payload ->> 'daily_volume_status' as daily_volume_status,
    payload ->> 'preopen_status' as preopen_status,
    payload ->> 'last_quote_at' as last_quote_at,
    payload ->> 'latest_candle_time' as latest_candle_time,
    payload ->> 'latest_candle_time_taipei' as latest_candle_time_taipei,
    payload ->> 'opening_boost_active' as opening_boost_active_text,
    payload ->> 'opening_boost_window' as opening_boost_window,
    payload ->> 'rest_quote_rate_limited' as rest_quote_rate_limited_text,
    payload ->> 'futopt_quote_rate_limited' as futopt_quote_rate_limited_text,
    payload ->> 'quotes_ok' as quotes_ok_text,
    payload ->> 'scanner_can_run_quote_only' as scanner_can_run_quote_only_text,
    payload ->> 'scanner_can_run_opening' as scanner_can_run_opening_text,
    payload ->> 'scanner_can_run_ma20' as scanner_can_run_ma20_text,
    payload ->> 'scanner_can_run_ma35' as scanner_can_run_ma35_text,
    payload ->> 'intraday_1m_ok' as intraday_1m_ok_text,
    payload ->> 'intraday_1m_fresh_ok' as intraday_1m_fresh_ok_text,
    payload ->> 'daily_volume_ok' as daily_volume_ok_text,
    payload ->> 'permission_ok' as permission_ok_text,
    payload ->> 'futopt_ok' as futopt_ok_text,
    payload ->> 'quote_derived_1m_full_universe' as quote_derived_1m_full_universe_text
  from latest
)
select
  source_name,
  status as source_status,
  updated_at as checked_at,
  greatest(0, floor(extract(epoch from (now() - updated_at))))::integer as source_status_age_seconds,
  message,
  stale_seconds,
  writer_version,
  writer_computer,
  writer_owner_computer,
  build_id,
  scanner_block_reason,
  quote_status,
  intraday_1m_status,
  daily_volume_status,
  preopen_status,
  coalesce(nullif(payload ->> 'active_symbols', '')::integer, 0) as active_symbols,
  coalesce(nullif(payload ->> 'eligible_symbols', '')::integer, 0) as eligible_symbols,
  coalesce(nullif(payload ->> 'quotes', '')::integer, 0) as quotes,
  coalesce(nullif(payload ->> 'eligible_quote_rows', '')::integer, 0) as eligible_quote_rows,
  coalesce(nullif(payload ->> 'eligible_quote_coverage', '')::numeric, 0) as eligible_quote_coverage,
  coalesce(nullif(payload ->> 'fresh_quotes_120s', '')::integer, 0) as fresh_quotes_120s,
  coalesce(nullif(payload ->> 'fresh_quote_coverage_120s', '')::numeric, 0) as fresh_quote_coverage_120s,
  coalesce(nullif(payload ->> 'quote_age_seconds', '')::integer, 999999) as quote_age_seconds,
  last_quote_at,
  coalesce(nullif(payload ->> 'fresh_quote_readthrough_rows', '')::integer, 0) as fresh_quote_readthrough_rows,
  coalesce(nullif(payload ->> 'fresh_quote_readthrough_merged_rows', '')::integer, 0) as fresh_quote_readthrough_merged_rows,
  payload ->> 'fresh_quote_readthrough_reason' as fresh_quote_readthrough_reason,
  coalesce(nullif(payload ->> 'rest_quote_attempted', '')::integer, 0) as rest_quote_attempted,
  coalesce(nullif(payload ->> 'rest_quote_rows', '')::integer, 0) as rest_quote_rows,
  coalesce(nullif(payload ->> 'rest_quote_fetched_symbols', '')::integer, 0) as rest_quote_fetched_symbols,
  coalesce(nullif(payload ->> 'rest_quote_batch_size', '')::integer, 0) as rest_quote_batch_size,
  coalesce(nullif(payload ->> 'rest_quote_effective_batch_size', '')::integer, 0) as rest_quote_effective_batch_size,
  coalesce(nullif(payload ->> 'rest_quote_delay_milliseconds', '')::integer, 0) as rest_quote_delay_milliseconds,
  coalesce(nullif(payload ->> 'rest_quote_effective_delay_milliseconds', '')::integer, 0) as rest_quote_effective_delay_milliseconds,
  lower(coalesce(opening_boost_active_text, 'false')) = 'true' as opening_boost_active,
  opening_boost_window,
  lower(coalesce(rest_quote_rate_limited_text, 'false')) = 'true' as rest_quote_rate_limited,
  coalesce(nullif(payload ->> 'intraday_1m_symbols_today', '')::integer, 0) as intraday_1m_symbols_today,
  coalesce(nullif(payload ->> 'today_1m_symbols', '')::integer, 0) as today_1m_symbols,
  coalesce(nullif(payload ->> 'today_1m_rows', '')::integer, 0) as today_1m_rows,
  coalesce(nullif(payload ->> 'today_candle_count', '')::integer, 0) as today_candle_count,
  coalesce(nullif(payload ->> 'warmup_candle_count', '')::integer, 0) as warmup_candle_count,
  coalesce(nullif(payload ->> 'continuous_candle_count', '')::integer, 0) as continuous_candle_count,
  coalesce(nullif(payload ->> 'ready_ma20_continuous', '')::integer, 0) as ready_ma20_continuous,
  coalesce(nullif(payload ->> 'ready_ma35_continuous', '')::integer, 0) as ready_ma35_continuous,
  coalesce(nullif(payload ->> 'ready_macd_continuous', '')::integer, 0) as ready_macd_continuous,
  coalesce(nullif(payload ->> 'ready_ge_80', '')::integer, 0) as ready_ge_80,
  coalesce(nullif(payload ->> 'ready_ge_200', '')::integer, 0) as ready_ge_200,
  coalesce(nullif(payload ->> 'intraday_1m_stale_seconds', '')::integer, 999999) as intraday_1m_stale_seconds,
  latest_candle_time,
  latest_candle_time_taipei,
  coalesce(nullif(payload ->> 'futopt_stock_tickers', '')::integer, 0) as futopt_stock_tickers,
  coalesce(nullif(payload ->> 'futopt_stock_mapped', '')::integer, 0) as futopt_stock_mapped,
  coalesce(nullif(payload ->> 'futopt_stock_quote_universe', '')::integer, 0) as futopt_stock_quote_universe,
  coalesce(nullif(payload ->> 'futopt_stock_this_loop', '')::integer, 0) as futopt_stock_this_loop,
  coalesce(nullif(payload ->> 'futopt_stock_quote_fetched_this_loop', '')::integer, 0) as futopt_stock_quote_fetched_this_loop,
  lower(coalesce(futopt_quote_rate_limited_text, 'false')) = 'true' as futopt_quote_rate_limited,
  lower(coalesce(quotes_ok_text, 'false')) = 'true' as quotes_ok,
  lower(coalesce(scanner_can_run_quote_only_text, 'false')) = 'true' as scanner_can_run_quote_only,
  lower(coalesce(scanner_can_run_opening_text, 'false')) = 'true' as scanner_can_run_opening,
  lower(coalesce(scanner_can_run_ma20_text, 'false')) = 'true' as scanner_can_run_ma20,
  lower(coalesce(scanner_can_run_ma35_text, 'false')) = 'true' as scanner_can_run_ma35,
  lower(coalesce(intraday_1m_ok_text, 'false')) = 'true' as intraday_1m_ok,
  lower(coalesce(intraday_1m_fresh_ok_text, 'false')) = 'true' as intraday_1m_fresh_ok,
  lower(coalesce(daily_volume_ok_text, 'false')) = 'true' as daily_volume_ok,
  lower(coalesce(permission_ok_text, 'false')) = 'true' as permission_ok,
  lower(coalesce(futopt_ok_text, 'false')) = 'true' as futopt_ok,
  lower(coalesce(quote_derived_1m_full_universe_text, 'false')) = 'true' as quote_derived_1m_full_universe,
  case
    when status = 'ok'
      and coalesce(nullif(payload ->> 'fresh_quote_coverage_120s', '')::numeric, 0) >= 0.9
      and lower(coalesce(scanner_can_run_opening_text, 'false')) = 'true'
    then 'ok'
    when coalesce(nullif(payload ->> 'fresh_quote_coverage_120s', '')::numeric, 0) < 0.9
    then 'quote_coverage_low'
    else 'degraded'
  end as readonly_verdict,
  payload,
  coalesce(payload ->> 'primarySource', payload #>> '{websocket_status,primarySource}') as collector_primary_source,
  coalesce(payload ->> 'fallbackSource', payload #>> '{websocket_status,fallbackSource}') as collector_fallback_source,
  coalesce(nullif(payload ->> 'finmindRecoveryRequested', '')::integer, nullif(payload #>> '{websocket_status,finmindRecoveryRequested}', '')::integer, 0) as finmind_recovery_requested,
  coalesce(nullif(payload ->> 'finmindRecoveryFetched', '')::integer, nullif(payload #>> '{websocket_status,finmindRecoveryFetched}', '')::integer, 0) as finmind_recovery_fetched,
  lower(coalesce(payload ->> 'finmindRecoverySkipped', payload #>> '{websocket_status,finmindRecoverySkipped}', 'false')) = 'true' as finmind_recovery_skipped,
  coalesce(payload ->> 'finmindRecoveryError', payload #>> '{websocket_status,finmindRecoveryError}') as finmind_recovery_error,
  coalesce(payload ->> 'finmindRecoveryCooldownUntil', payload #>> '{websocket_status,finmindRecoveryCooldownUntil}') as finmind_recovery_cooldown_until,
  coalesce(payload ->> 'finmindRecoveryLastError', payload #>> '{websocket_status,finmindRecoveryLastError}') as finmind_recovery_last_error
from parsed;

comment on view public.v_fuman_shared_source_readonly_scorecard is
  'Read-only shared source scorecard for strategy/audit Codex agents. Use this to inspect water-source health; do not run writers or deploy from strategy agents.';

grant select on public.v_fuman_shared_source_readonly_scorecard to anon, authenticated, service_role;

notify pgrst, 'reload schema';
