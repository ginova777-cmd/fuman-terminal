-- Derived indicator fields for the dedicated daytrade 1m cache.
-- These are computed from real candle history by the writer; no placeholders
-- are promoted to formal entry eligibility.

begin;

alter table public.fugle_daytrade_intraday_1m_status_cache
  add column if not exists ma5_rising boolean not null default false,
  add column if not exists ma10_rising boolean not null default false,
  add column if not exists ma30_rising boolean not null default false,
  add column if not exists ma35_rising boolean not null default false,
  add column if not exists relative_volume_5m numeric not null default 0,
  add column if not exists recent_1m_volume_trend text not null default 'unknown';

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
  c.updated_at
from public.fugle_daytrade_intraday_1m_status_cache c
where c.trade_date is null
   or c.trade_date >= ((now() at time zone 'Asia/Taipei')::date - 15);

grant select on public.v_fugle_daytrade_intraday_1m_indicator_status to anon, authenticated, service_role;
notify pgrst, 'reload schema';
commit;
