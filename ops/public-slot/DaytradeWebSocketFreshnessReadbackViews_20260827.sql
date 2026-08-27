-- Additive WebSocket / 1m health readback for public Live readers.
-- Run in Supabase SQL Editor before enabling the paired writer release.
-- This intentionally creates a new view: legacy positional view contracts remain unchanged.

begin;

create index if not exists fugle_daytrade_intraday_1m_trade_date_candle_time_idx
  on public.fugle_daytrade_intraday_1m (trade_date, candle_time desc);

create or replace view public.v_fugle_daytrade_source_health_readback as
with clock as (
  select
    (now() at time zone 'Asia/Taipei')::date as trade_date,
    (now() at time zone 'Asia/Taipei')::time as taipei_time
),
symbols as (
  select symbol from public.fugle_daytrade_priority_pool
  union
  select q.symbol
  from public.fugle_daytrade_quotes_live q, clock c
  where (q.quote_seen_at at time zone 'Asia/Taipei')::date = c.trade_date
  union
  select m.symbol
  from public.fugle_daytrade_intraday_1m m, clock c
  where m.trade_date = c.trade_date
),
candles as (
  select
    m.symbol,
    max(m.source) as source_name,
    min(m.candle_time) as first_candle_time,
    max(m.candle_time) as last_candle_time,
    count(*)::integer as candle_count
  from public.fugle_daytrade_intraday_1m m
  join clock c on c.trade_date = m.trade_date
  where coalesce(m.synthetic, false) is false
  group by m.symbol
),
rows as (
  select
    c.trade_date,
    s.symbol,
    coalesce(q.source, ca.source_name, 'fugle_daytrade_source') as source_name,
    q.quote_seen_at,
    coalesce(
      case when coalesce(q.payload ->> 'received_at', '') ~ '^\d{4}-\d{2}-\d{2}T' then (q.payload ->> 'received_at')::timestamptz end,
      q.updated_at
    ) as received_at,
    case when coalesce(q.payload ->> 'aggregate_last_updated', '') ~ '^\d{4}-\d{2}-\d{2}T' then (q.payload ->> 'aggregate_last_updated')::timestamptz end as aggregate_last_updated,
    ca.last_candle_time as latest_candle_time,
    ca.first_candle_time,
    ca.last_candle_time,
    coalesce(ca.candle_count, 0) as candle_count,
    coalesce(extract(epoch from (now() - q.quote_seen_at))::integer, 999999) as quote_age_seconds,
    coalesce(extract(epoch from (now() - ca.last_candle_time))::integer, 999999) as intraday_1m_stale_seconds,
    c.taipei_time
  from symbols s
  cross join clock c
  left join public.fugle_daytrade_quotes_live q on q.symbol = s.symbol
  left join candles ca on ca.symbol = s.symbol
)
select
  trade_date,
  symbol,
  source_name,
  quote_seen_at,
  received_at,
  aggregate_last_updated,
  latest_candle_time,
  first_candle_time,
  last_candle_time,
  candle_count,
  case
    when taipei_time < time '09:02' or taipei_time > time '13:30' then false
    when candle_count = 0 then true
    when first_candle_time > ((trade_date::text || ' 09:01:00 Asia/Taipei')::timestamptz) then true
    when intraday_1m_stale_seconds > 120 then true
    else false
  end as data_gap,
  case
    when taipei_time < time '09:02' then 'preopen_candle_pending'
    when taipei_time > time '13:30' then 'market_closed'
    when candle_count = 0 then 'no_formal_1m_rows_today'
    when first_candle_time > ((trade_date::text || ' 09:01:00 Asia/Taipei')::timestamptz) then 'missing_0901_candle'
    when intraday_1m_stale_seconds > 120 then 'intraday_1m_stale_over_120s'
    else null
  end as data_gap_reason,
  quote_age_seconds,
  intraday_1m_stale_seconds
from rows;

grant select on public.v_fugle_daytrade_source_health_readback to anon, authenticated, service_role;

commit;
