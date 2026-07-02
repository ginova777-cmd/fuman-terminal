-- Dedicated daytrade source bootstrap.
-- Release-owner apply only. This is not production YES.
-- Purpose:
-- 1. Ensure the daytrade speed scorecard table exists.
-- 2. Create the dedicated source_status row as stopped/D.
-- 3. Insert one bootstrap scorecard row as stopped/D evidence.

begin;

create table if not exists public.source_status (
  source_name text primary key,
  trade_date date,
  updated_at timestamptz not null default now(),
  status text not null,
  message text,
  stale_seconds integer not null default 999999,
  last_success_at timestamptz,
  last_error_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  constraint source_status_payload_object check (jsonb_typeof(payload) = 'object')
);

create index if not exists idx_source_status_updated_at
  on public.source_status (updated_at desc);

create table if not exists public.fugle_daytrade_source_speed_scorecard (
  checked_at timestamptz not null default now(),
  trade_date text not null,
  source_name text not null default 'fugle_daytrade_source',
  gate_grade text not null check (gate_grade in ('A', 'B', 'C', 'D')),
  gate_mode text not null default 'priority_first',
  priority_gate_grade text not null default 'D' check (priority_gate_grade in ('A', 'B', 'C', 'D')),
  full_market_gate_grade text not null default 'C' check (full_market_gate_grade in ('A', 'B', 'C', 'D')),
  status text not null check (status in ('ok', 'degraded', 'stale', 'error', 'stopped')),
  fresh_quotes_120s integer not null default 0,
  fresh_quote_coverage_120s numeric not null default 0,
  active_symbols integer not null default 0,
  quote_age_seconds integer not null default 999999,
  required_quote_speed_per_sec numeric not null default 12.5,
  actual_quote_speed_per_sec numeric not null default 0,
  batch_size integer not null default 40,
  batch_interval_seconds numeric not null default 0,
  priority_symbols integer not null default 0,
  selected_symbols_fresh_ok boolean not null default false,
  eligible_quote_rows integer not null default 0,
  priority_pool_symbols integer not null default 0,
  priority_fresh_quotes_120s integer not null default 0,
  priority_fresh_quote_coverage_120s numeric not null default 0,
  full_market_round_seconds integer not null default 999999,
  scanner_can_run_opening boolean not null default false,
  scanner_can_run_quote_only boolean not null default false,
  daily_volume_status text not null default 'not_ready',
  avg_volume5_eligible integer not null default 0,
  ready_ma20_continuous integer not null default 0,
  ready_ma35_continuous integer not null default 0,
  intraday_1m_stale_seconds integer not null default 999999,
  today_1m_symbols integer not null default 0,
  today_1m_rows integer not null default 0,
  futopt_stock_mapped integer not null default 0,
  rate_limit_status text not null default 'unknown',
  last_429_at timestamptz,
  last_429_age_seconds integer not null default 999999,
  cooldown_until timestamptz,
  full_market_paused_until timestamptz,
  finmind_cooldown_until timestamptz,
  quota_competing_stages text[] not null default '{}'::text[],
  self_heal_count integer not null default 0,
  message text not null default '',
  payload jsonb not null default '{}'::jsonb
);

create index if not exists idx_daytrade_source_speed_scorecard_checked_at
  on public.fugle_daytrade_source_speed_scorecard (checked_at desc);

create index if not exists idx_daytrade_source_speed_scorecard_trade_date
  on public.fugle_daytrade_source_speed_scorecard (trade_date, checked_at desc);

grant select on public.source_status to anon;
grant select on public.source_status to authenticated;
grant select, insert, update on public.source_status to service_role;

grant select on public.fugle_daytrade_source_speed_scorecard to anon;
grant select on public.fugle_daytrade_source_speed_scorecard to authenticated;
grant select, insert, update, delete on public.fugle_daytrade_source_speed_scorecard to service_role;

insert into public.source_status (
  source_name,
  trade_date,
  updated_at,
  status,
  message,
  stale_seconds,
  payload
) values (
  'fugle_daytrade_source',
  (now() at time zone 'Asia/Taipei')::date,
  now(),
  'stopped',
  'dedicated daytrade source bootstrap only; writer not started; production unattended NO',
  999999,
  jsonb_build_object(
    'source_name', 'fugle_daytrade_source',
    'daytrade_gate_grade', 'D',
    'daytrade_source_speed_ok', false,
    'gate_mode', 'priority_first',
    'priority_gate_grade', 'D',
    'full_market_gate_grade', 'C',
    'fresh_quote_window_seconds', 120,
    'fresh_quotes_120s', 0,
    'fresh_quote_coverage_120s', 0,
    'active_symbols', 0,
    'quote_age_seconds', 999999,
    'required_quote_speed_per_sec', 12.5,
    'actual_quote_speed_per_sec', 0,
    'batch_size', 40,
    'batch_interval_seconds', 3.2,
    'priority_symbols', 0,
    'priority_pool_symbols', 0,
    'priority_fresh_quotes_120s', 0,
    'priority_fresh_quote_coverage_120s', 0,
    'selected_symbols_fresh_ok', false,
    'eligible_quote_rows', 0,
    'scanner_can_run_opening', false,
    'scanner_can_run_quote_only', false,
    'daily_volume_status', 'not_ready',
    'avg_volume5_eligible', 0,
    'ready_ma20_continuous', 0,
    'ready_ma35_continuous', 0,
    'intraday_1m_stale_seconds', 999999,
    'today_1m_symbols', 0,
    'today_1m_rows', 0,
    'futopt_stock_mapped', 0,
    'rate_limit_status', 'stopped',
    'last_429_at', null,
    'last_429_age_seconds', 999999,
    'cooldown_until', null,
    'full_market_round_seconds', 999999,
    'full_market_batch_interval_seconds', 0,
    'full_market_paused_until', null,
    'finmind_cooldown_until', null,
    'quota_competing_stages', jsonb_build_array(),
    'self_heal_count', 0,
    'last_self_heal_at', null,
    'last_self_heal_reason', '',
    'bootstrap_only', true,
    'production_unattended', 'NO'
  )
) on conflict (source_name) do update set
  trade_date = excluded.trade_date,
  updated_at = excluded.updated_at,
  status = excluded.status,
  message = excluded.message,
  stale_seconds = excluded.stale_seconds,
  payload = excluded.payload;

insert into public.fugle_daytrade_source_speed_scorecard (
  trade_date,
  source_name,
  gate_grade,
  gate_mode,
  priority_gate_grade,
  full_market_gate_grade,
  status,
  message,
  payload
) values (
  to_char((now() at time zone 'Asia/Taipei')::date, 'YYYYMMDD'),
  'fugle_daytrade_source',
  'D',
  'priority_first',
  'D',
  'C',
  'stopped',
  'bootstrap row only; dedicated writer not started; production unattended NO',
  jsonb_build_object(
    'bootstrap_only', true,
    'production_unattended', 'NO',
    'writer_started', false,
    'scanner_started', false
  )
);

commit;
