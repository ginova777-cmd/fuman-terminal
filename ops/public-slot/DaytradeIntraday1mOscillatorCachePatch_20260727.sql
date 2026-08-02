-- Oscillator fields calculated from dedicated 1m candles.

begin;

alter table public.fugle_daytrade_intraday_1m_status_cache
  add column if not exists macd_line numeric,
  add column if not exists macd_signal numeric,
  add column if not exists macd_histogram numeric,
  add column if not exists kd_k numeric,
  add column if not exists kd_d numeric,
  add column if not exists rsi14 numeric;

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
  c.updated_at
from public.fugle_daytrade_intraday_1m_status_cache c
where c.trade_date is null
   or c.trade_date >= ((now() at time zone 'Asia/Taipei')::date - 15);

grant select on public.v_fugle_daytrade_intraday_1m_technical_status to anon, authenticated, service_role;
notify pgrst, 'reload schema';
commit;
