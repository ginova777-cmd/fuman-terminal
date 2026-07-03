-- Strategy3 intraday 1m readiness fast RPC, 2026-07-03.
--
-- Purpose:
--   Avoid production readiness checks scanning public.v_strategy3_intraday_1m_status.
--   Strategy3 must have its own replayable health/snapshot numbers and must not
--   infer readiness from Strategy2 endpoint gates.

create index if not exists idx_fugle_intraday_1m_symbol_trade_date_candle_desc
  on public.fugle_intraday_1m (symbol, trade_date, candle_time desc);

create or replace function public.get_strategy3_intraday_1m_readiness(
  p_symbols text[],
  p_trade_date date default ((now() at time zone 'Asia/Taipei')::date),
  p_min_candles integer default 35,
  p_min_symbols integer default 1000
)
returns table (
  trade_date date,
  requested_symbols integer,
  today_1m_symbols integer,
  today_1m_rows integer,
  ready_ge_35 integer,
  latest_candle_time timestamptz,
  intraday_1m_stale_seconds integer,
  status text,
  reason text
)
language sql
stable
as $$
  with requested as (
    select distinct left(regexp_replace(symbol, '\D', '', 'g'), 4) as symbol
    from unnest(coalesce(p_symbols, array[]::text[])) as symbol
    where left(regexp_replace(symbol, '\D', '', 'g'), 4) ~ '^[0-9]{4}$'
  ),
  per_symbol as (
    select
      r.symbol,
      count(m.*)::integer as today_candle_count,
      max(m.candle_time) as latest_candle_time
    from requested r
    left join public.fugle_intraday_1m m
      on m.symbol = r.symbol
     and m.trade_date = p_trade_date
    group by r.symbol
  ),
  summary as (
    select
      p_trade_date as trade_date,
      count(*)::integer as requested_symbols,
      count(*) filter (where today_candle_count > 0)::integer as today_1m_symbols,
      coalesce(sum(today_candle_count), 0)::integer as today_1m_rows,
      count(*) filter (where today_candle_count >= greatest(1, p_min_candles))::integer as ready_ge_35,
      max(latest_candle_time) as latest_candle_time
    from per_symbol
  )
  select
    s.trade_date,
    s.requested_symbols,
    s.today_1m_symbols,
    s.today_1m_rows,
    s.ready_ge_35,
    s.latest_candle_time,
    case
      when s.latest_candle_time is null then null
      else greatest(0, floor(extract(epoch from (now() - s.latest_candle_time))))::integer
    end as intraday_1m_stale_seconds,
    case
      when s.requested_symbols <= 0 then 'not_ready'
      when s.ready_ge_35 >= p_min_symbols then 'ready'
      else 'not_ready'
    end as status,
    case
      when s.requested_symbols <= 0 then 'strategy3 symbol universe empty'
      when s.ready_ge_35 >= p_min_symbols then 'strategy3 intraday 1m readiness ready'
      else format('ready_ge_35 %s/%s below %s', s.ready_ge_35, s.requested_symbols, p_min_symbols)
    end as reason
  from summary s;
$$;

grant execute on function public.get_strategy3_intraday_1m_readiness(text[], date, integer, integer)
  to anon, authenticated, service_role;

notify pgrst, 'reload schema';
