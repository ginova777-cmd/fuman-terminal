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
)
select
  b.trade_date,
  b.symbol,
  coalesce(q.name, b.symbol) as name,
  b.candle_time,
  b.open,
  b.high,
  b.low,
  b.close,
  b.volume,
  b.bar_count,
  case when b.bar_count >= 4 then 'ready' else 'DATA_GAP_5M' end as source_status,
  b.updated_at,
  greatest(0, extract(epoch from (now() - b.updated_at)))::integer as stale_seconds,
  (now() >= b.candle_time + interval '5 minutes') as bar_complete,
  (b.bar_count < 4) as data_gap_5m,
  b.source
from bars b
left join lateral (
  select l.name
  from public.fugle_daytrade_quotes_live l
  where l.symbol = b.symbol
  order by l.updated_at desc
  limit 1
) q on true;

comment on view public.v_fugle_intraday_5m_readback is
  'Formal read-only 5m aggregation from same-day Fugle 1m candles. bar_count<4 is DATA_GAP_5M; 5m evidence cannot independently authorize a buy signal.';

grant select on public.v_fugle_intraday_5m_readback to anon, authenticated, service_role;

commit;
