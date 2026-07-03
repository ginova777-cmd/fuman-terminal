-- Dedicated daytrade source bootstrap.
-- Purpose: create the independent daytrade source status row without implying production readiness.
-- Safe to run repeatedly in Supabase SQL Editor.

begin;

insert into public.source_status (
  source_name,
  trade_date,
  status,
  updated_at,
  message,
  stale_seconds,
  payload
)
values (
  'fugle_daytrade_source',
  current_date,
  'stopped',
  now(),
  'dedicated daytrade source bootstrap; writer has not proven live readiness',
  999999,
  jsonb_build_object(
    'source_name', 'fugle_daytrade_source',
    'writer_version', 'bootstrap',
    'daytrade_gate_grade', 'D',
    'daytrade_source_speed_ok', false,
    'gate_mode', 'priority_first',
    'fresh_quote_window_seconds', 120,
    'fresh_quotes_120s', 0,
    'fresh_quote_coverage_120s', 0,
    'active_symbols', 0,
    'quote_age_seconds', 999999,
    'priority_pool_symbols', 0,
    'priority_fresh_quotes_120s', 0,
    'priority_fresh_quote_coverage_120s', 0,
    'selected_symbols_fresh_ok', false,
    'scanner_can_run_opening', false,
    'scanner_can_run_quote_only', false,
    'daily_volume_status', 'unknown',
    'ready_ma20_continuous', 0,
    'ready_ma35_continuous', 0,
    'intraday_1m_stale_seconds', 999999,
    'today_1m_symbols', 0,
    'today_1m_rows', 0,
    'futopt_stock_mapped', 0,
    'rate_limit_status', 'bootstrap',
    'last_429_age_seconds', 999999,
    'cooldown_until', null,
    'self_heal_count', 0,
    'last_self_heal_at', null,
    'last_self_heal_reason', '',
    'formal_entry_allowed', false,
    'stop_new_signals', true
  )
)
on conflict (source_name) do update set
  trade_date = excluded.trade_date,
  status = excluded.status,
  updated_at = excluded.updated_at,
  message = excluded.message,
  stale_seconds = excluded.stale_seconds,
  payload = excluded.payload;

commit;

