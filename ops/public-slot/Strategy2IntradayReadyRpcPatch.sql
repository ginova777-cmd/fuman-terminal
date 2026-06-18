-- Strategy2 intraday ready view + latest-N 1m RPC, 2026-06-16.
-- Safe to run more than once. Does not drop source tables.

create or replace view public.v_strategy2_intraday_ready as
select
  q.symbol,
  q.name,
  case
    when q.market = 'TSE' then 'TWSE'
    when q.market = 'OTC' then 'TPEX'
    else q.market
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
  coalesce(s.today_candle_count, s.candle_count, 0) as today_candle_count,
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
  d.days_5 as avg_5d_days,
  d.days_20 as avg_20d_days,
  s.updated_at as intraday_1m_status_updated_at
from public.v_fugle_quotes_commonstock_active q
left join public.stock_universe u
  on u.symbol = q.symbol
left join public.fugle_daily_volume_avg d
  on d.symbol = q.symbol
left join public.v_fugle_intraday_1m_status s
  on s.symbol = q.symbol
where q.symbol ~ '^[0-9]{4}$'
  and coalesce(u.is_active, true) = true
  and coalesce(u.is_etf, false) = false
  and coalesce(u.is_warrant, false) = false
  and coalesce(u.is_cb, false) = false
  and coalesce(u.is_blacklisted, false) = false;

comment on view public.v_strategy2_intraday_ready is
  'Strategy2 ready rows joining realtime quotes, stock universe, daily volume avg, and 1m status. Volume units are lots.';

grant select on public.v_strategy2_intraday_ready to anon;
grant select on public.v_strategy2_intraday_ready to service_role;

create or replace function public.get_strategy2_intraday_1m_latest_n(
  symbols text[],
  bars_per_symbol integer default 200
)
returns table (
  symbol text,
  candle_time timestamptz,
  open numeric,
  high numeric,
  low numeric,
  close numeric,
  volume numeric,
  trade_date date
)
language sql
stable
as $$
  select
    ranked.symbol,
    ranked.candle_time,
    ranked.open,
    ranked.high,
    ranked.low,
    ranked.close,
    ranked.volume,
    ranked.trade_date
  from (
    select
      m.symbol,
      m.candle_time,
      m.open,
      m.high,
      m.low,
      m.close,
      m.volume,
      m.trade_date,
      row_number() over (
        partition by m.symbol
        order by m.candle_time desc
      ) as rn
    from public.fugle_intraday_1m m
    where m.symbol = any(symbols)
  ) ranked
  where ranked.rn <= greatest(1, least(coalesce(bars_per_symbol, 200), 500))
  order by ranked.symbol asc, ranked.candle_time desc;
$$;

grant execute on function public.get_strategy2_intraday_1m_latest_n(text[], integer) to anon;
grant execute on function public.get_strategy2_intraday_1m_latest_n(text[], integer) to service_role;

notify pgrst, 'reload schema';
