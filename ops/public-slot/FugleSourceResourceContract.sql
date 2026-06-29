-- Fugle shared source resource contract.
-- Run in Supabase SQL Editor before enabling production publish gates.
-- Contract version: fugle-source-contract-20260629-01

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

create table if not exists public.fugle_source_coverage (
  source_name text not null default 'fugle_shared_source',
  trade_date date not null default ((now() at time zone 'Asia/Taipei')::date),
  checked_at timestamptz not null default now(),
  status text not null,
  quote_status text,
  preopen_status text,
  intraday_1m_status text,
  daily_volume_status text,
  active_symbols integer not null default 0,
  quotes_symbols integer not null default 0,
  preopen_symbols integer not null default 0,
  daily_volume_symbols integer not null default 0,
  daily_volume_avg_symbols integer not null default 0,
  intraday_1m_symbols_today integer not null default 0,
  intraday_1m_rows_today integer not null default 0,
  ready_ge_35_symbols integer not null default 0,
  ready_ge_80_symbols integer not null default 0,
  ready_ge_200_symbols integer not null default 0,
  latest_candle_time timestamptz,
  latest_candle_time_taipei text,
  quote_age_seconds integer not null default 999999,
  intraday_1m_stale_seconds integer not null default 999999,
  message text,
  payload jsonb not null default '{}'::jsonb,
  primary key (source_name, checked_at),
  constraint fugle_source_coverage_payload_object check (jsonb_typeof(payload) = 'object')
);

create index if not exists idx_fugle_source_coverage_trade_date_checked
  on public.fugle_source_coverage (trade_date desc, checked_at desc);

create or replace view public.v_fugle_source_latest_coverage as
select distinct on (source_name)
  source_name,
  trade_date,
  checked_at,
  status,
  quote_status,
  preopen_status,
  intraday_1m_status,
  daily_volume_status,
  active_symbols,
  quotes_symbols,
  preopen_symbols,
  daily_volume_symbols,
  daily_volume_avg_symbols,
  intraday_1m_symbols_today,
  intraday_1m_rows_today,
  ready_ge_35_symbols,
  ready_ge_80_symbols,
  ready_ge_200_symbols,
  latest_candle_time,
  latest_candle_time_taipei,
  quote_age_seconds,
  intraday_1m_stale_seconds,
  message,
  payload
from public.fugle_source_coverage
order by source_name, checked_at desc;

create or replace view public.v_fugle_source_contract_health as
select
  s.source_name,
  s.trade_date,
  s.updated_at,
  s.status,
  s.stale_seconds,
  s.message,
  s.payload ->> 'source_contract_version' as source_contract_version,
  s.payload ->> 'writer_version' as writer_version,
  s.payload ->> 'quote_status' as quote_status,
  s.payload ->> 'preopen_status' as preopen_status,
  s.payload ->> 'intraday_1m_status' as intraday_1m_status,
  s.payload ->> 'daily_volume_status' as daily_volume_status,
  coalesce((s.payload ->> 'quote_age_seconds')::integer, s.stale_seconds, 999999) as quote_age_seconds,
  coalesce((s.payload ->> 'intraday_1m_stale_seconds')::integer, 999999) as intraday_1m_stale_seconds,
  coalesce((s.payload ->> 'active_symbols')::integer, 0) as active_symbols,
  coalesce((s.payload ->> 'quotes')::integer, 0) as quotes,
  coalesce((s.payload ->> 'eligible_quote_rows')::integer, 0) as eligible_quote_rows,
  coalesce((s.payload ->> 'intraday_1m_symbols_today')::integer, 0) as intraday_1m_symbols_today,
  coalesce((s.payload ->> 'ready_ge_35_symbols')::integer, 0) as ready_ge_35_symbols,
  coalesce((s.payload ->> 'ready_ge_80_symbols')::integer, 0) as ready_ge_80_symbols,
  coalesce((s.payload ->> 'ready_ge_200_symbols')::integer, 0) as ready_ge_200_symbols,
  c.checked_at as latest_coverage_checked_at,
  c.status as latest_coverage_status,
  case
    when s.payload ->> 'source_contract_version' <> 'fugle-source-contract-20260629-01' then 'contract_mismatch'
    when s.updated_at < now() - interval '120 seconds' then 'heartbeat_stale'
    when coalesce((s.payload ->> 'quote_age_seconds')::integer, s.stale_seconds, 999999) > 120 then 'quote_stale'
    when coalesce((s.payload ->> 'intraday_1m_stale_seconds')::integer, 0) > 180 then 'intraday_1m_stale'
    when s.status not in ('ok', 'degraded') then 'not_ready'
    else 'ready'
  end as source_contract_status
from public.source_status s
left join public.v_fugle_source_latest_coverage c
  on c.source_name = s.source_name;

grant select on public.source_status to anon;
grant select on public.fugle_source_coverage to anon;
grant select on public.v_fugle_source_latest_coverage to anon;
grant select on public.v_fugle_source_contract_health to anon;

grant select, insert, update on public.source_status to service_role;
grant select, insert, update on public.fugle_source_coverage to service_role;

-- Required live resources for the shared source contract:
-- v_fugle_quotes_commonstock_active(symbol,name,market,updated_at,price,open_price,high_price,low_price,previous_close,change_percent,total_volume,trade_value,bid_volume,ask_volume,ask_bid_ratio,ask_ratio,cumulative_bid_volume,cumulative_ask_volume,cumulative_bid_ask_volume,stock_type,session,limit_up_price,limit_down_price,last_trade_time,is_halted,is_trial)
-- fugle_quotes_live(symbol,name,market,updated_at,price,open_price,high_price,low_price,previous_close,change_percent,total_volume,trade_value,bid_volume,ask_volume,ask_bid_ratio,ask_ratio,cumulative_bid_volume,cumulative_ask_volume,cumulative_bid_ask_volume,stock_type,session,limit_up_price,limit_down_price,last_trade_time,is_halted,is_trial,payload)
-- stock_tickers(symbol,name,market,stock_type,industry,type,is_etf,is_suspended,updated_at,payload)
-- fugle_daily_volume(symbol,market,trade_date,volume,updated_at,payload)
-- fugle_daily_volume_avg(symbol,market,trade_date,volume,avg5_volume,avg_volume5,updated_at,payload)
-- fugle_intraday_1m(symbol,market,trade_date,candle_time,open,high,low,close,volume,updated_at,payload)
-- v_fugle_intraday_1m_status(symbol,market,latest_candle_time,today_candle_count,candle_count,has_today_data,ready_ge_35,ready_ge_80,ready_ge_200,updated_at)
-- get_fugle_intraday_1m_latest_n(symbols text[], bars_per_symbol integer)
-- v_stock_future_live_contract(trade_date,symbol,stock_name,future_symbol,source_symbol,futopt_last_price,futopt_change_percent,futopt_total_volume,futopt_updated_at,txf_future_symbol,txf_change_percent,relative_to_txf_percent,futopt_fresh_60s,txf_fresh_60s,source_status,reason,updated_at)
-- v_strategy12_stock_future_contract_health(contract_rows,ready_rows,stale_rows,not_ready_rows,star_precheck_rows,strategy2_futopt_gate_rows,latest_futopt_updated_at,latest_txf_updated_at,source_status,reason,checked_at)
-- fugle_preopen_snapshot(symbol,name,market,session,updated_at,reference_price,trial_price,is_trial,is_limit_up_bid,best_bid_price,best_ask_price,bid_volume,ask_volume,bid_levels_json,ask_levels_json,payload)
-- fugle_preopen_snapshot_history(symbol,name,market,session,updated_at,reference_price,trial_price,is_trial,is_limit_up_bid,best_bid_price,best_ask_price,bid_volume,ask_volume,bid_levels_json,ask_levels_json,payload)
-- market_calendar(trade_date,market,is_open,session,note,updated_at,payload)
