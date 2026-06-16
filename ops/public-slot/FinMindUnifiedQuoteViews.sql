-- Unified quote views, 2026-06-16.
-- FinMind becomes the terminal-wide secondary quote source.
--
-- Priority:
--   1. Fugle fresh quote, when updated_at is within 120 seconds.
--   2. Fugle same-day stale quote, before FinMind same-day snapshots.
--   3. FinMind same-day quote, when Fugle is missing.
--   4. Fugle old quote, as last resort before old FinMind rows.
--   5. FinMind old quote, final fallback for non-Strategy3 callers.

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

grant select on public.v_market_quotes_unified to anon;
grant select on public.v_market_quotes_unified to authenticated;
grant select on public.v_market_quotes_unified to service_role;
grant select on public.v_market_quotes_unified_health to anon;
grant select on public.v_market_quotes_unified_health to authenticated;
grant select on public.v_market_quotes_unified_health to service_role;

notify pgrst, 'reload schema';
