-- Extend the dedicated daytrade 1m cache with the pre-open indicator set.
-- The writer computes these fields from historical 1m candles; today's 1m
-- completeness remains a separate intraday/formal gate.

begin;

alter table public.fugle_daytrade_intraday_1m_status_cache
  add column if not exists ready_ma3 boolean not null default false,
  add column if not exists ready_ma58 boolean not null default false,
  add column if not exists ma3 numeric,
  add column if not exists ma58 numeric,
  add column if not exists ma20 numeric,
  add column if not exists ma3_rising boolean not null default false,
  add column if not exists ma58_rising boolean not null default false;

-- Remove stale published pool rows below the hard mother-pool price floor.
delete from public.fugle_daytrade_priority_pool p
using public.fugle_daytrade_quotes_live q
where q.symbol = p.symbol
  and q.price is not null
  and q.price < 50;

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
  c.ma30,
  c.ready_ma3,
  c.ready_ma58,
  c.ma3,
  c.ma58,
  c.ma3_rising,
  c.ma58_rising,
  c.ma20
from public.fugle_daytrade_intraday_1m_status_cache c
where c.trade_date is null
   or c.trade_date >= ((now() at time zone 'Asia/Taipei')::date - 15);

create or replace view public.v_fugle_daytrade_intraday_1m_indicator_status as
select
  c.symbol,
  c.ma5,
  c.ma10,
  c.ma30,
  c.ma35,
  c.ma5_ma10_ma35_bullish,
  c.ma_bullish_alignment,
  c.ma5_rising,
  c.ma10_rising,
  c.ma30_rising,
  c.ma35_rising,
  c.relative_volume_5m,
  c.recent_1m_volume_trend,
  c.latest_candle_time,
  c.latest_candle_age_seconds,
  c.trade_date,
  c.source,
  c.updated_at,
  c.ready_ma3,
  c.ready_ma58,
  c.ma3,
  c.ma58,
  c.ma3_rising,
  c.ma58_rising,
  c.ma20
from public.fugle_daytrade_intraday_1m_status_cache c
where c.trade_date is null
   or c.trade_date >= ((now() at time zone 'Asia/Taipei')::date - 15);

create or replace view public.v_fugle_daytrade_intraday_1m_technical_status as
select
  c.symbol,
  c.ma5,
  c.ma10,
  c.ma30,
  c.ma35,
  c.ma5_ma10_ma35_bullish,
  c.ma_bullish_alignment,
  c.ma5_rising,
  c.ma10_rising,
  c.ma30_rising,
  c.ma35_rising,
  c.relative_volume_5m,
  c.recent_1m_volume_trend,
  c.macd_line,
  c.macd_signal,
  c.macd_histogram,
  c.kd_k,
  c.kd_d,
  c.rsi14,
  c.latest_candle_time,
  c.latest_candle_age_seconds,
  c.trade_date,
  c.source,
  c.updated_at,
  c.ready_ma3,
  c.ready_ma58,
  c.ma3,
  c.ma58,
  c.ma3_rising,
  c.ma58_rising,
  c.ma20
from public.fugle_daytrade_intraday_1m_status_cache c
where c.trade_date is null
   or c.trade_date >= ((now() at time zone 'Asia/Taipei')::date - 15);

grant select on public.v_fugle_daytrade_intraday_1m_status to anon, authenticated, service_role;
grant select on public.v_fugle_daytrade_intraday_1m_indicator_status to anon, authenticated, service_role;
grant select on public.v_fugle_daytrade_intraday_1m_technical_status to anon, authenticated, service_role;
grant select, insert, update on public.fugle_daytrade_intraday_1m_status_cache to service_role;

notify pgrst, 'reload schema';
commit;
