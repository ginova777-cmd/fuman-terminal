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
  add column if not exists permission_status text,
  add column if not exists fresh_quotes_120s integer not null default 0,
  add column if not exists daily_volume_ready_symbols integer not null default 0,
  add column if not exists today_1m_symbols integer not null default 0,
  add column if not exists today_1m_rows integer not null default 0,
  add column if not exists warmup_candle_count integer not null default 0,
  add column if not exists continuous_candle_count integer not null default 0,
  add column if not exists ready_ge_20_symbols integer not null default 0,
  add column if not exists ready_ma20_continuous_symbols integer not null default 0,
  add column if not exists ready_ma35_continuous_symbols integer not null default 0,
  add column if not exists ready_macd_continuous_symbols integer not null default 0,
  add column if not exists top_movers_ready20_count integer not null default 0,
  add column if not exists top_movers_ready35_count integer not null default 0,
  add column if not exists scanner_can_run_quote_only boolean not null default false,
  add column if not exists scanner_can_run_opening boolean not null default false,
  add column if not exists scanner_can_run_ma20 boolean not null default false,
  add column if not exists scanner_can_run_ma35 boolean not null default false,
  add column if not exists scanner_can_run_full_intraday boolean not null default false,
  add column if not exists scanner_block_reason text;

create index if not exists idx_fugle_source_coverage_trade_date_checked
  on public.fugle_source_coverage (trade_date desc, checked_at desc);

create unique index if not exists idx_fugle_source_coverage_source_checked_at_unique
  on public.fugle_source_coverage (source_name, checked_at);

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'v_fugle_intraday_1m_status'
      and column_name = 'today_candle_count'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'v_fugle_intraday_1m_status'
      and column_name = 'rows_today'
  ) then
    execute 'alter view public.v_fugle_intraday_1m_status rename column today_candle_count to rows_today';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'v_fugle_intraday_1m_status'
      and column_name = 'rows_today'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'v_fugle_intraday_1m_status'
      and column_name = 'today_candle_count'
  ) then
    null;
  end if;
end $$;

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
ranked as (
  select
    *,
    row_number() over (
      partition by symbol
      order by candle_time desc
    ) as rn
  from base
),
windowed as (
  select *
  from ranked
  where rn <= 200
),
grouped as (
  select
    symbol,
    market,
    max(candle_time) as latest_candle_time,
    count(*) as candle_count,
    bool_or(trade_date = taipei_today) as has_today_data,
    max(updated_at) as updated_at,
    min(candle_time) as first_candle_time,
    count(*) filter (where trade_date = taipei_today) as today_candle_count,
    greatest(0, extract(epoch from (now() - max(candle_time)))::integer) as latest_candle_age_seconds,
    count(*) filter (
      where trade_date = taipei_today
        and (candle_time at time zone 'Asia/Taipei')::time >= time '13:00'
    ) as after_1300_candle_count,
    count(*) filter (where trade_date < taipei_today) as warmup_candle_count,
    count(*) as continuous_candle_count,
    (max(candle_time) at time zone 'Asia/Taipei')::text as latest_candle_time_taipei
  from windowed
  group by symbol, market
)
select
  symbol,
  market,
  latest_candle_time,
  candle_count,
  has_today_data,
  updated_at,
  first_candle_time,
  today_candle_count,
  latest_candle_age_seconds,
  (has_today_data and continuous_candle_count >= 35) as ready_ge_35,
  (has_today_data and continuous_candle_count >= 80) as ready_ge_80,
  (has_today_data and continuous_candle_count >= 200) as ready_ge_200,
  (has_today_data and continuous_candle_count >= 35) as ma35_available,
  today_candle_count as rows_today,
  after_1300_candle_count,
  after_1300_candle_count as candles_after_1300,
  (after_1300_candle_count > 0) as has_after_1300_candle,
  latest_candle_time_taipei,
  (has_today_data and continuous_candle_count >= 20) as ready_ge_20,
  warmup_candle_count,
  continuous_candle_count,
  (has_today_data and continuous_candle_count >= 20) as ready_ma20_continuous,
  (has_today_data and continuous_candle_count >= 35) as ready_ma35_continuous,
  (has_today_data and continuous_candle_count >= 80) as ready_macd_continuous
from grouped;

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
  payload,
  permission_status,
  fresh_quotes_120s,
  daily_volume_ready_symbols,
  today_1m_symbols,
  today_1m_rows,
  warmup_candle_count,
  continuous_candle_count,
  ready_ge_20_symbols,
  ready_ma20_continuous_symbols,
  ready_ma35_continuous_symbols,
  ready_macd_continuous_symbols,
  top_movers_ready20_count,
  top_movers_ready35_count,
  scanner_can_run_quote_only,
  scanner_can_run_opening,
  scanner_can_run_ma20,
  scanner_can_run_ma35,
  scanner_can_run_full_intraday,
  scanner_block_reason
from public.fugle_source_coverage
order by source_name, checked_at desc;

create or replace view public.v_daytrade_hot_symbol_readiness as
select
  q.symbol,
  q.name,
  q.price,
  q.open_price,
  case
    when coalesce(q.open_price, 0) > 0 then round(((((q.price - q.open_price) / q.open_price) * 100)::numeric), 4)
    else null
  end as amplitude_from_open,
  q.total_volume,
  q.trade_value,
  d.avg_5d_volume as avg_volume5,
  s.today_candle_count,
  coalesce(s.ready_ma20_continuous, s.ready_ge_20, coalesce(s.continuous_candle_count, 0) >= 20) as ready_ge_20,
  coalesce(s.ready_ma35_continuous, s.ready_ge_35, coalesce(s.continuous_candle_count, 0) >= 35) as ready_ge_35,
  s.latest_candle_time_taipei,
  concat_ws(
    ',',
    case when coalesce(q.change_percent, 0) >= 2 then 'change_percent_ge_2' end,
    case when coalesce(q.total_volume, 0) >= 3000 then 'volume_top_or_liquid' end,
    case when coalesce(q.trade_value, 0) > 0 then 'trade_value_available' end,
    case when coalesce(d.avg_5d_volume, 0) >= 3000 then 'avg_volume5_ge_3000' end,
    case when coalesce(s.ready_ma20_continuous, s.ready_ge_20, coalesce(s.continuous_candle_count, 0) >= 20) then 'ready_ma20_continuous' end,
    case when coalesce(s.ready_ma35_continuous, s.ready_ge_35, coalesce(s.continuous_candle_count, 0) >= 35) then 'ready_ma35_continuous' end
  ) as reason,
  s.warmup_candle_count,
  s.continuous_candle_count,
  coalesce(s.ready_ma20_continuous, s.ready_ge_20, coalesce(s.continuous_candle_count, 0) >= 20) as ready_ma20_continuous,
  coalesce(s.ready_ma35_continuous, s.ready_ge_35, coalesce(s.continuous_candle_count, 0) >= 35) as ready_ma35_continuous,
  coalesce(s.ready_macd_continuous, coalesce(s.continuous_candle_count, 0) >= 80) as ready_macd_continuous
from public.v_fugle_quotes_commonstock_active q
left join public.fugle_daily_volume_avg d
  on d.symbol = q.symbol
left join public.v_fugle_intraday_1m_status s
  on s.symbol = q.symbol
where coalesce(q.change_percent, 0) >= 2
   or coalesce(q.total_volume, 0) >= 3000
   or coalesce(q.trade_value, 0) > 0
   or coalesce(d.avg_5d_volume, 0) >= 3000;

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
  coalesce((s.payload ->> 'intraday_1m_fresh_target_seconds')::integer, 60) as intraday_1m_fresh_target_seconds,
  coalesce((s.payload ->> 'intraday_1m_fresh_hard_seconds')::integer, 120) as intraday_1m_fresh_hard_seconds,
  coalesce((s.payload ->> 'fresh_quote_coverage_120s')::numeric, 0) as fresh_quote_coverage_120s,
  s.payload ->> 'mother_pool_source' as mother_pool_source,
  coalesce((s.payload ->> 'mother_pool_symbols')::integer, 0) as mother_pool_symbols,
  coalesce((s.payload ->> 'mother_pool_filtered')::integer, 0) as mother_pool_filtered,
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
    when s.payload ->> 'permission_status' <> 'ready' then 'permission_not_ready'
    when coalesce((s.payload ->> 'quote_age_seconds')::integer, s.stale_seconds, 999999) > 120 then 'quote_stale'
    when coalesce((s.payload ->> 'fresh_quote_coverage_120s')::numeric, 0) < 0.9
      and coalesce((s.payload ->> 'active_symbols')::integer, 0) >= 1000 then 'quote_fresh_coverage_low'
    when coalesce((s.payload ->> 'quote_derived_1m_full_universe')::boolean, false) <> true then 'quote_derived_not_full_universe'
    when coalesce((s.payload ->> 'intraday_1m_stale_seconds')::integer, 0) > coalesce((s.payload ->> 'intraday_1m_fresh_hard_seconds')::integer, 120) then 'intraday_1m_stale'
    when nullif(s.payload ->> 'scanner_block_reason', '') is not null then s.payload ->> 'scanner_block_reason'
    when s.status not in ('ok', 'degraded') then 'not_ready'
    else 'ready'
  end as source_contract_status,
  s.payload ->> 'permission_status' as permission_status,
  coalesce((s.payload ->> 'today_candle_count')::integer, 0) as today_candle_count,
  coalesce((s.payload ->> 'warmup_candle_count')::integer, 0) as warmup_candle_count,
  coalesce((s.payload ->> 'continuous_candle_count')::integer, 0) as continuous_candle_count,
  coalesce((s.payload ->> 'ready_ge_20_symbols')::integer, 0) as ready_ge_20_symbols,
  coalesce((s.payload ->> 'ready_ma20_continuous_symbols')::integer, 0) as ready_ma20_continuous_symbols,
  coalesce((s.payload ->> 'ready_ma35_continuous_symbols')::integer, 0) as ready_ma35_continuous_symbols,
  coalesce((s.payload ->> 'ready_macd_continuous_symbols')::integer, 0) as ready_macd_continuous_symbols,
  coalesce((s.payload ->> 'fresh_quotes_120s')::integer, 0) as fresh_quotes_120s,
  coalesce((s.payload ->> 'quote_derived_1m_candidate_symbols')::integer, 0) as quote_derived_1m_candidate_symbols,
  coalesce((s.payload ->> 'quote_derived_1m_full_universe')::boolean, false) as quote_derived_1m_full_universe,
  coalesce((s.payload ->> 'quote_derived_1m_rows')::integer, 0) as quote_derived_1m_rows,
  coalesce((s.payload ->> 'quote_derived_1m_opening_backfill_rows')::integer, 0) as quote_derived_1m_opening_backfill_rows,
  coalesce((s.payload ->> 'quote_derived_1m_opening_backfill_symbols')::integer, 0) as quote_derived_1m_opening_backfill_symbols,
  coalesce((s.payload ->> 'daily_volume_ready_symbols')::integer, 0) as daily_volume_ready_symbols,
  coalesce((s.payload ->> 'top_movers_ready20_count')::integer, 0) as top_movers_ready20_count,
  coalesce((s.payload ->> 'top_movers_ready35_count')::integer, 0) as top_movers_ready35_count,
  coalesce((s.payload ->> 'scanner_can_run_quote_only')::boolean, false) as scanner_can_run_quote_only,
  coalesce((s.payload ->> 'scanner_can_run_opening')::boolean, false) as scanner_can_run_opening,
  coalesce((s.payload ->> 'scanner_can_run_ma20')::boolean, false) as scanner_can_run_ma20,
  coalesce((s.payload ->> 'scanner_can_run_ma35')::boolean, false) as scanner_can_run_ma35,
  coalesce((s.payload ->> 'scanner_can_run_full_intraday')::boolean, false) as scanner_can_run_full_intraday,
  nullif(s.payload ->> 'scanner_block_reason', '') as scanner_block_reason
from public.source_status s
left join public.v_fugle_source_latest_coverage c
  on c.source_name = s.source_name;

create or replace function public.get_fugle_intraday_1m_latest_n(
  symbols text[],
  bars_per_symbol integer default 200
)
returns table (
  symbol text,
  market text,
  trade_date date,
  candle_time timestamptz,
  open numeric,
  high numeric,
  low numeric,
  close numeric,
  volume numeric,
  updated_at timestamptz,
  payload jsonb
)
language sql
stable
as $$
  select
    ranked.symbol,
    ranked.market,
    ranked.trade_date,
    ranked.candle_time,
    ranked.open,
    ranked.high,
    ranked.low,
    ranked.close,
    ranked.volume,
    ranked.updated_at,
    ranked.payload
  from (
    select
      m.*,
      row_number() over (
        partition by m.symbol
        order by m.candle_time desc
      ) as rn
    from public.fugle_intraday_1m m
    where m.symbol = any(symbols)
  ) ranked
  where ranked.rn <= greatest(1, least(coalesce(bars_per_symbol, 200), 500))
  order by ranked.symbol asc, ranked.candle_time desc;
$$;

grant select on public.source_status to anon;
grant select on public.fugle_source_coverage to anon;
grant select on public.v_fugle_source_latest_coverage to anon;
grant select on public.v_fugle_source_contract_health to anon;
grant select on public.v_daytrade_hot_symbol_readiness to anon;
grant select on public.v_fugle_intraday_1m_status to anon;

grant select on public.source_status to authenticated;
grant select on public.fugle_source_coverage to authenticated;
grant select on public.v_fugle_source_latest_coverage to authenticated;
grant select on public.v_fugle_source_contract_health to authenticated;
grant select on public.v_daytrade_hot_symbol_readiness to authenticated;
grant select on public.v_fugle_intraday_1m_status to authenticated;

grant select, insert, update on public.source_status to service_role;
grant select, insert, update on public.fugle_source_coverage to service_role;
grant select on public.v_fugle_source_latest_coverage to service_role;
grant select on public.v_fugle_source_contract_health to service_role;
grant select on public.v_daytrade_hot_symbol_readiness to service_role;
grant select on public.v_fugle_intraday_1m_status to service_role;

do $$
declare
  resource text;
begin
  foreach resource in array array[
    'v_fugle_quotes_commonstock_active',
    'fugle_quotes_live',
    'stock_tickers',
    'fugle_daily_volume',
    'fugle_daily_volume_avg',
    'fugle_intraday_1m',
    'market_calendar'
  ] loop
    if to_regclass('public.' || resource) is not null then
      execute format('grant select on public.%I to anon, authenticated, service_role', resource);
    end if;
  end loop;

  if to_regprocedure('public.get_fugle_intraday_1m_latest_n(text[], integer)') is not null then
    execute 'grant execute on function public.get_fugle_intraday_1m_latest_n(text[], integer) to anon, authenticated, service_role';
  end if;
end $$;

notify pgrst, 'reload schema';

-- Required live resources for the shared source contract:
-- v_fugle_quotes_commonstock_active(symbol,name,market,updated_at,price,open_price,high_price,low_price,previous_close,change_percent,total_volume,trade_value,bid_volume,ask_volume,ask_bid_ratio,ask_ratio,cumulative_bid_volume,cumulative_ask_volume,cumulative_bid_ask_volume,stock_type,session,limit_up_price,limit_down_price,last_trade_time,is_halted,is_trial)
-- fugle_quotes_live(symbol,name,market,updated_at,price,open_price,high_price,low_price,previous_close,change_percent,total_volume,trade_value,bid_volume,ask_volume,ask_bid_ratio,ask_ratio,cumulative_bid_volume,cumulative_ask_volume,cumulative_bid_ask_volume,stock_type,session,limit_up_price,limit_down_price,last_trade_time,is_halted,is_trial,payload)
-- stock_tickers(symbol,name,market,stock_type,industry,type,is_etf,is_suspended,updated_at,payload)
-- fugle_daily_volume(symbol,market,trade_date,volume,updated_at,payload)
-- fugle_daily_volume_avg(symbol,market,trade_date,volume,avg5_volume,avg_volume5,updated_at,payload)
-- fugle_intraday_1m(symbol,market,trade_date,candle_time,open,high,low,close,volume,updated_at,payload[source,synthetic,volume_strategy_usable])
-- v_fugle_intraday_1m_status(symbol,market,latest_candle_time,latest_candle_time_taipei,today_candle_count,warmup_candle_count,continuous_candle_count,candle_count,has_today_data,ready_ma20_continuous,ready_ma35_continuous,ready_macd_continuous,ready_ge_20,ready_ge_35,ready_ge_80,ready_ge_200,updated_at)
-- v_fugle_source_contract_health includes hard gates for fresh_quote_coverage_120s >= 0.9, quote_derived_1m_full_universe = true, and intraday_1m_stale_seconds <= intraday_1m_fresh_hard_seconds (default 120).
-- get_fugle_intraday_1m_latest_n(symbols text[], bars_per_symbol integer)
-- v_daytrade_hot_symbol_readiness(symbol,name,price,open_price,amplitude_from_open,total_volume,trade_value,avg_volume5,today_candle_count,warmup_candle_count,continuous_candle_count,ready_ma20_continuous,ready_ma35_continuous,ready_macd_continuous,latest_candle_time_taipei,reason)
-- v_stock_future_live_contract(trade_date,symbol,stock_name,future_symbol,source_symbol,futopt_last_price,futopt_change_percent,futopt_total_volume,futopt_updated_at,txf_future_symbol,txf_change_percent,relative_to_txf_percent,futopt_fresh_60s,txf_fresh_60s,source_status,reason,updated_at)
-- v_strategy12_stock_future_contract_health(contract_rows,ready_rows,stale_rows,not_ready_rows,star_precheck_rows,strategy2_futopt_gate_rows,latest_futopt_updated_at,latest_txf_updated_at,source_status,reason,checked_at)
-- fugle_preopen_snapshot(symbol,name,market,session,updated_at,reference_price,trial_price,is_trial,is_limit_up_bid,best_bid_price,best_ask_price,bid_volume,ask_volume,bid_levels_json,ask_levels_json,payload)
-- fugle_preopen_snapshot_history(symbol,name,market,session,updated_at,reference_price,trial_price,is_trial,is_limit_up_bid,best_bid_price,best_ask_price,bid_volume,ask_volume,bid_levels_json,ask_levels_json,payload)
-- market_calendar(trade_date,market,is_open,session,note,updated_at,payload)
