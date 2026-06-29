-- Strategy3 cumulative bid/ask volume view-only patch, 2026-06-16.
-- fugle_quotes_latest is a view, so do not ALTER it.
-- Unit contract:
--   cumulative_bid_volume = inner/bid-side accumulated volume in lots
--   cumulative_ask_volume = outer/ask-side accumulated volume in lots
--   cumulative_bid_ask_volume = cumulative_bid_volume + cumulative_ask_volume in lots

create or replace view public.v_strategy3_quote_ready as
select
  q.symbol,
  q.code,
  coalesce(u.name, q.name) as name,
  coalesce(u.market, q.market) as market,
  u.industry,
  q.close as price,
  q.close,
  q.prev_close,
  q.previous_close,
  q.change,
  q.change_percent,
  q.trade_volume_lots,
  q.trade_volume,
  q.trade_volume_shares,
  q.total_volume,
  q.trade_value,
  q.high,
  q.low,
  q.open,
  q.limit_up_price,
  q.limit_down_price,
  q.updated_at,
  q.last_trade_time,
  q.quote_source,
  q.quote_time,
  q.quote_age_seconds,
  q.is_quote_fresh,
  live.cumulative_bid_volume,
  live.cumulative_ask_volume,
  live.cumulative_bid_ask_volume,
  d.avg_5d_volume as avg_volume_5_lots,
  d.avg_20d_volume as avg_volume_20_lots,
  d.avg_5d_volume as avg_volume_5,
  d.avg_20d_volume as avg_volume_20,
  d.avg_5d_volume * 1000 as avg_volume_5_shares,
  d.avg_20d_volume * 1000 as avg_volume_20_shares,
  d.days_5 as avg_volume_5_days,
  d.days_20 as avg_volume_20_days,
  case
    when d.avg_5d_volume > 0 then q.total_volume / d.avg_5d_volume
    else null
  end as volume_ratio_5,
  rank() over (order by q.trade_value desc nulls last) as trade_value_rank,
  rank() over (order by q.total_volume desc nulls last) as total_volume_rank,
  null::numeric as issued_shares,
  null::numeric as turnover_rate,
  s.today_candle_count,
  s.rows_today,
  s.latest_candle_time,
  s.ready_35,
  s.ready_ge_35,
  s.ready_80,
  s.ready_ge_80,
  s.ready_100,
  s.ready_120,
  s.ready_160,
  q.stock_type,
  coalesce(u.is_active, true) as is_active,
  coalesce(u.is_etf, false) as is_etf,
  coalesce(u.is_warrant, false) as is_warrant,
  coalesce(u.is_cb, false) as is_cb,
  coalesce(u.is_blacklisted, false) as is_blacklisted,
  coalesce(u.is_daytrade_unsuitable, false) as is_daytrade_unsuitable,
  q.is_halted,
  q.is_trial,
  false as is_disposition,
  false as is_attention,
  false as is_full_delivery,
  false as is_periodic_auction,
  false as is_margin_suspended,
  q.session,
  jsonb_build_object(
    'quote', q.payload,
    'live_quote', live.payload,
    'universe', u.payload,
    'volume_source', d.volume_source,
    'cumulative_volume_unit', 'lots'
  ) as payload
from public.fugle_quotes_latest q
left join public.fugle_quotes_live live
  on live.symbol = q.symbol
left join public.v_stock_universe_unified u
  on u.symbol = q.symbol
left join public.v_daily_volume_avg_unified d
  on d.symbol = q.symbol
left join public.v_strategy3_intraday_1m_status s
  on s.symbol = q.symbol
where q.symbol ~ '^[0-9]{4}$'
  and coalesce(q.stock_type, 'COMMONSTOCK') = 'COMMONSTOCK'
  and coalesce(u.is_active, true) = true
  and coalesce(u.is_etf, false) = false
  and coalesce(u.is_warrant, false) = false
  and coalesce(u.is_cb, false) = false
  and coalesce(u.is_blacklisted, false) = false
  and coalesce(u.is_daytrade_unsuitable, false) = false;

grant select on public.v_strategy3_quote_ready to anon;
grant select on public.v_strategy3_quote_ready to service_role;

notify pgrst, 'reload schema';
