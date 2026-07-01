-- Fugle source live repair B4, 2026-06-29.
-- Fast hot-symbol readiness view: avoid joining full v_fugle_intraday_1m_status.

create index if not exists idx_fugle_intraday_1m_symbol_candle_desc
  on public.fugle_intraday_1m (symbol, candle_time desc);

create or replace view public.v_daytrade_hot_symbol_readiness as
with quote_candidates as (
  select
    q.symbol,
    q.name,
    q.price,
    q.open_price,
    q.change_percent,
    q.total_volume,
    q.trade_value
  from public.v_fugle_quotes_commonstock_active q
  where coalesce(q.change_percent, 0) >= 2
     or coalesce(q.total_volume, 0) >= 3000
     or coalesce(q.trade_value, 0) > 0
  order by
    coalesce(q.trade_value, 0) desc,
    coalesce(q.total_volume, 0) desc,
    coalesce(q.change_percent, 0) desc,
    q.symbol asc
  limit 80
)
select
  q.symbol,
  q.name,
  q.price,
  q.open_price,
  case
    when coalesce(q.open_price, 0) > 0 then round(((((q.price - q.open_price) / q.open_price) * 100)::numeric), 4)
    else null
  end as amplitude_from_open,
  q.total_volume,
  q.trade_value,
  null::numeric as avg_volume5,
  coalesce(s.today_candle_count, 0) as today_candle_count,
  coalesce(s.continuous_candle_count, 0) >= 20 as ready_ge_20,
  coalesce(s.continuous_candle_count, 0) >= 35 as ready_ge_35,
  s.latest_candle_time_taipei,
  concat_ws(
    ',',
    case when coalesce(q.change_percent, 0) >= 2 then 'change_percent_ge_2' end,
    case when coalesce(q.total_volume, 0) >= 3000 then 'volume_top_or_liquid' end,
    case when coalesce(q.trade_value, 0) > 0 then 'trade_value_available' end,
    case when coalesce(s.continuous_candle_count, 0) >= 20 then 'ready_ma20_continuous' end,
    case when coalesce(s.continuous_candle_count, 0) >= 35 then 'ready_ma35_continuous' end
  ) as reason,
  coalesce(s.warmup_candle_count, 0) as warmup_candle_count,
  coalesce(s.continuous_candle_count, 0) as continuous_candle_count,
  coalesce(s.continuous_candle_count, 0) >= 20 as ready_ma20_continuous,
  coalesce(s.continuous_candle_count, 0) >= 35 as ready_ma35_continuous,
  coalesce(s.continuous_candle_count, 0) >= 80 as ready_macd_continuous
from quote_candidates q
left join lateral (
  with recent as (
    select
      m.symbol,
      m.market,
      m.candle_time,
      m.trade_date,
      m.updated_at,
      ((now() at time zone 'Asia/Taipei')::date) as taipei_today
    from public.fugle_intraday_1m m
    where m.symbol = q.symbol
    order by m.candle_time desc
    limit 200
  )
  select
    max(candle_time) as latest_candle_time,
    bool_or(trade_date = taipei_today) as has_today_data,
    count(*) filter (where trade_date = taipei_today)::integer as today_candle_count,
    count(*) filter (where trade_date < taipei_today)::integer as warmup_candle_count,
    count(*)::integer as continuous_candle_count,
    (max(candle_time) at time zone 'Asia/Taipei')::text as latest_candle_time_taipei
  from recent
) s on true;

grant select on public.v_daytrade_hot_symbol_readiness to anon, authenticated, service_role;

notify pgrst, 'reload schema';
