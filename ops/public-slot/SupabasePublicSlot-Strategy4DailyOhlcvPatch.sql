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
