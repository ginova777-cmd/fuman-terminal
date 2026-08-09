-- Fast read-through cache for the dedicated daytrade 1m status contract.
-- The writer owns this cache; the public view stays read-only and keeps the
-- existing column order so downstream strategies do not need a migration.

begin;

create table if not exists public.fugle_daytrade_intraday_1m_status_cache (
  symbol text primary key,
  market text,
  latest_candle_time timestamptz,
  today_candle_count integer not null default 0,
  warmup_candle_count integer not null default 0,
  continuous_candle_count integer not null default 0,
  ready_ma20_continuous boolean not null default false,
  ready_ma35_continuous boolean not null default false,
  latest_candle_age_seconds integer not null default 999999,
  ready_ma5 boolean not null default false,
  ready_ma10 boolean not null default false,
  ready_ma30 boolean not null default false,
  ma5 numeric,
  ma10 numeric,
  ma35 numeric,
  ma5_ma10_ma35_bullish boolean not null default false,
  ma_bullish_alignment boolean not null default false,
  ma30 numeric,
  trade_date date,
  source text not null default 'fugle_daytrade_intraday_1m_status_cache',
  updated_at timestamptz not null default now()
);

create index if not exists idx_fugle_daytrade_intraday_1m_status_cache_trade_date
  on public.fugle_daytrade_intraday_1m_status_cache(trade_date, updated_at desc);

create index if not exists idx_fugle_daytrade_intraday_1m_status_cache_updated_at
  on public.fugle_daytrade_intraday_1m_status_cache(updated_at desc);

create or replace view public.v_fugle_daytrade_intraday_1m_status as
select
  c.symbol,
  c.market,
  c.latest_candle_time,
  c.today_candle_count,
  c.warmup_candle_count,
  c.continuous_candle_count,
  c.ready_ma20_continuous,
  c.ready_ma35_continuous,
  c.latest_candle_age_seconds,
  c.ready_ma5,
  c.ready_ma10,
  c.ready_ma30,
  c.ma5,
  c.ma10,
  c.ma35,
  c.ma5_ma10_ma35_bullish,
  c.ma_bullish_alignment,
  c.ma30
from public.fugle_daytrade_intraday_1m_status_cache c
where c.trade_date is null
   or c.trade_date >= ((now() at time zone 'Asia/Taipei')::date - 15);

grant select on public.v_fugle_daytrade_intraday_1m_status to anon, authenticated, service_role;
grant select, insert, update on public.fugle_daytrade_intraday_1m_status_cache to service_role;

notify pgrst, 'reload schema';
commit;
