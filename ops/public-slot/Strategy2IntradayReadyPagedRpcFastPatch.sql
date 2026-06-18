-- Strategy2 fast paged ready RPC, 2026-06-16.
-- Replaces the first paged RPC implementation. This version pages from
-- fugle_quotes_live first, then joins only that page to universe/daily/status
-- tables so Strategy2 can scan all rows without view full-scan timeouts.

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
  with page_quotes as (
    select
      q.symbol,
      q.name,
      q.market,
      q.price,
      q.previous_close,
      q.change_percent,
      q.total_volume,
      q.trade_value,
      q.open_price,
      q.high_price,
      q.low_price,
      q.session,
      q.is_halted,
      q.is_trial,
      q.updated_at,
      q.stock_type
    from public.fugle_quotes_live q
    where q.symbol ~ '^[0-9]{4}$'
      and coalesce(q.stock_type, 'COMMONSTOCK') = 'COMMONSTOCK'
    order by q.symbol asc
    limit greatest(1, least(coalesce(p_limit, 500), 1000))
    offset greatest(0, coalesce(p_offset, 0))
  )
  select
    q.symbol,
    coalesce(q.name, u.name) as name,
    case
      when coalesce(q.market, u.market) = 'TSE' then 'TWSE'
      when coalesce(q.market, u.market) = 'OTC' then 'TPEX'
      else coalesce(q.market, u.market)
    end as market,
    q.price,
    q.previous_close,
    q.change_percent,
    q.total_volume,
    q.trade_value,
    q.open_price,
    q.high_price,
    q.low_price,
    greatest(0, floor(extract(epoch from (now() - q.updated_at))))::integer as quote_age_seconds,
    coalesce(d.avg_5d_volume, 0) as avg_5d_volume,
    coalesce(s.today_candle_count, s.candle_count, 0)::integer as today_candle_count,
    s.latest_candle_time,
    coalesce(s.ready_ge_35, false) as ready_ge_35,
    coalesce(u.is_active, false) as is_active,
    coalesce(u.is_etf, false) as is_etf,
    coalesce(u.is_warrant, false) as is_warrant,
    coalesce(u.is_cb, false) as is_cb,
    coalesce(u.is_blacklisted, false) as is_blacklisted,
    coalesce(u.is_daytrade_unsuitable, false) as is_daytrade_unsuitable,
    q.session,
    q.is_halted,
    q.is_trial,
    q.updated_at as quote_updated_at,
    d.avg_20d_volume,
    d.days_5::integer as avg_5d_days,
    d.days_20::integer as avg_20d_days,
    s.updated_at as intraday_1m_status_updated_at
  from page_quotes q
  left join public.stock_universe u
    on u.symbol = q.symbol
  left join public.fugle_daily_volume_avg d
    on d.symbol = q.symbol
  left join public.v_fugle_intraday_1m_status s
    on s.symbol = q.symbol
  where coalesce(u.is_active, true) = true
    and coalesce(u.is_etf, false) = false
    and coalesce(u.is_warrant, false) = false
    and coalesce(u.is_cb, false) = false
    and coalesce(u.is_blacklisted, false) = false
  order by q.symbol asc;
$$;

grant execute on function public.get_strategy2_intraday_ready(integer, integer) to anon;
grant execute on function public.get_strategy2_intraday_ready(integer, integer) to service_role;

notify pgrst, 'reload schema';
