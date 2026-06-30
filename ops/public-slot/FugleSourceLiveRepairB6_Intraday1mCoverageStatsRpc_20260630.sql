-- Fugle source live repair B6, 2026-06-30.
-- Fast intraday 1m coverage/readiness aggregate for the shared source writer.
-- Purpose: avoid full scans of v_fugle_intraday_1m_status during market hours.

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
    select q.symbol
    from public.v_fugle_quotes_commonstock_active q
    where coalesce(array_length(p_symbols, 1), 0) = 0
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
      count(*) filter (where today_candle_count > 0 and continuous_candle_count >= 20)::integer as ready_ge_20,
      count(*) filter (where today_candle_count > 0 and continuous_candle_count >= 35)::integer as ready_ge_35,
      count(*) filter (where today_candle_count > 0 and continuous_candle_count >= 80)::integer as ready_ge_80,
      count(*) filter (where today_candle_count > 0 and continuous_candle_count >= 200)::integer as ready_ge_200,
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
