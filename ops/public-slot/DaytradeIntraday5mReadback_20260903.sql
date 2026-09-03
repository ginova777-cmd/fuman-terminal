begin;

create or replace view public.v_fugle_intraday_5m_readback as
with source_rows as (
  select
    i.trade_date,
    i.symbol,
    i.candle_time,
    i.open,
    i.high,
    i.low,
    i.close,
    i.volume,
    i.updated_at,
    i.source,
    date_trunc('hour', i.candle_time at time zone 'Asia/Taipei')
      + floor(extract(minute from i.candle_time at time zone 'Asia/Taipei') / 5) * interval '5 minutes' as bucket_local
  from public.fugle_daytrade_intraday_1m i
  where i.synthetic is not true
    and i.trade_date = (now() at time zone 'Asia/Taipei')::date
    and (i.candle_time at time zone 'Asia/Taipei')::time between time '09:00' and time '13:30'
), ranked as (
  select s.*,
    row_number() over (partition by trade_date, symbol, bucket_local order by candle_time) as rn_open,
    row_number() over (partition by trade_date, symbol, bucket_local order by candle_time desc) as rn_close
  from source_rows s
), bars as (
  select
    trade_date,
    symbol,
    bucket_local at time zone 'Asia/Taipei' as candle_time,
    max(open) filter (where rn_open = 1) as open,
    max(high) as high,
    min(low) as low,
    max(close) filter (where rn_close = 1) as close,
    sum(coalesce(volume, 0)) as volume,
    count(*)::integer as bar_count,
    max(updated_at) as updated_at,
    string_agg(distinct source, ',' order by source) as source
  from ranked
  group by trade_date, symbol, bucket_local
), technical_base as (
  select b.*,
    lag(case when b.bar_count >= 4 then b.low end) over w as prev_low,
    lag(case when b.bar_count >= 4 then b.close end) over w as prev_close,
    case when count(*) filter(where b.bar_count>=4) over w5=5 then avg(b.close) filter(where b.bar_count>=4) over w5 end as ma5_5m,
    case when count(*) filter(where b.bar_count>=4) over w10=10 then avg(b.close) filter(where b.bar_count>=4) over w10 end as ma10_5m,
    case when count(*) filter(where b.bar_count>=4) over w20=20 then avg(b.close) filter(where b.bar_count>=4) over w20 end as ma20_5m,
    case when count(*) filter(where b.bar_count>=4) over w30=30 then avg(b.close) filter(where b.bar_count>=4) over w30 end as ma30_5m
  from bars b
  window
    w as (partition by b.trade_date,b.symbol order by b.candle_time),
    w5 as (partition by b.trade_date,b.symbol order by b.candle_time rows between 4 preceding and current row),
    w10 as (partition by b.trade_date,b.symbol order by b.candle_time rows between 9 preceding and current row),
    w20 as (partition by b.trade_date,b.symbol order by b.candle_time rows between 19 preceding and current row),
    w30 as (partition by b.trade_date,b.symbol order by b.candle_time rows between 29 preceding and current row)
), technical_lag as (
  select t.*,
    lag(ma5_5m) over w as prev_ma5_5m,
    lag(ma10_5m) over w as prev_ma10_5m,
    lag(ma20_5m) over w as prev_ma20_5m,
    lag(ma30_5m) over w as prev_ma30_5m
  from technical_base t
  window w as (partition by t.trade_date,t.symbol order by t.candle_time)
), technical as (
  select t.*,
    (ma5_5m > prev_ma5_5m) as ma5_5m_rising,
    (ma10_5m > prev_ma10_5m) as ma10_5m_rising,
    (ma20_5m > prev_ma20_5m) as ma20_5m_rising,
    (ma30_5m > prev_ma30_5m) as ma30_5m_rising,
    (prev_ma5_5m <= prev_ma20_5m and ma5_5m > ma20_5m and ma5_5m > prev_ma5_5m and ma20_5m > prev_ma20_5m) as ma5_cross_ma20_up_5m,
    (ma5_5m > ma20_5m) as ma5_above_ma20_5m
  from technical_lag t
), quote_names as (
  select distinct on (symbol) symbol,name
  from public.fugle_daytrade_quotes_live
  order by symbol,updated_at desc
)
select
  b.trade_date,b.symbol,coalesce(q.name,b.symbol) as name,b.candle_time,
  b.open,b.high,b.low,b.close,b.volume,b.bar_count,
  case when b.bar_count >= 4 then 'ok' else 'DATA_GAP_5M' end as source_status,
  b.updated_at,greatest(0,extract(epoch from (now()-b.updated_at)))::integer as stale_seconds,
  (now() >= b.candle_time + interval '5 minutes') as bar_complete,
  (b.bar_count < 4) as data_gap_5m,b.source,
  b.ma5_5m,b.ma10_5m,b.ma20_5m,b.ma30_5m,
  b.ma5_5m_rising,b.ma10_5m_rising,b.ma20_5m_rising,b.ma30_5m_rising,
  coalesce(b.ma5_cross_ma20_up_5m,false) as ma5_cross_ma20_up_5m,
  b.ma5_above_ma20_5m,
  case
    when b.bar_count < 4 then 'DATA_GAP_5M'
    when (b.close < b.open and b.low < b.prev_low and b.close < b.prev_close)
      or b.ma5_5m_rising is false or b.ma10_5m_rising is false or b.ma20_5m_rising is false then 'weakening'
    when b.ma5_cross_ma20_up_5m is true
      or (b.ma5_above_ma20_5m is true and b.ma5_5m_rising is true and b.ma20_5m_rising is true) then 'bullish'
    else 'neutral'
  end as trend_5m_status,
  case
    when b.bar_count < 4 then 'DATA_GAP_5M'
    when b.ma5_cross_ma20_up_5m is true then '5分K MA5上穿MA20且向上'
    when (b.close < b.open and b.low < b.prev_low and b.close < b.prev_close)
      or b.ma5_5m_rising is false or b.ma10_5m_rising is false or b.ma20_5m_rising is false then '5分K轉弱'
    when b.ma5_above_ma20_5m is true and b.ma5_5m_rising is true and b.ma20_5m_rising is true then '5分K MA5位於MA20之上且雙線向上'
    else '5分K趨勢中性'
  end as trend_5m_reason
from technical b
left join quote_names q on q.symbol=b.symbol;

comment on view public.v_fugle_intraday_5m_readback is
  'Formal read-only 5m aggregation from same-day Fugle 1m candles. bar_count<4 is DATA_GAP_5M; 5m evidence cannot independently authorize a buy signal.';

grant select on public.v_fugle_intraday_5m_readback to anon, authenticated, service_role;

commit;
