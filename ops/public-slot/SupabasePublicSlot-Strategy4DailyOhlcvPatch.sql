-- Supabase public slot Strategy4 daily OHLCV patch, 2026-06-11.
-- Purpose:
-- 1. Provide daily OHLCV history for Strategy4 swing radar.
-- 2. Provide a stable stock_universe view for strategy scanners.
-- 3. Provide a sync status table so Strategy4 can wait for complete data.

create table if not exists public.fugle_daily_ohlcv (
  symbol text not null,
  market text,
  trade_date date not null,
  open numeric,
  high numeric,
  low numeric,
  close numeric,
  volume numeric,
  source text default 'fugle',
  name text,
  industry text,
  updated_at timestamptz not null default now(),
  payload jsonb default '{}'::jsonb,
  primary key (symbol, trade_date)
);

comment on table public.fugle_daily_ohlcv is
  'Daily OHLCV public slot for Strategy4. volume unit is lots.';

comment on column public.fugle_daily_ohlcv.volume is
  'Unit: lots. Used by Strategy4 avgVolume5 and swing filters.';

alter table public.fugle_daily_ohlcv enable row level security;

drop policy if exists "read fugle daily ohlcv" on public.fugle_daily_ohlcv;
create policy "read fugle daily ohlcv"
on public.fugle_daily_ohlcv
for select
to anon
using (true);

grant select on public.fugle_daily_ohlcv to anon;
grant select, insert, update, delete on public.fugle_daily_ohlcv to service_role;

create index if not exists idx_fugle_daily_ohlcv_symbol_date
  on public.fugle_daily_ohlcv (symbol, trade_date desc);

create index if not exists idx_fugle_daily_ohlcv_trade_date
  on public.fugle_daily_ohlcv (trade_date);

create table if not exists public.fugle_daily_sync_status (
  trade_date date not null,
  source text not null default 'fugle_shared_source',
  started_at timestamptz,
  finished_at timestamptz,
  symbols_expected integer,
  symbols_loaded integer,
  missing_symbols_count integer,
  status text not null default 'running',
  error_message text,
  updated_at timestamptz not null default now(),
  payload jsonb default '{}'::jsonb,
  primary key (trade_date, source)
);

alter table public.fugle_daily_sync_status enable row level security;

drop policy if exists "read fugle daily sync status" on public.fugle_daily_sync_status;
create policy "read fugle daily sync status"
on public.fugle_daily_sync_status
for select
to anon
using (true);

grant select on public.fugle_daily_sync_status to anon;
grant select, insert, update, delete on public.fugle_daily_sync_status to service_role;

create index if not exists idx_fugle_daily_sync_status_trade_date
  on public.fugle_daily_sync_status (trade_date);

create index if not exists idx_fugle_daily_sync_status_status
  on public.fugle_daily_sync_status (status);

drop view if exists public.stock_universe;

create or replace view public.stock_universe as
select
  symbol,
  name,
  case
    when market = 'TSE' then 'TWSE'
    when market = 'OTC' then 'TPEX'
    else market
  end as market,
  industry,
  coalesce(is_etf, false) as is_etf,
  false as is_warrant,
  false as is_cb,
  (
    symbol like '00%'
    or coalesce(is_etf, false) = true
    or coalesce(is_suspended, false) = true
    or coalesce(stock_type, 'COMMONSTOCK') <> 'COMMONSTOCK'
    or coalesce(name, '') ~ '(ETF|ETN|權證|購|售|牛|熊|債|可轉債)'
    or coalesce(industry, '') ~ '(水泥|軍工|國防|航太)'
  ) as is_blacklisted,
  (
    symbol like '00%'
    or coalesce(is_etf, false) = true
    or coalesce(is_suspended, false) = true
    or coalesce(stock_type, 'COMMONSTOCK') <> 'COMMONSTOCK'
    or coalesce(name, '') ~ '(ETF|ETN|權證|購|售|牛|熊|債|可轉債)'
    or coalesce(industry, '') ~ '(水泥|軍工|國防|航太)'
  ) as is_daytrade_unsuitable,
  (
    symbol ~ '^[0-9]{4}$'
    and symbol not like '00%'
    and coalesce(is_etf, false) = false
    and coalesce(is_suspended, false) = false
    and coalesce(stock_type, 'COMMONSTOCK') = 'COMMONSTOCK'
    and coalesce(name, '') !~ '(ETF|ETN|權證|購|售|牛|熊|債|可轉債)'
    and coalesce(industry, '') !~ '(水泥|軍工|國防|航太)'
  ) as is_active,
  updated_at,
  payload
from public.stock_tickers
where symbol ~ '^[0-9]{4}$';

grant select on public.stock_universe to anon;
grant select on public.stock_universe to service_role;

-- Strategy4 unit contract patch, 2026-06-16.
-- Keep raw public.fugle_daily_ohlcv.volume for backward compatibility, but expose
-- unit-named columns to strategy scanners so volume is never inferred.

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
  payload
from public.stock_universe;

grant select on public.strategy4_stock_universe_view to anon;
grant select on public.strategy4_stock_universe_view to service_role;

create or replace view public.strategy4_daily_ohlcv_view as
with normalized as (
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
    d.volume as volume_lots,
    d.volume * 1000 as volume_shares,
    case
      when d.close is not null and d.volume is not null then d.close * d.volume * 1000
      else null
    end as trade_value_twd,
    d.source,
    d.updated_at,
    d.payload,
    coalesce(u.is_strategy4_eligible, false) as is_strategy4_eligible
  from public.fugle_daily_ohlcv d
  left join public.strategy4_stock_universe_view u
    on u.symbol = d.symbol
  where d.symbol ~ '^[0-9]{4}$'
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
from normalized;

comment on view public.strategy4_daily_ohlcv_view is
  'Strategy4-clean daily OHLCV view. Unit contract: volume_shares is shares, volume_lots and avg_volume_*_lots are lots, trade_value_twd is TWD.';

grant select on public.strategy4_daily_ohlcv_view to anon;
grant select on public.strategy4_daily_ohlcv_view to service_role;

create or replace view public.fugle_realtime_quote_latest as
select
  symbol,
  name,
  market,
  price,
  open_price,
  high_price,
  low_price,
  previous_close,
  change_percent,
  total_volume as volume_lots,
  total_volume * 1000 as volume_shares,
  trade_value as trade_value_twd,
  cumulative_bid_volume as cumulative_bid_volume_lots,
  cumulative_ask_volume as cumulative_ask_volume_lots,
  cumulative_bid_ask_volume as cumulative_bid_ask_volume_lots,
  last_trade_time,
  session,
  is_halted,
  is_trial,
  stock_type,
  updated_at as quote_updated_at,
  payload
from public.fugle_quotes_live
where symbol ~ '^[0-9]{4}$';

comment on view public.fugle_realtime_quote_latest is
  'Latest realtime quote view for strategies. Quote cumulative bid/ask fields are lots and are separated from daily OHLCV volume.';

grant select on public.fugle_realtime_quote_latest to anon;
grant select on public.fugle_realtime_quote_latest to service_role;
