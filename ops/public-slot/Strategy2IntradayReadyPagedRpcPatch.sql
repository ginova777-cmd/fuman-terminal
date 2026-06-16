-- Strategy2 paged ready RPC, 2026-06-16.
-- Purpose:
--   Let Strategy2 scan the full intraday-ready universe in stable pages without
--   REST view full-scan/count timeouts or old multi-table fallback.
--
-- Usage:
--   select * from public.get_strategy2_intraday_ready(500, 0);
--   select * from public.get_strategy2_intraday_ready(500, 500);
--
-- REST RPC body:
--   {"p_limit":500,"p_offset":0}

create or replace function public.get_strategy2_intraday_ready(
  p_limit integer default 500,
  p_offset integer default 0
)
returns table (
  symbol text,
  name text,
  market text,
  price numeric,
  previous_close numeric,
  change_percent numeric,
  total_volume numeric,
  trade_value numeric,
  open_price numeric,
  high_price numeric,
  low_price numeric,
  quote_age_seconds integer,
  avg_5d_volume numeric,
  today_candle_count integer,
  latest_candle_time timestamptz,
  ready_ge_35 boolean,
  is_active boolean,
  is_etf boolean,
  is_warrant boolean,
  is_cb boolean,
  is_blacklisted boolean,
  is_daytrade_unsuitable boolean,
  session text,
  is_halted boolean,
  is_trial boolean,
  quote_updated_at timestamptz,
  avg_20d_volume numeric,
  avg_5d_days integer,
  avg_20d_days integer,
  intraday_1m_status_updated_at timestamptz
)
language sql
stable
as $$
  select
    r.symbol,
    r.name,
    r.market,
    r.price,
    r.previous_close,
    r.change_percent,
    r.total_volume,
    r.trade_value,
    r.open_price,
    r.high_price,
    r.low_price,
    r.quote_age_seconds,
    r.avg_5d_volume,
    r.today_candle_count::integer,
    r.latest_candle_time,
    r.ready_ge_35,
    r.is_active,
    r.is_etf,
    r.is_warrant,
    r.is_cb,
    r.is_blacklisted,
    r.is_daytrade_unsuitable,
    r.session,
    r.is_halted,
    r.is_trial,
    r.quote_updated_at,
    r.avg_20d_volume,
    r.avg_5d_days::integer,
    r.avg_20d_days::integer,
    r.intraday_1m_status_updated_at
  from public.v_strategy2_intraday_ready r
  order by r.symbol asc
  limit greatest(1, least(coalesce(p_limit, 500), 1000))
  offset greatest(0, coalesce(p_offset, 0));
$$;

grant execute on function public.get_strategy2_intraday_ready(integer, integer) to anon;
grant execute on function public.get_strategy2_intraday_ready(integer, integer) to service_role;

notify pgrst, 'reload schema';
