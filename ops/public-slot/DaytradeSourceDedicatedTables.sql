-- Dedicated daytrade source tables and read-only contract.
-- Purpose: isolate high-speed daytrade water from the shared terminal source.
-- Safe to run repeatedly in Supabase SQL Editor.

begin;

create table if not exists public.fugle_daytrade_priority_pool (
  symbol text primary key,
  name text,
  market text,
  priority_rank integer not null default 999999,
  priority_reason text,
  source text not null default 'daytrade_priority_pool',
  updated_at timestamp with time zone not null default now(),
  payload jsonb not null default '{}'::jsonb
);

create index if not exists idx_fugle_daytrade_priority_pool_rank
  on public.fugle_daytrade_priority_pool(priority_rank, symbol);

create index if not exists idx_fugle_daytrade_priority_pool_updated_at
  on public.fugle_daytrade_priority_pool(updated_at desc);

create table if not exists public.fugle_daytrade_quotes_live (
  symbol text primary key,
  name text,
  market text,
  updated_at timestamp with time zone,
  quote_seen_at timestamp with time zone not null default now(),
  price numeric,
  open_price numeric,
  high_price numeric,
  low_price numeric,
  previous_close numeric,
  change_percent numeric,
  total_volume numeric,
  trade_value numeric,
  bid_price numeric,
  bid_volume numeric,
  ask_price numeric,
  ask_volume numeric,
  cumulative_bid_volume numeric,
  cumulative_ask_volume numeric,
  cumulative_bid_ask_volume numeric,
  stock_type text,
  session text,
  last_trade_time timestamp with time zone,
  source text not null default 'fugle_daytrade_writer',
  payload jsonb not null default '{}'::jsonb
);

create index if not exists idx_fugle_daytrade_quotes_live_seen_at
  on public.fugle_daytrade_quotes_live(quote_seen_at desc);

create index if not exists idx_fugle_daytrade_quotes_live_updated_at
  on public.fugle_daytrade_quotes_live(updated_at desc);

create table if not exists public.fugle_daytrade_intraday_1m (
  symbol text not null,
  market text,
  candle_time timestamp with time zone not null,
  trade_date date not null,
  open numeric,
  high numeric,
  low numeric,
  close numeric,
  volume numeric,
  source text not null default 'fugle_daytrade_writer',
  synthetic boolean not null default false,
  updated_at timestamp with time zone not null default now(),
  payload jsonb not null default '{}'::jsonb,
  primary key (symbol, candle_time)
);

create index if not exists idx_fugle_daytrade_intraday_1m_trade_date
  on public.fugle_daytrade_intraday_1m(trade_date, symbol, candle_time desc);

create index if not exists idx_fugle_daytrade_intraday_1m_updated_at
  on public.fugle_daytrade_intraday_1m(updated_at desc);

create table if not exists public.fugle_daytrade_daily_volume_avg (
  symbol text primary key,
  market text,
  trade_date date,
  volume numeric,
  avg_volume5 numeric,
  updated_at timestamp with time zone not null default now(),
  source text not null default 'fugle_daytrade_writer:daily_volume_avg_mirror',
  payload jsonb not null default '{}'::jsonb
);

create index if not exists idx_fugle_daytrade_daily_volume_avg_trade_date
  on public.fugle_daytrade_daily_volume_avg(trade_date desc, symbol);

create table if not exists public.fugle_daytrade_futopt_quotes_live (
  future_symbol text primary key,
  underlying_symbol text,
  market text,
  updated_at timestamp with time zone not null default now(),
  price numeric,
  total_volume numeric,
  source text not null default 'fugle_daytrade_writer',
  payload jsonb not null default '{}'::jsonb
);

create index if not exists idx_fugle_daytrade_futopt_underlying
  on public.fugle_daytrade_futopt_quotes_live(underlying_symbol, updated_at desc);

create table if not exists public.fugle_daytrade_source_speed_scorecard (
  id bigserial primary key,
  checked_at timestamp with time zone not null default now(),
  trade_date date not null default current_date,
  source_name text not null default 'fugle_daytrade_source',
  gate_grade text not null default 'D',
  status text not null default 'stopped',
  fresh_quotes_120s integer not null default 0,
  fresh_quote_coverage_120s numeric not null default 0,
  active_symbols integer not null default 0,
  quote_age_seconds integer not null default 999999,
  required_quote_speed_per_sec numeric,
  actual_quote_speed_per_sec numeric,
  priority_symbols integer not null default 0,
  priority_pool_symbols integer not null default 0,
  priority_fresh_quote_coverage_120s numeric not null default 0,
  selected_symbols_fresh_ok boolean not null default false,
  scanner_can_run_opening boolean not null default false,
  scanner_can_run_quote_only boolean not null default false,
  daily_volume_status text not null default 'unknown',
  avg_volume5_eligible integer not null default 0,
  ready_ma20_continuous integer not null default 0,
  ready_ma35_continuous integer not null default 0,
  intraday_1m_stale_seconds integer not null default 999999,
  today_1m_symbols integer not null default 0,
  today_1m_rows integer not null default 0,
  futopt_stock_mapped integer not null default 0,
  rate_limit_status text not null default 'unknown',
  last_429_at timestamp with time zone,
  cooldown_until timestamp with time zone,
  self_heal_count integer not null default 0,
  message text,
  payload jsonb not null default '{}'::jsonb
);

create index if not exists idx_fugle_daytrade_speed_scorecard_latest
  on public.fugle_daytrade_source_speed_scorecard(source_name, checked_at desc);

create index if not exists idx_fugle_daytrade_speed_scorecard_trade_date
  on public.fugle_daytrade_source_speed_scorecard(trade_date desc, checked_at desc);

create or replace view public.v_fugle_daytrade_intraday_1m_status as
with ranked as (
  select
    m.symbol,
    m.market,
    m.candle_time,
    m.trade_date,
    m.updated_at,
    row_number() over (partition by m.symbol order by m.candle_time desc) as rn
  from public.fugle_daytrade_intraday_1m m
),
agg as (
  select
    symbol,
    max(market) as market,
    max(candle_time) as latest_candle_time,
    count(*) filter (where trade_date = current_date)::integer as today_candle_count,
    count(*)::integer as warmup_candle_count,
    count(*)::integer as continuous_candle_count,
    bool_or(rn >= 20) as ready_ma20_continuous,
    bool_or(rn >= 35) as ready_ma35_continuous,
    extract(epoch from (now() - max(candle_time)))::integer as latest_candle_age_seconds
  from ranked
  where rn <= 200
  group by symbol
)
select * from agg;

create or replace view public.v_fugle_daytrade_priority_readiness as
select
  p.symbol,
  p.name,
  p.market,
  p.priority_rank,
  p.priority_reason,
  p.updated_at as priority_updated_at,
  q.quote_seen_at,
  q.updated_at as quote_updated_at,
  coalesce(extract(epoch from (now() - q.quote_seen_at))::integer, 999999) as quote_age_seconds,
  coalesce(q.price, 0) as price,
  coalesce(q.change_percent, 0) as change_percent,
  coalesce(q.total_volume, 0) as total_volume,
  coalesce(d.avg_volume5, 0) as avg_volume5,
  coalesce(s.today_candle_count, 0) as today_candle_count,
  coalesce(s.warmup_candle_count, 0) as warmup_candle_count,
  coalesce(s.continuous_candle_count, 0) as continuous_candle_count,
  coalesce(s.ready_ma20_continuous, false) as ready_ma20_continuous,
  coalesce(s.ready_ma35_continuous, false) as ready_ma35_continuous,
  coalesce(s.latest_candle_age_seconds, 999999) as latest_candle_age_seconds,
  case
    when q.symbol is null then 'quote_missing'
    when coalesce(extract(epoch from (now() - q.quote_seen_at))::integer, 999999) > 120 then 'quote_stale'
    when coalesce(d.avg_volume5, 0) <= 0 then 'daily_volume_missing'
    else 'ready'
  end as readiness_status
from public.fugle_daytrade_priority_pool p
left join public.fugle_daytrade_quotes_live q on q.symbol = p.symbol
left join public.fugle_daytrade_daily_volume_avg d on d.symbol = p.symbol
left join public.v_fugle_daytrade_intraday_1m_status s on s.symbol = p.symbol;

create or replace view public.v_fugle_daytrade_source_latest_scorecard as
select *
from public.fugle_daytrade_source_speed_scorecard
where source_name = 'fugle_daytrade_source'
order by checked_at desc
limit 1;

create or replace view public.v_fugle_daytrade_source_contract_health as
with status_row as (
  select
    s.source_name,
    s.status,
    s.updated_at,
    s.message,
    s.stale_seconds,
    s.payload
  from public.source_status s
  where s.source_name = 'fugle_daytrade_source'
  limit 1
),
priority as (
  select
    count(*)::integer as priority_pool_symbols,
    count(*) filter (where quote_age_seconds <= 120)::integer as priority_fresh_quotes_120s,
    count(*) filter (where readiness_status = 'ready')::integer as priority_ready_rows
  from public.v_fugle_daytrade_priority_readiness
)
select
  coalesce(sr.source_name, 'fugle_daytrade_source') as source_name,
  coalesce(sr.status, 'missing') as source_status,
  sr.updated_at as checked_at,
  coalesce((sr.payload->>'daytrade_gate_grade'), 'D') as daytrade_gate_grade,
  coalesce((sr.payload->>'daytrade_source_speed_ok')::boolean, false) as daytrade_source_speed_ok,
  coalesce((sr.payload->>'scanner_can_run_opening')::boolean, false) as scanner_can_run_opening,
  coalesce((sr.payload->>'scanner_can_run_quote_only')::boolean, false) as scanner_can_run_quote_only,
  coalesce((sr.payload->>'fresh_quote_coverage_120s')::numeric, 0) as fresh_quote_coverage_120s,
  coalesce((sr.payload->>'fresh_quotes_120s')::integer, 0) as fresh_quotes_120s,
  coalesce((sr.payload->>'active_symbols')::integer, 0) as active_symbols,
  coalesce((sr.payload->>'quote_age_seconds')::integer, 999999) as quote_age_seconds,
  coalesce((sr.payload->>'priority_pool_symbols')::integer, p.priority_pool_symbols, 0) as priority_pool_symbols,
  coalesce((sr.payload->>'priority_fresh_quote_coverage_120s')::numeric, 0) as priority_fresh_quote_coverage_120s,
  coalesce((sr.payload->>'daily_volume_status'), 'unknown') as daily_volume_status,
  coalesce((sr.payload->>'ready_ma20_continuous')::integer, 0) as ready_ma20_continuous,
  coalesce((sr.payload->>'ready_ma35_continuous')::integer, 0) as ready_ma35_continuous,
  coalesce((sr.payload->>'intraday_1m_stale_seconds')::integer, 999999) as intraday_1m_stale_seconds,
  coalesce((sr.payload->>'today_1m_symbols')::integer, 0) as today_1m_symbols,
  coalesce((sr.payload->>'today_1m_rows')::integer, 0) as today_1m_rows,
  coalesce((sr.payload->>'futopt_stock_mapped')::integer, 0) as futopt_stock_mapped,
  coalesce((sr.payload->>'rate_limit_status'), 'unknown') as rate_limit_status,
  coalesce(sr.message, 'dedicated daytrade source missing') as message,
  case
    when sr.source_name is null then false
    when sr.status <> 'ok' then false
    when coalesce((sr.payload->>'daytrade_gate_grade'), 'D') <> 'A' then false
    when coalesce((sr.payload->>'daytrade_source_speed_ok')::boolean, false) is not true then false
    when coalesce((sr.payload->>'scanner_can_run_opening')::boolean, false) is not true then false
    else true
  end as formal_entry_allowed,
  case
    when sr.source_name is null then true
    when sr.status <> 'ok' then true
    when coalesce((sr.payload->>'daytrade_gate_grade'), 'D') <> 'A' then true
    else false
  end as stop_new_signals
from priority p
left join status_row sr on true;

grant select on public.fugle_daytrade_priority_pool to anon, authenticated;
grant select on public.fugle_daytrade_quotes_live to anon, authenticated;
grant select on public.fugle_daytrade_intraday_1m to anon, authenticated;
grant select on public.fugle_daytrade_daily_volume_avg to anon, authenticated;
grant select on public.fugle_daytrade_futopt_quotes_live to anon, authenticated;
grant select on public.fugle_daytrade_source_speed_scorecard to anon, authenticated;
grant select on public.v_fugle_daytrade_intraday_1m_status to anon, authenticated;
grant select on public.v_fugle_daytrade_priority_readiness to anon, authenticated;
grant select on public.v_fugle_daytrade_source_latest_scorecard to anon, authenticated;
grant select on public.v_fugle_daytrade_source_contract_health to anon, authenticated;

grant all on public.fugle_daytrade_priority_pool to service_role;
grant all on public.fugle_daytrade_quotes_live to service_role;
grant all on public.fugle_daytrade_intraday_1m to service_role;
grant all on public.fugle_daytrade_daily_volume_avg to service_role;
grant all on public.fugle_daytrade_futopt_quotes_live to service_role;
grant all on public.fugle_daytrade_source_speed_scorecard to service_role;
grant usage, select on sequence public.fugle_daytrade_source_speed_scorecard_id_seq to service_role;

commit;
