-- Supabase public slot strategy read views and health patch.
-- Run once in Supabase SQL Editor.

create or replace view public.v_fugle_quotes_commonstock_active as
select
  symbol,
  name,
  market,
  stock_type,
  session,
  updated_at,
  last_trade_time,
  price,
  open_price,
  high_price,
  low_price,
  previous_close,
  change_percent,
  total_volume,
  trade_value,
  bid_volume,
  ask_volume,
  ask_bid_ratio,
  ask_ratio,
  cumulative_bid_volume,
  cumulative_ask_volume,
  cumulative_bid_ask_volume,
  is_halted,
  is_trial,
  payload
from public.fugle_quotes_live
where coalesce(stock_type, 'COMMONSTOCK') = 'COMMONSTOCK'
  and coalesce(is_halted, false) = false
  and coalesce(is_trial, false) = false
  and market in ('TSE', 'OTC')
  and symbol ~ '^[0-9]{4}$'
  and symbol not like '00%'
  and upper(symbol) <> 'TEST'
  and price between 10 and 1000;

create or replace view public.v_fugle_intraday_1m_status as
with base as (
  select
    symbol,
    market,
    candle_time,
    trade_date,
    updated_at,
    ((now() at time zone 'Asia/Taipei')::date) as taipei_today
  from public.fugle_intraday_1m
),
grouped as (
  select
    symbol,
    market,
    max(candle_time) as latest_candle_time,
    count(*) as candle_count,
    count(*) filter (where trade_date = taipei_today) as rows_today,
    bool_or(trade_date = taipei_today) as has_today_data,
    max(updated_at) as updated_at
  from base
  group by symbol, market
)
select
  symbol,
  market,
  latest_candle_time,
  candle_count,
  rows_today,
  (rows_today >= 35) as ready_ge_35,
  (rows_today >= 80) as ready_ge_80,
  (rows_today >= 200) as ready_ge_200,
  has_today_data,
  updated_at
from grouped;

create or replace view public.v_fugle_intraday_1m_latest_200 as
select
  symbol,
  market,
  trade_date,
  candle_time,
  open,
  high,
  low,
  close,
  volume,
  updated_at,
  payload
from (
  select
    m.*,
    row_number() over (
      partition by m.symbol
      order by m.candle_time desc
    ) as rn
  from public.fugle_intraday_1m m
) ranked
where rn <= 200;

create table if not exists public.source_error_log (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  source_name text,
  endpoint text,
  symbol text,
  market text,
  error_type text,
  status_code integer,
  message text,
  retry_after_seconds integer,
  payload jsonb default '{}'::jsonb
);

create index if not exists idx_source_error_log_created_at
  on public.source_error_log (created_at desc);

create index if not exists idx_source_error_log_source_created
  on public.source_error_log (source_name, created_at desc);

grant select on public.v_fugle_quotes_commonstock_active to anon;
grant select on public.v_fugle_intraday_1m_status to anon;
grant select on public.v_fugle_intraday_1m_latest_200 to anon;
grant select on public.source_error_log to anon;

grant select, insert on public.source_error_log to service_role;
grant usage, select on sequence public.source_error_log_id_seq to service_role;
