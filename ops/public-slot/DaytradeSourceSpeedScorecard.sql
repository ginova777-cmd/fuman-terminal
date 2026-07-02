-- Dedicated daytrade source speed scorecard contract.
-- Source-ready only. Do not apply without release-owner approval.

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

grant select on public.fugle_daytrade_source_speed_scorecard to anon;
grant select on public.fugle_daytrade_source_speed_scorecard to authenticated;
grant select, insert, update, delete on public.fugle_daytrade_source_speed_scorecard to service_role;
