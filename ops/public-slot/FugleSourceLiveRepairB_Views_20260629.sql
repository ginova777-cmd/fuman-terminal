-- Fugle source live repair B, 2026-06-29.
-- Run after FugleSourceLiveRepairA_CoverageColumns_20260629.sql succeeds.
-- Purpose: add contract views/functions while preserving existing v_fugle_intraday_1m_status column order.

do $$
declare
  v_count_cast text := '::bigint';
  v_age_cast text := '::integer';
begin
  select case
    when data_type = 'integer' then '::integer'
    when data_type = 'numeric' then '::numeric'
    else '::bigint'
  end
  into v_count_cast
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'v_fugle_intraday_1m_status'
    and column_name = 'candle_count';

  select case
    when data_type = 'bigint' then '::bigint'
    when data_type = 'numeric' then '::numeric'
    else '::integer'
  end
  into v_age_cast
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'v_fugle_intraday_1m_status'
    and column_name = 'latest_candle_age_seconds';

  v_count_cast := coalesce(v_count_cast, '::bigint');
  v_age_cast := coalesce(v_age_cast, '::integer');

  execute format($view$
create or replace view public.v_fugle_intraday_1m_status as
with base as (
  select
    symbol,
    market,
    candle_time,
    trade_date,
    updated_at,
    ((now() at time zone 'Asia/Taipei')::date) as taipei_today
  from public.fugle_intraday_1m
),
ranked as (
  select
    *,
    row_number() over (
      partition by symbol
      order by candle_time desc
    ) as rn
  from base
),
windowed as (
  select *
  from ranked
  where rn <= 200
),
grouped as (
  select
    symbol,
    market,
    max(candle_time) as latest_candle_time,
    count(*)%1$s as candle_count,
    bool_or(trade_date = taipei_today) as has_today_data,
    max(updated_at) as updated_at,
    min(candle_time) as first_candle_time,
    count(*) filter (where trade_date = taipei_today)%1$s as today_candle_count,
    greatest(0, extract(epoch from (now() - max(candle_time))))%2$s as latest_candle_age_seconds,
    count(*) filter (where trade_date < taipei_today)%1$s as warmup_candle_count,
    count(*)%1$s as continuous_candle_count,
    (max(candle_time) at time zone 'Asia/Taipei')::text as latest_candle_time_taipei
  from windowed
  group by symbol, market
)
select
  symbol,
  market,
  latest_candle_time,
  candle_count,
  has_today_data,
  updated_at,
  first_candle_time,
  today_candle_count,
  latest_candle_age_seconds,
  (continuous_candle_count >= 35) as ready_ge_35,
  (continuous_candle_count >= 80) as ready_ge_80,
  (continuous_candle_count >= 200) as ready_ge_200,
  (continuous_candle_count >= 35) as ma35_available,
  today_candle_count as rows_today,
  latest_candle_time_taipei,
  (continuous_candle_count >= 20) as ready_ge_20,
  warmup_candle_count,
  continuous_candle_count,
  (continuous_candle_count >= 20) as ready_ma20_continuous,
  (continuous_candle_count >= 35) as ready_ma35_continuous,
  (continuous_candle_count >= 80) as ready_macd_continuous
from grouped
$view$, v_count_cast, v_age_cast);
end $$;

create or replace view public.v_fugle_source_latest_coverage as
select distinct on (source_name)
  source_name,
  trade_date,
  checked_at,
  status,
  quote_status,
  preopen_status,
  intraday_1m_status,
  daily_volume_status,
  active_symbols,
  quotes_symbols,
  preopen_symbols,
  daily_volume_symbols,
  daily_volume_avg_symbols,
  intraday_1m_symbols_today,
  intraday_1m_rows_today,
  ready_ge_35_symbols,
  ready_ge_80_symbols,
  ready_ge_200_symbols,
  latest_candle_time,
  latest_candle_time_taipei,
  quote_age_seconds,
  intraday_1m_stale_seconds,
  message,
  payload,
  permission_status,
  fresh_quotes_120s,
  daily_volume_ready_symbols,
  today_1m_symbols,
  today_1m_rows,
  warmup_candle_count,
  continuous_candle_count,
  ready_ge_20_symbols,
  ready_ma20_continuous_symbols,
  ready_ma35_continuous_symbols,
  ready_macd_continuous_symbols,
  top_movers_ready20_count,
  top_movers_ready35_count,
  scanner_can_run_quote_only,
  scanner_can_run_opening,
  scanner_can_run_ma20,
  scanner_can_run_ma35,
  scanner_can_run_full_intraday,
  scanner_block_reason
from public.fugle_source_coverage
order by source_name, checked_at desc;

create or replace view public.v_daytrade_hot_symbol_readiness as
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
  d.avg_5d_volume as avg_volume5,
  s.today_candle_count,
  coalesce(s.ready_ma20_continuous, s.ready_ge_20, coalesce(s.continuous_candle_count, 0) >= 20) as ready_ge_20,
  coalesce(s.ready_ma35_continuous, s.ready_ge_35, coalesce(s.continuous_candle_count, 0) >= 35) as ready_ge_35,
  s.latest_candle_time_taipei,
  concat_ws(
    ',',
    case when coalesce(q.change_percent, 0) >= 2 then 'change_percent_ge_2' end,
    case when coalesce(q.total_volume, 0) >= 3000 then 'volume_top_or_liquid' end,
    case when coalesce(q.trade_value, 0) > 0 then 'trade_value_available' end,
    case when coalesce(d.avg_5d_volume, 0) >= 3000 then 'avg_volume5_ge_3000' end,
    case when coalesce(s.ready_ma20_continuous, s.ready_ge_20, coalesce(s.continuous_candle_count, 0) >= 20) then 'ready_ma20_continuous' end,
    case when coalesce(s.ready_ma35_continuous, s.ready_ge_35, coalesce(s.continuous_candle_count, 0) >= 35) then 'ready_ma35_continuous' end
  ) as reason,
  s.warmup_candle_count,
  s.continuous_candle_count,
  coalesce(s.ready_ma20_continuous, s.ready_ge_20, coalesce(s.continuous_candle_count, 0) >= 20) as ready_ma20_continuous,
  coalesce(s.ready_ma35_continuous, s.ready_ge_35, coalesce(s.continuous_candle_count, 0) >= 35) as ready_ma35_continuous,
  coalesce(s.ready_macd_continuous, coalesce(s.continuous_candle_count, 0) >= 80) as ready_macd_continuous
from public.v_fugle_quotes_commonstock_active q
left join public.fugle_daily_volume_avg d
  on d.symbol = q.symbol
left join public.v_fugle_intraday_1m_status s
  on s.symbol = q.symbol
where coalesce(q.change_percent, 0) >= 2
   or coalesce(q.total_volume, 0) >= 3000
   or coalesce(q.trade_value, 0) > 0
   or coalesce(d.avg_5d_volume, 0) >= 3000;

create or replace view public.v_fugle_source_contract_health as
select
  s.source_name,
  s.trade_date,
  s.updated_at,
  s.status,
  s.stale_seconds,
  s.message,
  s.payload ->> 'source_contract_version' as source_contract_version,
  s.payload ->> 'writer_version' as writer_version,
  s.payload ->> 'quote_status' as quote_status,
  s.payload ->> 'preopen_status' as preopen_status,
  s.payload ->> 'intraday_1m_status' as intraday_1m_status,
  s.payload ->> 'daily_volume_status' as daily_volume_status,
  coalesce((s.payload ->> 'quote_age_seconds')::integer, s.stale_seconds, 999999) as quote_age_seconds,
  coalesce((s.payload ->> 'intraday_1m_stale_seconds')::integer, 999999) as intraday_1m_stale_seconds,
  coalesce((s.payload ->> 'intraday_1m_fresh_target_seconds')::integer, 60) as intraday_1m_fresh_target_seconds,
  coalesce((s.payload ->> 'intraday_1m_fresh_hard_seconds')::integer, 120) as intraday_1m_fresh_hard_seconds,
  coalesce((s.payload ->> 'fresh_quote_coverage_120s')::numeric, 0) as fresh_quote_coverage_120s,
  s.payload ->> 'mother_pool_source' as mother_pool_source,
  coalesce((s.payload ->> 'mother_pool_symbols')::integer, 0) as mother_pool_symbols,
  coalesce((s.payload ->> 'mother_pool_filtered')::integer, 0) as mother_pool_filtered,
  coalesce((s.payload ->> 'active_symbols')::integer, 0) as active_symbols,
  coalesce((s.payload ->> 'quotes')::integer, 0) as quotes,
  coalesce((s.payload ->> 'eligible_quote_rows')::integer, 0) as eligible_quote_rows,
  coalesce((s.payload ->> 'intraday_1m_symbols_today')::integer, 0) as intraday_1m_symbols_today,
  coalesce((s.payload ->> 'ready_ge_35_symbols')::integer, 0) as ready_ge_35_symbols,
  coalesce((s.payload ->> 'ready_ge_80_symbols')::integer, 0) as ready_ge_80_symbols,
  coalesce((s.payload ->> 'ready_ge_200_symbols')::integer, 0) as ready_ge_200_symbols,
  c.checked_at as latest_coverage_checked_at,
  c.status as latest_coverage_status,
  case
    when s.payload ->> 'source_contract_version' <> 'fugle-source-contract-20260629-01' then 'contract_mismatch'
    when s.updated_at < now() - interval '120 seconds' then 'heartbeat_stale'
    when s.payload ->> 'permission_status' <> 'ready' then 'permission_not_ready'
    when coalesce((s.payload ->> 'quote_age_seconds')::integer, s.stale_seconds, 999999) > 120 then 'quote_stale'
    when coalesce((s.payload ->> 'fresh_quote_coverage_120s')::numeric, 0) < 0.9
      and coalesce((s.payload ->> 'active_symbols')::integer, 0) >= 1000 then 'quote_fresh_coverage_low'
    when coalesce((s.payload ->> 'quote_derived_1m_full_universe')::boolean, false) <> true then 'quote_derived_not_full_universe'
    when coalesce((s.payload ->> 'intraday_1m_stale_seconds')::integer, 0) > coalesce((s.payload ->> 'intraday_1m_fresh_hard_seconds')::integer, 120) then 'intraday_1m_stale'
    when nullif(s.payload ->> 'scanner_block_reason', '') is not null then s.payload ->> 'scanner_block_reason'
    when s.status not in ('ok', 'degraded') then 'not_ready'
    else 'ready'
  end as source_contract_status,
  s.payload ->> 'permission_status' as permission_status,
  coalesce((s.payload ->> 'today_candle_count')::integer, 0) as today_candle_count,
  coalesce((s.payload ->> 'warmup_candle_count')::integer, 0) as warmup_candle_count,
  coalesce((s.payload ->> 'continuous_candle_count')::integer, 0) as continuous_candle_count,
  coalesce((s.payload ->> 'ready_ge_20_symbols')::integer, 0) as ready_ge_20_symbols,
  coalesce((s.payload ->> 'ready_ma20_continuous_symbols')::integer, 0) as ready_ma20_continuous_symbols,
  coalesce((s.payload ->> 'ready_ma35_continuous_symbols')::integer, 0) as ready_ma35_continuous_symbols,
  coalesce((s.payload ->> 'ready_macd_continuous_symbols')::integer, 0) as ready_macd_continuous_symbols,
  coalesce((s.payload ->> 'fresh_quotes_120s')::integer, 0) as fresh_quotes_120s,
  coalesce((s.payload ->> 'quote_derived_1m_candidate_symbols')::integer, 0) as quote_derived_1m_candidate_symbols,
  coalesce((s.payload ->> 'quote_derived_1m_full_universe')::boolean, false) as quote_derived_1m_full_universe,
  coalesce((s.payload ->> 'quote_derived_1m_rows')::integer, 0) as quote_derived_1m_rows,
  coalesce((s.payload ->> 'quote_derived_1m_opening_backfill_rows')::integer, 0) as quote_derived_1m_opening_backfill_rows,
  coalesce((s.payload ->> 'quote_derived_1m_opening_backfill_symbols')::integer, 0) as quote_derived_1m_opening_backfill_symbols,
  coalesce((s.payload ->> 'daily_volume_ready_symbols')::integer, 0) as daily_volume_ready_symbols,
  coalesce((s.payload ->> 'top_movers_ready20_count')::integer, 0) as top_movers_ready20_count,
  coalesce((s.payload ->> 'top_movers_ready35_count')::integer, 0) as top_movers_ready35_count,
  coalesce((s.payload ->> 'scanner_can_run_quote_only')::boolean, false) as scanner_can_run_quote_only,
  coalesce((s.payload ->> 'scanner_can_run_opening')::boolean, false) as scanner_can_run_opening,
  coalesce((s.payload ->> 'scanner_can_run_ma20')::boolean, false) as scanner_can_run_ma20,
  coalesce((s.payload ->> 'scanner_can_run_ma35')::boolean, false) as scanner_can_run_ma35,
  coalesce((s.payload ->> 'scanner_can_run_full_intraday')::boolean, false) as scanner_can_run_full_intraday,
  nullif(s.payload ->> 'scanner_block_reason', '') as scanner_block_reason
from public.source_status s
left join public.v_fugle_source_latest_coverage c
  on c.source_name = s.source_name;

drop function if exists public.get_fugle_intraday_1m_latest_n(text[], integer);

create or replace function public.get_fugle_intraday_1m_latest_n(
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
  updated_at timestamptz,
  payload jsonb
)
language sql
stable
as $$
  select
    ranked.symbol,
    ranked.market,
    ranked.trade_date,
    ranked.candle_time,
    ranked.open,
    ranked.high,
    ranked.low,
    ranked.close,
    ranked.volume,
    ranked.updated_at,
    ranked.payload
  from (
    select
      m.*,
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

grant select on public.v_fugle_intraday_1m_status to anon, authenticated, service_role;
grant select on public.v_fugle_source_latest_coverage to anon, authenticated, service_role;
grant select on public.v_fugle_source_contract_health to anon, authenticated, service_role;
grant select on public.v_daytrade_hot_symbol_readiness to anon, authenticated, service_role;
grant execute on function public.get_fugle_intraday_1m_latest_n(text[], integer) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
