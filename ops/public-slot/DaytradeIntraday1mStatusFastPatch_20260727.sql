-- Fast dedicated daytrade 1m status contract.
-- Fix: avoid full-table window aggregation before symbol filtering.
-- Keeps the existing view column order and fail-closed readiness semantics.

begin;

create index if not exists idx_fugle_daytrade_intraday_1m_symbol_candle_time
  on public.fugle_daytrade_intraday_1m(symbol, candle_time desc);

create or replace view public.v_fugle_daytrade_intraday_1m_status as
with symbols as (
  select m.symbol, max(m.market) as market
  from public.fugle_daytrade_intraday_1m m
  where m.trade_date >= ((now() at time zone 'Asia/Taipei')::date - 15)
  group by m.symbol
),
ranked as (
  select
    s.symbol,
    coalesce(recent.market, s.market) as market,
    recent.candle_time,
    recent.trade_date,
    recent.updated_at,
    recent.close,
    row_number() over (partition by s.symbol order by recent.candle_time desc) as rn
  from symbols s
  cross join lateral (
    select m.market, m.candle_time, m.trade_date, m.updated_at, m.close
    from public.fugle_daytrade_intraday_1m m
    where m.symbol = s.symbol
      and m.trade_date >= ((now() at time zone 'Asia/Taipei')::date - 15)
    order by m.candle_time desc
    limit 200
  ) recent
),
agg as (
  select
    symbol,
    max(market) as market,
    max(candle_time) as latest_candle_time,
    count(*) filter (where trade_date = (now() at time zone 'Asia/Taipei')::date)::integer as today_candle_count,
    count(*)::integer as warmup_candle_count,
    count(*)::integer as continuous_candle_count,
    bool_or(rn >= 20) as ready_ma20_continuous,
    bool_or(rn >= 35) as ready_ma35_continuous,
    extract(epoch from (now() - max(candle_time)))::integer as latest_candle_age_seconds,
    bool_or(rn >= 5) as ready_ma5,
    bool_or(rn >= 10) as ready_ma10,
    bool_or(rn >= 30) as ready_ma30,
    avg(close) filter (where rn <= 5) as ma5,
    avg(close) filter (where rn <= 10) as ma10,
    avg(close) filter (where rn <= 35) as ma35
  from ranked
  group by symbol
)
select
  agg.*,
  (agg.ma5 > agg.ma10 and agg.ma10 > agg.ma35 and agg.ma35 > 0)::boolean as ma5_ma10_ma35_bullish,
  (agg.ma5 > agg.ma10 and agg.ma10 > agg.ma35 and agg.ma35 > 0)::boolean as ma_bullish_alignment,
  ma30_values.ma30
from agg
left join (
  select symbol, avg(close) filter (where rn <= 30) as ma30
  from ranked
  group by symbol
) ma30_values on ma30_values.symbol = agg.symbol;

grant select on public.v_fugle_daytrade_intraday_1m_status to anon, authenticated, service_role;
notify pgrst, 'reload schema';
commit;