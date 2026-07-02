-- Dedicated daytrade source tables.
-- Release-owner apply only. This is not production YES.
-- Purpose:
-- 1. Give fugle_daytrade_source its own priority, quote, 1m, daily, and futopt read model.
-- 2. Keep daytrade / Strategy1 / Strategy3 from using fugle_shared_source as readiness authority.
-- 3. Expose read-only views for verifier and PS1 consumers.

begin;

create table if not exists public.fugle_daytrade_priority_symbols (
  trade_date date not null default ((now() at time zone 'Asia/Taipei')::date),
  symbol text not null,
  name text,
  market text,
  priority_rank integer not null default 999999,
  priority_source text not null default 'unknown',
  priority_reason text,
  consumer_scope text[] not null default array['daytrade','strategy1','strategy3']::text[],
  selected boolean not null default true,
  score numeric not null default 0,
  updated_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  primary key (trade_date, symbol),
  constraint fugle_daytrade_priority_symbol_code check (symbol ~ '^[0-9]{4}$'),
  constraint fugle_daytrade_priority_payload_object check (jsonb_typeof(payload) = 'object')
);

create index if not exists idx_daytrade_priority_symbols_updated
  on public.fugle_daytrade_priority_symbols (trade_date desc, selected, priority_rank asc, updated_at desc);

create table if not exists public.fugle_daytrade_quotes_live (
  symbol text primary key,
  name text,
  market text,
  updated_at timestamptz not null default now(),
  quote_seen_at timestamptz not null default now(),
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
  last_trade_time timestamptz,
  source text not null default 'fugle_daytrade_writer',
  payload jsonb not null default '{}'::jsonb,
  constraint fugle_daytrade_quotes_symbol_code check (symbol ~ '^[0-9]{4}$'),
  constraint fugle_daytrade_quotes_payload_object check (jsonb_typeof(payload) = 'object')
);

create index if not exists idx_daytrade_quotes_live_updated
  on public.fugle_daytrade_quotes_live (updated_at desc);

create index if not exists idx_daytrade_quotes_live_seen
  on public.fugle_daytrade_quotes_live (quote_seen_at desc);

create table if not exists public.fugle_daytrade_intraday_1m (
  symbol text not null,
  market text,
  trade_date date not null,
  candle_time timestamptz not null,
  open numeric,
  high numeric,
  low numeric,
  close numeric,
  volume numeric,
  updated_at timestamptz not null default now(),
  source text not null default 'fugle_daytrade_writer',
  payload jsonb not null default '{}'::jsonb,
  primary key (symbol, candle_time),
  constraint fugle_daytrade_1m_symbol_code check (symbol ~ '^[0-9]{4}$'),
  constraint fugle_daytrade_1m_payload_object check (jsonb_typeof(payload) = 'object')
);

create index if not exists idx_daytrade_intraday_1m_trade_date
  on public.fugle_daytrade_intraday_1m (trade_date desc, candle_time desc);

create table if not exists public.fugle_daytrade_daily_volume_avg (
  symbol text primary key,
  market text,
  trade_date date,
  volume numeric,
  avg_volume5 numeric,
  updated_at timestamptz not null default now(),
  source text not null default 'fugle_daytrade_writer',
  payload jsonb not null default '{}'::jsonb,
  constraint fugle_daytrade_daily_symbol_code check (symbol ~ '^[0-9]{4}$'),
  constraint fugle_daytrade_daily_payload_object check (jsonb_typeof(payload) = 'object')
);

create index if not exists idx_daytrade_daily_volume_avg_updated
  on public.fugle_daytrade_daily_volume_avg (updated_at desc);

create table if not exists public.fugle_daytrade_futopt_quotes_live (
  future_symbol text primary key,
  underlying_symbol text,
  underlying_name text,
  updated_at timestamptz not null default now(),
  last_price numeric,
  open_price numeric,
  high_price numeric,
  low_price numeric,
  previous_close numeric,
  change_percent numeric,
  total_volume numeric,
  product text,
  session text,
  source text not null default 'fugle_daytrade_writer',
  payload jsonb not null default '{}'::jsonb,
  constraint fugle_daytrade_futopt_payload_object check (jsonb_typeof(payload) = 'object')
);

create index if not exists idx_daytrade_futopt_quotes_underlying
  on public.fugle_daytrade_futopt_quotes_live (underlying_symbol, updated_at desc);

create or replace view public.v_fugle_daytrade_intraday_1m_status as
with ranked as (
  select
    m.*,
    row_number() over (partition by m.symbol order by m.candle_time desc) as rn,
    ((now() at time zone 'Asia/Taipei')::date) as taipei_today
  from public.fugle_daytrade_intraday_1m m
),
windowed as (
  select *
  from ranked
  where rn <= 200
),
grouped as (
  select
    symbol,
    max(market) as market,
    max(candle_time) as latest_candle_time,
    max(updated_at) as updated_at,
    count(*) as candle_count,
    count(*) filter (where trade_date = taipei_today) as today_candle_count,
    count(*) filter (where trade_date < taipei_today) as warmup_candle_count,
    count(*) as continuous_candle_count,
    greatest(0, extract(epoch from (now() - max(candle_time)))::integer) as latest_candle_age_seconds,
    (max(candle_time) at time zone 'Asia/Taipei')::text as latest_candle_time_taipei
  from windowed
  group by symbol
)
select
  symbol,
  market,
  latest_candle_time,
  latest_candle_time_taipei,
  updated_at,
  candle_count,
  today_candle_count,
  warmup_candle_count,
  continuous_candle_count,
  latest_candle_age_seconds,
  (continuous_candle_count >= 20) as ready_ma20_continuous,
  (continuous_candle_count >= 35) as ready_ma35_continuous,
  (continuous_candle_count >= 80) as ready_macd_continuous
from grouped;

create or replace view public.v_fugle_daytrade_priority_readiness as
select
  p.trade_date,
  p.symbol,
  p.name,
  p.market,
  p.priority_rank,
  p.priority_source,
  p.priority_reason,
  p.consumer_scope,
  p.selected,
  p.score,
  p.updated_at as priority_updated_at,
  q.updated_at as quote_updated_at,
  q.quote_seen_at,
  q.price,
  q.change_percent,
  q.total_volume,
  q.trade_value,
  greatest(0, extract(epoch from (now() - coalesce(q.quote_seen_at, q.updated_at)))::integer) as quote_age_seconds,
  (coalesce(q.quote_seen_at, q.updated_at) >= now() - interval '120 seconds') as quote_fresh_120s,
  d.avg_volume5,
  d.updated_at as daily_volume_updated_at,
  s.latest_candle_time,
  s.latest_candle_time_taipei,
  s.today_candle_count,
  s.warmup_candle_count,
  s.continuous_candle_count,
  coalesce(s.ready_ma20_continuous, false) as ready_ma20_continuous,
  coalesce(s.ready_ma35_continuous, false) as ready_ma35_continuous,
  coalesce(s.ready_macd_continuous, false) as ready_macd_continuous
from public.fugle_daytrade_priority_symbols p
left join public.fugle_daytrade_quotes_live q
  on q.symbol = p.symbol
left join public.fugle_daytrade_daily_volume_avg d
  on d.symbol = p.symbol
left join public.v_fugle_daytrade_intraday_1m_status s
  on s.symbol = p.symbol
where p.selected = true;

create or replace view public.v_fugle_daytrade_source_latest_scorecard as
select distinct on (source_name)
  *
from public.fugle_daytrade_source_speed_scorecard
order by source_name, checked_at desc;

create or replace view public.v_fugle_daytrade_source_contract_health as
select
  s.source_name,
  s.trade_date,
  s.updated_at,
  s.status,
  s.stale_seconds,
  s.message,
  s.payload,
  s.payload ->> 'daytrade_gate_grade' as daytrade_gate_grade,
  coalesce((s.payload ->> 'daytrade_source_speed_ok')::boolean, false) as daytrade_source_speed_ok,
  s.payload ->> 'gate_mode' as gate_mode,
  coalesce((s.payload ->> 'fresh_quotes_120s')::integer, 0) as fresh_quotes_120s,
  coalesce((s.payload ->> 'fresh_quote_coverage_120s')::numeric, 0) as fresh_quote_coverage_120s,
  coalesce((s.payload ->> 'priority_pool_symbols')::integer, 0) as priority_pool_symbols,
  coalesce((s.payload ->> 'priority_fresh_quote_coverage_120s')::numeric, 0) as priority_fresh_quote_coverage_120s,
  coalesce((s.payload ->> 'quote_age_seconds')::integer, 999999) as quote_age_seconds,
  coalesce((s.payload ->> 'actual_quote_speed_per_sec')::numeric, 0) as actual_quote_speed_per_sec,
  coalesce((s.payload ->> 'scanner_can_run_opening')::boolean, false) as scanner_can_run_opening,
  s.payload ->> 'daily_volume_status' as daily_volume_status,
  coalesce((s.payload ->> 'ready_ma20_continuous')::integer, 0) as ready_ma20_continuous,
  coalesce((s.payload ->> 'ready_ma35_continuous')::integer, 0) as ready_ma35_continuous,
  coalesce((s.payload ->> 'intraday_1m_stale_seconds')::integer, 999999) as intraday_1m_stale_seconds,
  coalesce((s.payload ->> 'futopt_stock_mapped')::integer, 0) as futopt_stock_mapped,
  case
    when s.source_name is null then 'missing'
    when s.status <> 'ok' then s.status
    when coalesce((s.payload ->> 'daytrade_source_speed_ok')::boolean, false) <> true then 'speed_not_ok'
    when s.payload ->> 'daytrade_gate_grade' <> 'A' then 'gate_not_a'
    when coalesce((s.payload ->> 'priority_pool_symbols')::integer, 0) < 300 then 'priority_pool_too_small'
    when coalesce((s.payload ->> 'priority_fresh_quote_coverage_120s')::numeric, 0) < 0.95 then 'priority_coverage_low'
    when coalesce((s.payload ->> 'quote_age_seconds')::integer, 999999) > 90 then 'quote_stale'
    else 'ready'
  end as contract_status
from public.source_status s
where s.source_name = 'fugle_daytrade_source';

grant select on public.fugle_daytrade_priority_symbols to anon, authenticated;
grant select on public.fugle_daytrade_quotes_live to anon, authenticated;
grant select on public.fugle_daytrade_intraday_1m to anon, authenticated;
grant select on public.fugle_daytrade_daily_volume_avg to anon, authenticated;
grant select on public.fugle_daytrade_futopt_quotes_live to anon, authenticated;
grant select on public.v_fugle_daytrade_intraday_1m_status to anon, authenticated;
grant select on public.v_fugle_daytrade_priority_readiness to anon, authenticated;
grant select on public.v_fugle_daytrade_source_latest_scorecard to anon, authenticated;
grant select on public.v_fugle_daytrade_source_contract_health to anon, authenticated;

grant select, insert, update, delete on public.fugle_daytrade_priority_symbols to service_role;
grant select, insert, update, delete on public.fugle_daytrade_quotes_live to service_role;
grant select, insert, update, delete on public.fugle_daytrade_intraday_1m to service_role;
grant select, insert, update, delete on public.fugle_daytrade_daily_volume_avg to service_role;
grant select, insert, update, delete on public.fugle_daytrade_futopt_quotes_live to service_role;
grant select on public.v_fugle_daytrade_intraday_1m_status to service_role;
grant select on public.v_fugle_daytrade_priority_readiness to service_role;
grant select on public.v_fugle_daytrade_source_latest_scorecard to service_role;
grant select on public.v_fugle_daytrade_source_contract_health to service_role;

alter table public.fugle_daytrade_priority_symbols enable row level security;
alter table public.fugle_daytrade_quotes_live enable row level security;
alter table public.fugle_daytrade_intraday_1m enable row level security;
alter table public.fugle_daytrade_daily_volume_avg enable row level security;
alter table public.fugle_daytrade_futopt_quotes_live enable row level security;

drop policy if exists fugle_daytrade_priority_symbols_read_policy on public.fugle_daytrade_priority_symbols;
create policy fugle_daytrade_priority_symbols_read_policy
  on public.fugle_daytrade_priority_symbols
  for select
  to anon, authenticated
  using (true);

drop policy if exists fugle_daytrade_quotes_live_read_policy on public.fugle_daytrade_quotes_live;
create policy fugle_daytrade_quotes_live_read_policy
  on public.fugle_daytrade_quotes_live
  for select
  to anon, authenticated
  using (true);

drop policy if exists fugle_daytrade_intraday_1m_read_policy on public.fugle_daytrade_intraday_1m;
create policy fugle_daytrade_intraday_1m_read_policy
  on public.fugle_daytrade_intraday_1m
  for select
  to anon, authenticated
  using (true);

drop policy if exists fugle_daytrade_daily_volume_avg_read_policy on public.fugle_daytrade_daily_volume_avg;
create policy fugle_daytrade_daily_volume_avg_read_policy
  on public.fugle_daytrade_daily_volume_avg
  for select
  to anon, authenticated
  using (true);

drop policy if exists fugle_daytrade_futopt_quotes_live_read_policy on public.fugle_daytrade_futopt_quotes_live;
create policy fugle_daytrade_futopt_quotes_live_read_policy
  on public.fugle_daytrade_futopt_quotes_live
  for select
  to anon, authenticated
  using (true);

notify pgrst, 'reload schema';

commit;
