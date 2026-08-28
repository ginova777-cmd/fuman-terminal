-- Canonical readback shared by Telegram, seven-strategy readers, and Jiang replay.
-- Apply in Supabase before deploying the paired writer release.
-- The table is observation evidence only; it never creates a formal candidate.

begin;

create table if not exists public.fugle_daytrade_intraday_burst_events (
  trade_date date not null,
  symbol text not null,
  name text not null default '',
  candle_time timestamptz not null,
  checked_at timestamptz not null,
  latest_1m_close numeric not null,
  latest_1m_volume numeric not null,
  prior_rolling60_high_close numeric not null,
  prior_rolling60_average_volume numeric not null,
  rolling_sample_count integer not null default 0,
  rolling_baseline_status text not null default '',
  instant_pullup boolean not null default false,
  instant_volume boolean not null default false,
  burst_type text not null check (burst_type in ('pullup', 'volume', 'pullup_and_volume')),
  source_name text not null,
  source_run_id text not null default '',
  quote_age_seconds integer not null default 999999,
  intraday_1m_stale_seconds integer not null default 999999,
  data_status text not null check (data_status in ('OK', 'DATA_GAP')),
  reason_code text not null default '',
  stale_seconds integer not null default 999999,
  primary key (trade_date, symbol, candle_time)
);

create index if not exists fugle_daytrade_intraday_burst_events_trade_date_checked_at_idx
  on public.fugle_daytrade_intraday_burst_events (trade_date, checked_at desc);

create or replace view public.v_fugle_daytrade_intraday_burst_readback as
select
  trade_date,
  symbol,
  name,
  candle_time,
  checked_at,
  latest_1m_close,
  latest_1m_volume,
  prior_rolling60_high_close,
  prior_rolling60_average_volume,
  instant_pullup,
  instant_volume,
  burst_type,
  source_name,
  data_status,
  stale_seconds,
  reason_code,
  source_run_id
from public.fugle_daytrade_intraday_burst_events;

grant select on public.fugle_daytrade_intraday_burst_events to service_role;
grant select on public.v_fugle_daytrade_intraday_burst_readback to anon, authenticated, service_role;

commit;
