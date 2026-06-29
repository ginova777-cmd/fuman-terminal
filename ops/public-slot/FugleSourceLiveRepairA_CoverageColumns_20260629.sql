-- Fugle source live repair A, 2026-06-29.
-- Run this block first in Supabase SQL Editor.
-- Purpose: add missing fugle_source_coverage columns without touching views.

create table if not exists public.fugle_source_coverage (
  source_name text not null default 'fugle_shared_source',
  trade_date date not null default ((now() at time zone 'Asia/Taipei')::date),
  checked_at timestamptz not null default now(),
  status text not null,
  quote_status text,
  permission_status text,
  preopen_status text,
  intraday_1m_status text,
  daily_volume_status text,
  active_symbols integer not null default 0,
  quotes_symbols integer not null default 0,
  fresh_quotes_120s integer not null default 0,
  preopen_symbols integer not null default 0,
  daily_volume_symbols integer not null default 0,
  daily_volume_avg_symbols integer not null default 0,
  daily_volume_ready_symbols integer not null default 0,
  intraday_1m_symbols_today integer not null default 0,
  intraday_1m_rows_today integer not null default 0,
  today_1m_symbols integer not null default 0,
  today_1m_rows integer not null default 0,
  warmup_candle_count integer not null default 0,
  continuous_candle_count integer not null default 0,
  ready_ge_20_symbols integer not null default 0,
  ready_ge_35_symbols integer not null default 0,
  ready_ge_80_symbols integer not null default 0,
  ready_ge_200_symbols integer not null default 0,
  ready_ma20_continuous_symbols integer not null default 0,
  ready_ma35_continuous_symbols integer not null default 0,
  ready_macd_continuous_symbols integer not null default 0,
  top_movers_ready20_count integer not null default 0,
  top_movers_ready35_count integer not null default 0,
  latest_candle_time timestamptz,
  latest_candle_time_taipei text,
  quote_age_seconds integer not null default 999999,
  intraday_1m_stale_seconds integer not null default 999999,
  scanner_can_run_quote_only boolean not null default false,
  scanner_can_run_opening boolean not null default false,
  scanner_can_run_ma20 boolean not null default false,
  scanner_can_run_ma35 boolean not null default false,
  scanner_can_run_full_intraday boolean not null default false,
  scanner_block_reason text,
  message text,
  payload jsonb not null default '{}'::jsonb,
  primary key (source_name, checked_at),
  constraint fugle_source_coverage_payload_object check (jsonb_typeof(payload) = 'object')
);

alter table public.fugle_source_coverage
  add column if not exists quote_status text,
  add column if not exists permission_status text,
  add column if not exists preopen_status text,
  add column if not exists intraday_1m_status text,
  add column if not exists daily_volume_status text,
  add column if not exists active_symbols integer not null default 0,
  add column if not exists quotes_symbols integer not null default 0,
  add column if not exists fresh_quotes_120s integer not null default 0,
  add column if not exists preopen_symbols integer not null default 0,
  add column if not exists daily_volume_symbols integer not null default 0,
  add column if not exists daily_volume_avg_symbols integer not null default 0,
  add column if not exists daily_volume_ready_symbols integer not null default 0,
  add column if not exists intraday_1m_symbols_today integer not null default 0,
  add column if not exists intraday_1m_rows_today integer not null default 0,
  add column if not exists today_1m_symbols integer not null default 0,
  add column if not exists today_1m_rows integer not null default 0,
  add column if not exists warmup_candle_count integer not null default 0,
  add column if not exists continuous_candle_count integer not null default 0,
  add column if not exists ready_ge_20_symbols integer not null default 0,
  add column if not exists ready_ge_35_symbols integer not null default 0,
  add column if not exists ready_ge_80_symbols integer not null default 0,
  add column if not exists ready_ge_200_symbols integer not null default 0,
  add column if not exists ready_ma20_continuous_symbols integer not null default 0,
  add column if not exists ready_ma35_continuous_symbols integer not null default 0,
  add column if not exists ready_macd_continuous_symbols integer not null default 0,
  add column if not exists top_movers_ready20_count integer not null default 0,
  add column if not exists top_movers_ready35_count integer not null default 0,
  add column if not exists latest_candle_time timestamptz,
  add column if not exists latest_candle_time_taipei text,
  add column if not exists quote_age_seconds integer not null default 999999,
  add column if not exists intraday_1m_stale_seconds integer not null default 999999,
  add column if not exists scanner_can_run_quote_only boolean not null default false,
  add column if not exists scanner_can_run_opening boolean not null default false,
  add column if not exists scanner_can_run_ma20 boolean not null default false,
  add column if not exists scanner_can_run_ma35 boolean not null default false,
  add column if not exists scanner_can_run_full_intraday boolean not null default false,
  add column if not exists scanner_block_reason text,
  add column if not exists message text,
  add column if not exists payload jsonb not null default '{}'::jsonb;

create index if not exists idx_fugle_source_coverage_trade_date_checked
  on public.fugle_source_coverage (trade_date desc, checked_at desc);

create unique index if not exists idx_fugle_source_coverage_source_checked_at_unique
  on public.fugle_source_coverage (source_name, checked_at);

grant select on public.fugle_source_coverage to anon;
grant select on public.fugle_source_coverage to authenticated;
grant select, insert, update on public.fugle_source_coverage to service_role;

notify pgrst, 'reload schema';
