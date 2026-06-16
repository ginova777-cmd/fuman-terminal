-- Strategy3 quote-ready Fugle-first fix, 2026-06-16.
--
-- Contract:
--   - Strategy3 reads v_strategy3_quote_ready, not generic fallback quote views.
--   - cumulative_bid_volume, cumulative_ask_volume and cumulative_bid_ask_volume are lots.
--   - Fugle is the only Strategy3 quote-ready source.
--   - FinMind may fill generic v_market_quotes_unified gaps, but must not outrank same-day Fugle rows.

create or replace view public.v_market_quotes_unified as
with candidates as (
  select
    q.symbol,
    q.name,
    q.market,
    q.updated_at,
    q.price,
    q.open_price,
    q.high_price,
    q.low_price,
    q.previous_close,
    q.change_percent,
    q.total_volume,
    q.trade_value,
    q.last_trade_time,
    q.session,
    q.is_halted,
    q.is_trial,
    q.stock_type,
    q.cumulative_bid_volume,
    q.cumulative_ask_volume,
    q.cumulative_bid_ask_volume,
    q.updated_at as quote_updated_at,
    'fugle'::text as quote_source,
    q.payload,
    greatest(0, floor(extract(epoch from (now() - q.updated_at))))::integer as source_age_seconds,
    ((coalesce(q.last_trade_time, q.updated_at) at time zone 'Asia/Taipei')::date = (now() at time zone 'Asia/Taipei')::date) as is_same_taipei_trade_day,
    case
      when q.updated_at >= now() - interval '120 seconds' then 1
      when (coalesce(q.last_trade_time, q.updated_at) at time zone 'Asia/Taipei')::date = (now() at time zone 'Asia/Taipei')::date then 2
      else 4
    end as source_priority
  from public.fugle_quotes_live q
  where q.symbol ~ '^[0-9]{4}$'

  union all

  select
    f.symbol,
    coalesce(f.name, f.symbol) as name,
    null::text as market,
    f.updated_at,
    f.price,
    f.open_price,
    f.high_price,
    f.low_price,
    f.previous_close,
    f.change_percent,
    f.total_volume_lots as total_volume,
    f.trade_value_twd as trade_value,
    f.quote_time as last_trade_time,
    null::text as session,
    false as is_halted,
    false as is_trial,
    'COMMONSTOCK'::text as stock_type,
    f.buy_volume_lots as cumulative_bid_volume,
    f.sell_volume_lots as cumulative_ask_volume,
    coalesce(f.buy_volume_lots, 0) + coalesce(f.sell_volume_lots, 0) as cumulative_bid_ask_volume,
    f.updated_at as quote_updated_at,
    'finmind'::text as quote_source,
    f.payload,
    greatest(0, floor(extract(epoch from (now() - coalesce(f.quote_time, f.updated_at)))))::integer as source_age_seconds,
    ((coalesce(f.quote_time, f.updated_at) at time zone 'Asia/Taipei')::date = (now() at time zone 'Asia/Taipei')::date) as is_same_taipei_trade_day,
    case
      when (coalesce(f.quote_time, f.updated_at) at time zone 'Asia/Taipei')::date = (now() at time zone 'Asia/Taipei')::date then 3
      else 5
    end as source_priority
  from public.finmind_quotes_live f
  where f.symbol ~ '^[0-9]{4}$'
),
ranked as (
  select
    *,
    row_number() over (
      partition by symbol
      order by source_priority asc, source_age_seconds asc, updated_at desc
    ) as rn
  from candidates
)
select
  symbol,
  name,
  market,
  updated_at,
  price,
  open_price,
  high_price,
  low_price,
  previous_close,
  change_percent,
  total_volume,
  trade_value,
  last_trade_time,
  session,
  is_halted,
  is_trial,
  stock_type,
  cumulative_bid_volume,
  cumulative_ask_volume,
  cumulative_bid_ask_volume,
  quote_source,
  source_age_seconds as quote_age_seconds,
  (source_age_seconds <= 120) as quote_fresh,
  is_same_taipei_trade_day,
  'lots'::text as volume_unit,
  payload,
  total_volume as volume_lots,
  total_volume * 1000 as volume_shares,
  total_volume as trade_volume_lots,
  total_volume * 1000 as trade_volume_shares,
  total_volume as trade_volume,
  trade_value as trade_value_twd,
  quote_updated_at,
  (source_age_seconds <= 120) as is_quote_fresh
from ranked
where rn = 1;

create or replace view public.v_market_quotes_unified_health as
select
  count(*)::integer as active_symbols,
  count(*)::integer as quotes,
  count(*) filter (where quote_fresh)::integer as fresh_quotes_120s,
  count(*) filter (where is_same_taipei_trade_day)::integer as same_day_quotes,
  round(
    (count(*) filter (where quote_fresh))::numeric / nullif(count(*), 0),
    4
  ) as quote_coverage_ratio,
  min(quote_age_seconds)::integer as best_quote_age_seconds,
  max(quote_age_seconds)::integer as max_quote_age_seconds,
  coalesce(min(quote_age_seconds), 999999)::integer as quote_age_seconds,
  max(updated_at) as last_updated_at,
  max(last_trade_time) as last_quote_at,
  count(*) filter (where quote_source = 'fugle')::integer as fugle_rows,
  count(*) filter (where quote_source = 'finmind')::integer as finmind_rows,
  (count(*) filter (where quote_fresh) >= 500 and coalesce(min(quote_age_seconds), 999999) <= 120) as quotes_ok
from public.v_market_quotes_unified;

create or replace view public.v_strategy3_quote_ready as
select
  q.symbol,
  q.symbol as code,
  coalesce(u.name, q.name, q.symbol) as name,
  coalesce(u.market, q.market) as market,
  u.industry,
  q.price,
  q.price as close,
  q.previous_close as prev_close,
  q.previous_close,
  q.price - q.previous_close as change,
  q.change_percent,
  q.total_volume as trade_volume_lots,
  q.total_volume as trade_volume,
  q.total_volume * 1000 as trade_volume_shares,
  q.total_volume,
  q.trade_value,
  q.high_price as high,
  q.low_price as low,
  q.open_price as open,
  null::numeric as limit_up_price,
  null::numeric as limit_down_price,
  q.updated_at,
  q.last_trade_time,
  'fugle'::text as quote_source,
  q.last_trade_time as quote_time,
  greatest(0, floor(extract(epoch from (now() - coalesce(q.last_trade_time, q.updated_at)))))::integer as quote_age_seconds,
  (q.updated_at >= now() - interval '120 seconds') as quote_fresh,
  (q.updated_at >= now() - interval '120 seconds') as is_quote_fresh,
  ((coalesce(q.last_trade_time, q.updated_at) at time zone 'Asia/Taipei')::date = (now() at time zone 'Asia/Taipei')::date) as is_same_taipei_trade_day,
  'lots'::text as volume_unit,
  q.cumulative_bid_volume,
  q.cumulative_ask_volume,
  coalesce(q.cumulative_bid_ask_volume, coalesce(q.cumulative_bid_volume, 0) + coalesce(q.cumulative_ask_volume, 0)) as cumulative_bid_ask_volume,
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
  s.after_1300_candle_count,
  s.latest_candle_time,
  s.has_1300_candle,
  s.has_after_1300_candle,
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
    'universe', u.payload,
    'volume_source', d.volume_source,
    'cumulative_volume_unit', 'lots',
    'quote_source', 'fugle'
  ) as payload
from public.fugle_quotes_live q
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

grant select on public.v_market_quotes_unified to anon;
grant select on public.v_market_quotes_unified to authenticated;
grant select on public.v_market_quotes_unified to service_role;
grant select on public.v_market_quotes_unified_health to anon;
grant select on public.v_market_quotes_unified_health to authenticated;
grant select on public.v_market_quotes_unified_health to service_role;
grant select on public.v_strategy3_quote_ready to anon;
grant select on public.v_strategy3_quote_ready to authenticated;
grant select on public.v_strategy3_quote_ready to service_role;

comment on view public.v_strategy3_quote_ready is
  'Strategy3 Fugle-only quote-ready source. cumulative_bid_volume, cumulative_ask_volume and cumulative_bid_ask_volume are lots. FinMind is excluded from Strategy3 quote-ready.';

notify pgrst, 'reload schema';
