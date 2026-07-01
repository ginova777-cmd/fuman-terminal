-- Fugle source historical 1m MA readiness patch, 2026-07-01.
-- Keep MA20/MA35 readiness separate from same-day freshness:
-- historical warmup candles can satisfy MA readiness, while stale_seconds
-- remains the separate live-session freshness gate.

create or replace view public.v_fugle_intraday_1m_status as
with recent as (
  select *
  from (
    select
      m.symbol,
      m.market,
      m.candle_time,
      m.trade_date,
      m.updated_at,
      row_number() over (
        partition by m.symbol
        order by m.candle_time desc nulls last
      ) as rn,
      ((now() at time zone 'Asia/Taipei')::date) as taipei_today
    from public.fugle_intraday_1m m
    where m.symbol ~ '^\d{4}$'
      and m.trade_date >= (((now() at time zone 'Asia/Taipei')::date) - 8)
  ) ranked
  where rn <= 200
),
per_symbol as (
  select
    symbol,
    (array_agg(market order by candle_time desc nulls last))[1] as market,
    max(candle_time) as latest_candle_time,
    bool_or(trade_date = taipei_today) as has_today_data,
    min(candle_time) as first_candle_time,
    count(*) filter (where trade_date = taipei_today)::integer as today_candle_count,
    greatest(0, extract(epoch from (now() - max(candle_time)))::integer) as latest_candle_age_seconds,
    count(*) filter (
      where trade_date = taipei_today
        and (candle_time at time zone 'Asia/Taipei')::time >= time '13:00'
    )::integer as after_1300_candle_count,
    count(*) filter (where trade_date < taipei_today)::integer as warmup_candle_count,
    count(*)::integer as continuous_candle_count,
    count(*)::integer as candle_count,
    max(updated_at) as updated_at
  from recent
  group by symbol
)
select
  symbol,
  market,
  latest_candle_time,
  candle_count,
  has_today_data,
  updated_at,
  first_candle_time,
  today_candle_count,
  latest_candle_age_seconds,
  continuous_candle_count >= 35 as ready_ge_35,
  continuous_candle_count >= 80 as ready_ge_80,
  continuous_candle_count >= 200 as ready_ge_200,
  continuous_candle_count >= 35 as ma35_available,
  today_candle_count as rows_today,
  after_1300_candle_count,
  after_1300_candle_count as candles_after_1300,
  after_1300_candle_count > 0 as has_after_1300_candle,
  (latest_candle_time at time zone 'Asia/Taipei')::text as latest_candle_time_taipei,
  continuous_candle_count >= 20 as ready_ge_20,
  warmup_candle_count,
  continuous_candle_count,
  continuous_candle_count >= 20 as ready_ma20_continuous,
  continuous_candle_count >= 35 as ready_ma35_continuous,
  continuous_candle_count >= 80 as ready_macd_continuous
from per_symbol;

grant select on public.v_fugle_intraday_1m_status to anon, authenticated, service_role;

create index if not exists idx_fugle_intraday_1m_symbol_candle_time_desc
  on public.fugle_intraday_1m (symbol, candle_time desc);

create index if not exists idx_fugle_intraday_1m_symbol_trade_date_candle_desc
  on public.fugle_intraday_1m (symbol, trade_date, candle_time desc);

create or replace function public.get_fugle_intraday_1m_coverage_stats(
  p_symbols text[] default null
)
returns table (
  intraday_1m_symbols_today integer,
  intraday_1m_rows_today integer,
  today_candle_count integer,
  warmup_candle_count integer,
  continuous_candle_count integer,
  ready_ge_20 integer,
  ready_ge_35 integer,
  ready_ge_80 integer,
  ready_ge_200 integer,
  ready_ma20_continuous integer,
  ready_ma35_continuous integer,
  ready_macd_continuous integer,
  latest_candle_time timestamptz,
  intraday_1m_latest_candle_time timestamptz,
  latest_candle_time_taipei text,
  intraday_1m_stale_seconds integer
)
language sql
stable
as $$
  with requested_symbols as (
    select distinct symbol
    from unnest(coalesce(p_symbols, array[]::text[])) as symbol
    where symbol ~ '^\d{4}$'
  ),
  active_symbols as (
    select distinct q.symbol
    from public.fugle_quotes_live q
    where coalesce(array_length(p_symbols, 1), 0) = 0
      and q.symbol ~ '^\d{4}$'
      and coalesce(q.stock_type, 'COMMONSTOCK') = 'COMMONSTOCK'
  ),
  symbols as (
    select symbol from requested_symbols
    union
    select symbol from active_symbols
  ),
  recent_rows as (
    select
      m.symbol,
      m.trade_date,
      m.candle_time
    from public.fugle_intraday_1m m
    join symbols s
      on s.symbol = m.symbol
    where m.trade_date >= (((now() at time zone 'Asia/Taipei')::date) - 8)
  ),
  per_symbol as (
    select
      s.symbol,
      coalesce(count(r.*) filter (
        where r.trade_date = ((now() at time zone 'Asia/Taipei')::date)
      ), 0)::integer as today_candle_count,
      coalesce(count(r.*) filter (
        where r.trade_date < ((now() at time zone 'Asia/Taipei')::date)
      ), 0)::integer as warmup_candle_count,
      least(coalesce(count(r.*), 0), 200)::integer as continuous_candle_count,
      max(r.candle_time) as latest_candle_time
    from symbols s
    left join recent_rows r
      on r.symbol = s.symbol
    group by s.symbol
  ),
  aggregated as (
    select
      count(*) filter (where today_candle_count > 0)::integer as intraday_1m_symbols_today,
      coalesce(sum(today_candle_count), 0)::integer as intraday_1m_rows_today,
      coalesce(sum(today_candle_count), 0)::integer as today_candle_count,
      coalesce(sum(warmup_candle_count), 0)::integer as warmup_candle_count,
      coalesce(sum(continuous_candle_count), 0)::integer as continuous_candle_count,
      count(*) filter (where continuous_candle_count >= 20)::integer as ready_ge_20,
      count(*) filter (where continuous_candle_count >= 35)::integer as ready_ge_35,
      count(*) filter (where continuous_candle_count >= 80)::integer as ready_ge_80,
      count(*) filter (where continuous_candle_count >= 200)::integer as ready_ge_200,
      max(latest_candle_time) as latest_candle_time
    from per_symbol
  )
  select
    intraday_1m_symbols_today,
    intraday_1m_rows_today,
    today_candle_count,
    warmup_candle_count,
    continuous_candle_count,
    ready_ge_20,
    ready_ge_35,
    ready_ge_80,
    ready_ge_200,
    ready_ge_20 as ready_ma20_continuous,
    ready_ge_35 as ready_ma35_continuous,
    ready_ge_80 as ready_macd_continuous,
    latest_candle_time,
    latest_candle_time as intraday_1m_latest_candle_time,
    (latest_candle_time at time zone 'Asia/Taipei')::text as latest_candle_time_taipei,
    case
      when latest_candle_time is null then 999999
      else greatest(0, extract(epoch from (now() - latest_candle_time)))::integer
    end as intraday_1m_stale_seconds
  from aggregated;
$$;

grant execute on function public.get_fugle_intraday_1m_coverage_stats(text[]) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
