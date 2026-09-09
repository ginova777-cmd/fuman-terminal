begin;

-- Preserve the genuine per-bar volume eligibility bit through the canonical
-- latest-N RPC. Consumers must keep failing closed when this value is null.
drop function if exists public.get_fugle_daytrade_intraday_1m_latest_n(text[], integer);
create function public.get_fugle_daytrade_intraday_1m_latest_n(
  symbols text[],
  bars_per_symbol integer default 200
)
returns table (
  symbol text,
  market text,
  trade_date date,
  candle_time timestamptz,
  open numeric,
  high numeric,
  low numeric,
  close numeric,
  volume numeric,
  source text,
  synthetic boolean,
  volume_strategy_usable boolean,
  updated_at timestamptz,
  payload jsonb
)
language sql
stable
as $$
  with requested_symbols as (
    select distinct nullif(regexp_replace(value, '\D', '', 'g'), '') as symbol
    from unnest(coalesce(symbols, array[]::text[])) as input(value)
  ),
  limits as (
    select greatest(1, least(coalesce(bars_per_symbol, 200), 500)) as bars_per_symbol
  )
  select
    m.symbol,
    m.market,
    m.trade_date,
    m.candle_time,
    m.open,
    m.high,
    m.low,
    m.close,
    m.volume,
    m.source,
    m.synthetic,
    m.volume_strategy_usable,
    m.updated_at,
    m.payload
  from requested_symbols s
  cross join limits l
  cross join lateral (
    select
      i.symbol,
      i.market,
      i.trade_date,
      i.candle_time,
      i.open,
      i.high,
      i.low,
      i.close,
      i.volume,
      i.source,
      i.synthetic,
      i.volume_strategy_usable,
      i.updated_at,
      i.payload
    from public.fugle_daytrade_intraday_1m i
    where i.symbol = s.symbol
    order by i.candle_time desc
    limit l.bars_per_symbol
  ) m
  where s.symbol is not null
  order by m.symbol asc, m.candle_time desc;
$$;

grant execute on function public.get_fugle_daytrade_intraday_1m_latest_n(text[], integer)
  to anon, authenticated, service_role;

comment on function public.get_fugle_daytrade_intraday_1m_latest_n(text[], integer) is
  'Canonical latest-N 1m bars. Preserves genuine volume_strategy_usable; readers must not default null to true.';

notify pgrst, 'reload schema';
commit;
