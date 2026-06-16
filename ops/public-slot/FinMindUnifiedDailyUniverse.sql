-- FinMind supplemental daily OHLCV + universe, 2026-06-16.
-- FinMind is the terminal-wide secondary source for:
--   - stock universe completeness
--   - daily OHLCV / 5d / 20d volume fallback
--
-- Unit contract:
--   volume_shares = shares
--   volume_lots = shares / 1000
--   trade_value_twd = TWD

create table if not exists public.finmind_stock_universe (
  symbol text primary key,
  name text,
  market text,
  industry text,
  is_active boolean not null default true,
  is_etf boolean not null default false,
  is_warrant boolean not null default false,
  is_cb boolean not null default false,
  source_date date,
  source text not null default 'finmind:TaiwanStockInfo',
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.finmind_daily_ohlcv (
  symbol text not null,
  trade_date date not null,
  open numeric,
  high numeric,
  low numeric,
  close numeric,
  spread numeric,
  volume_shares numeric,
  volume_lots numeric,
  trade_value_twd numeric,
  trading_turnover numeric,
  source text not null default 'finmind:TaiwanStockPrice',
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (symbol, trade_date)
);

create index if not exists idx_finmind_daily_ohlcv_symbol_date
  on public.finmind_daily_ohlcv (symbol, trade_date desc);

create index if not exists idx_finmind_daily_ohlcv_trade_date
  on public.finmind_daily_ohlcv (trade_date desc);

alter table public.finmind_stock_universe enable row level security;
alter table public.finmind_daily_ohlcv enable row level security;

drop policy if exists "read finmind stock universe" on public.finmind_stock_universe;
create policy "read finmind stock universe"
on public.finmind_stock_universe
for select
to anon
using (true);

drop policy if exists "read finmind daily ohlcv" on public.finmind_daily_ohlcv;
create policy "read finmind daily ohlcv"
on public.finmind_daily_ohlcv
for select
to anon
using (true);

grant select on public.finmind_stock_universe to anon;
grant select on public.finmind_daily_ohlcv to anon;
grant select, insert, update, delete on public.finmind_stock_universe to service_role;
grant select, insert, update, delete on public.finmind_daily_ohlcv to service_role;

create or replace view public.v_stock_universe_unified as
select
  coalesce(s.symbol, f.symbol) as symbol,
  coalesce(s.name, f.name) as name,
  coalesce(s.market, f.market) as market,
  coalesce(s.industry, f.industry) as industry,
  coalesce(s.is_active, f.is_active, true) as is_active,
  coalesce(s.is_etf, f.is_etf, false) as is_etf,
  coalesce(s.is_warrant, f.is_warrant, false) as is_warrant,
  coalesce(s.is_cb, f.is_cb, false) as is_cb,
  coalesce(s.is_blacklisted, false) as is_blacklisted,
  coalesce(s.is_daytrade_unsuitable, false) as is_daytrade_unsuitable,
  case
    when s.symbol is not null and f.symbol is not null then 'stock_universe+finmind'
    when s.symbol is not null then 'stock_universe'
    else 'finmind'
  end as universe_source,
  coalesce(s.updated_at, f.updated_at) as updated_at,
  jsonb_build_object(
    'stock_universe', to_jsonb(s),
    'finmind', to_jsonb(f)
  ) as payload
from public.stock_universe s
full outer join public.finmind_stock_universe f
  on f.symbol = s.symbol
where coalesce(s.symbol, f.symbol) ~ '^[0-9]{4}$';

create or replace view public.v_finmind_daily_volume_avg as
with ranked as (
  select
    symbol,
    trade_date,
    volume_lots,
    row_number() over (partition by symbol order by trade_date desc) as rn
  from public.finmind_daily_ohlcv
  where volume_lots is not null
    and volume_lots > 0
),
agg as (
  select
    symbol,
    avg(volume_lots) filter (where rn <= 5) as avg_5d_volume,
    avg(volume_lots) filter (where rn <= 20) as avg_20d_volume,
    count(*) filter (where rn <= 5) as days_5,
    count(*) filter (where rn <= 20) as days_20,
    max(trade_date) as latest_trade_date
  from ranked
  where rn <= 20
  group by symbol
)
select
  symbol,
  avg_5d_volume,
  avg_20d_volume,
  days_5,
  days_20,
  latest_trade_date,
  'finmind:TaiwanStockPrice'::text as source
from agg;

create or replace view public.v_daily_volume_avg_unified as
select
  coalesce(f.symbol, d.symbol) as symbol,
  coalesce(nullif(d.avg_5d_volume, 0), f.avg_5d_volume, 0) as avg_5d_volume,
  coalesce(nullif(d.avg_20d_volume, 0), f.avg_20d_volume, 0) as avg_20d_volume,
  coalesce(nullif(d.days_5, 0), f.days_5, 0) as days_5,
  coalesce(nullif(d.days_20, 0), f.days_20, 0) as days_20,
  case
    when d.symbol is not null and coalesce(d.avg_5d_volume, 0) > 0 then 'fugle_daily_volume_avg'
    when f.symbol is not null then 'finmind'
    else 'unknown'
  end as volume_source,
  coalesce(f.latest_trade_date, current_date) as latest_trade_date
from public.fugle_daily_volume_avg d
full outer join public.v_finmind_daily_volume_avg f
  on f.symbol = d.symbol
where coalesce(f.symbol, d.symbol) ~ '^[0-9]{4}$';

grant select on public.v_stock_universe_unified to anon;
grant select on public.v_stock_universe_unified to service_role;
grant select on public.v_finmind_daily_volume_avg to anon;
grant select on public.v_finmind_daily_volume_avg to service_role;
grant select on public.v_daily_volume_avg_unified to anon;
grant select on public.v_daily_volume_avg_unified to service_role;

create or replace view public.strategy4_stock_universe_view as
select
  symbol,
  name,
  market,
  industry,
  is_etf,
  is_warrant,
  is_cb,
  is_blacklisted,
  is_daytrade_unsuitable,
  is_active,
  (
    is_active = true
    and coalesce(is_etf, false) = false
    and coalesce(is_warrant, false) = false
    and coalesce(is_cb, false) = false
    and coalesce(is_blacklisted, false) = false
    and coalesce(is_daytrade_unsuitable, false) = false
    and coalesce(name, '') !~ '(ETF|ETN|權證|購|售|牛|熊|債|可轉債)'
    and coalesce(industry, '') !~ '(水泥|軍工|國防|航太)'
  ) as is_strategy4_eligible,
  updated_at,
  payload,
  universe_source as source
from public.v_stock_universe_unified;

create or replace view public.v_daily_ohlcv_unified as
with candidates as (
  select
    d.symbol,
    coalesce(nullif(d.name, ''), u.name) as name,
    coalesce(nullif(d.market, ''), u.market) as market,
    coalesce(nullif(d.industry, ''), u.industry) as industry,
    d.trade_date,
    d.open,
    d.high,
    d.low,
    d.close,
    d.volume * 1000 as volume_shares,
    d.volume as volume_lots,
    case
      when d.close is not null and d.volume is not null then d.close * d.volume * 1000
      else null
    end as trade_value_twd,
    'fugle_daily_ohlcv'::text as source,
    d.updated_at,
    d.payload,
    1 as source_priority
  from public.fugle_daily_ohlcv d
  left join public.v_stock_universe_unified u
    on u.symbol = d.symbol
  where d.symbol ~ '^[0-9]{4}$'

  union all

  select
    f.symbol,
    u.name,
    u.market,
    u.industry,
    f.trade_date,
    f.open,
    f.high,
    f.low,
    f.close,
    f.volume_shares,
    f.volume_lots,
    f.trade_value_twd,
    'finmind_daily_ohlcv'::text as source,
    f.updated_at,
    f.payload,
    2 as source_priority
  from public.finmind_daily_ohlcv f
  left join public.v_stock_universe_unified u
    on u.symbol = f.symbol
  where f.symbol ~ '^[0-9]{4}$'
),
ranked as (
  select
    *,
    row_number() over (
      partition by symbol, trade_date
      order by source_priority asc, updated_at desc
    ) as rn
  from candidates
)
select
  symbol,
  name,
  market,
  industry,
  trade_date,
  open,
  high,
  low,
  close,
  volume_shares,
  volume_lots,
  trade_value_twd,
  source,
  updated_at,
  payload
from ranked
where rn = 1;

create or replace view public.strategy4_daily_ohlcv_view as
with base as (
  select
    d.*,
    coalesce(u.is_strategy4_eligible, false) as is_strategy4_eligible
  from public.v_daily_ohlcv_unified d
  left join public.strategy4_stock_universe_view u
    on u.symbol = d.symbol
)
select
  symbol,
  name,
  market,
  industry,
  trade_date,
  open,
  high,
  low,
  close,
  volume_shares,
  volume_lots,
  trade_value_twd,
  avg(volume_lots) over (
    partition by symbol
    order by trade_date
    rows between 4 preceding and current row
  ) as avg_volume_5_lots,
  avg(volume_lots) over (
    partition by symbol
    order by trade_date
    rows between 19 preceding and current row
  ) as avg_volume_20_lots,
  is_strategy4_eligible,
  source,
  updated_at,
  payload
from base;

grant select on public.strategy4_stock_universe_view to anon;
grant select on public.strategy4_stock_universe_view to service_role;
grant select on public.v_daily_ohlcv_unified to anon;
grant select on public.v_daily_ohlcv_unified to service_role;
grant select on public.strategy4_daily_ohlcv_view to anon;
grant select on public.strategy4_daily_ohlcv_view to service_role;

notify pgrst, 'reload schema';
