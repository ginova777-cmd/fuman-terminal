-- Mother pool warming scope alignment: eligible + pending are valid warming members.
-- Formal entry remains fail-closed through is_formal_entry_eligible and canonical gate.
-- Execute only after confirming the existing view column contract is unchanged.

begin;

create or replace view public.v_fugle_daytrade_mother_pool as
select
  coalesce(d.trade_date, (q.quote_seen_at at time zone 'Asia/Taipei')::date, (p.updated_at at time zone 'Asia/Taipei')::date) as trade_date,
  p.symbol,
  coalesce(q.name, p.name) as name,
  coalesce(q.market, p.market) as market,
  q.price,
  q.open_price,
  q.previous_close,
  q.change_percent,
  case
    when q.open_price is not null and q.open_price <> 0 and q.price is not null
      then round(((q.price - q.open_price) / q.open_price) * 100, 4)
    else 0::numeric
  end as amplitude_from_open,
  coalesce(q.total_volume, 0) as total_volume,
  coalesce(q.trade_value, 0) as trade_value,
  coalesce(d.avg_volume5, d.avg5_volume, 0) as avg5_volume,
  coalesce(nullif(p.payload ->> 'score', '')::numeric, 0) as mother_pool_score,
  coalesce(nullif(p.payload ->> 'priorityScore', '')::numeric, nullif(p.payload ->> 'score', '')::numeric, 0) as priority_score,
  p.priority_rank,
  p.priority_rank as mother_pool_rank,
  coalesce(nullif(p.payload ->> 'isStrongGroupLeader', '')::boolean, false) as is_strong_group_leader,
  coalesce(nullif(p.payload ->> 'strongGroupLeaderScore', '')::numeric, 0) as strong_group_leader_score,
  coalesce(nullif(p.payload ->> 'futopt0846Ready', '')::boolean, false) as futopt_0846_ready,
  coalesce(nullif(p.payload ->> 'futopt0846Score', '')::numeric, 0) as futopt_0846_score,
  coalesce(nullif(p.payload ->> 'turnoverRate3d', '')::numeric, 0) as turnover_rate_3d,
  coalesce(nullif(p.payload ->> 'turnoverRate5d', '')::numeric, 0) as turnover_rate_5d,
  coalesce(nullif(p.payload ->> 'turnoverScore', '')::numeric, 0) as turnover_score,
  coalesce(nullif(p.payload ->> 'marginDecreasePriceStrong', '')::boolean, false) as margin_decrease_price_strong,
  coalesce(nullif(p.payload ->> 'marginDecreasePriceStrongScore', '')::numeric, 0) as margin_decrease_price_strong_score,
  coalesce(nullif(p.payload ->> 'marginShortSyncPriceStrong', '')::boolean, false) as margin_short_sync_price_strong,
  coalesce(nullif(p.payload ->> 'marginShortSyncPriceStrongScore', '')::numeric, 0) as margin_short_sync_price_strong_score,
  coalesce(nullif(p.payload ->> 'exDividendRisk', '')::boolean, false) as ex_dividend_risk,
  coalesce(nullif(p.payload ->> 'nextDaySellRisk', '')::boolean, false) as next_day_sell_risk,
  coalesce(nullif(p.payload ->> 'daytradeRiskPenalty', '')::numeric, 0) as daytrade_risk_penalty,
  p.priority_rank as mother_rank,
  p.priority_reason as mother_reason,
  p.source as mother_source,
  p.updated_at as mother_updated_at,
  coalesce(nullif(p.payload ->> 'score', '')::numeric, 0) as mother_score,
  coalesce(p.payload ->> 'motherPoolRuleVersion', 'daytrade_mother_pool_base_filter_20260727') as mother_pool_rule_version,
  coalesce(p.payload -> 'motherPoolRuleHits', '[]'::jsonb) as mother_pool_rule_hits,
  coalesce(p.payload -> 'motherPoolMetrics', '{}'::jsonb) as mother_pool_metrics,
  coalesce(nullif(p.payload #>> '{motherPoolMetrics,tradeValue}', '')::numeric, 0) as mother_metric_trade_value,
  coalesce(nullif(p.payload #>> '{motherPoolMetrics,totalVolume}', '')::numeric, 0) as mother_metric_total_volume,
  coalesce(nullif(p.payload #>> '{motherPoolMetrics,changePercent}', '')::numeric, 0) as mother_metric_change_percent,
  coalesce(nullif(p.payload #>> '{motherPoolMetrics,avgVolume5}', '')::numeric, 0) as mother_metric_avg_volume5,
  coalesce(nullif(p.payload #>> '{motherPoolMetrics,turnoverRate}', '')::numeric, 0) as turnover_rate,
  coalesce(nullif(p.payload #>> '{motherPoolMetrics,quoteFresh}', '')::boolean, false) as quote_fresh_at_rank,
  q.quote_seen_at,
  q.updated_at as quote_updated_at,
  coalesce(extract(epoch from (now() - q.quote_seen_at))::integer, 999999) as quote_age_seconds,
  q.change_percent as live_change_percent,
  q.total_volume as live_total_volume,
  q.trade_value as live_trade_value,
  d.trade_date as daily_volume_trade_date,
  coalesce(d.avg_volume5, d.avg5_volume, 0) as live_avg_volume5,
  case
    when p.priority_rank <= 40 then true
    else false
  end as in_formal_priority_top40,
  case
    when q.symbol is null then 'quote_missing'
    when coalesce(extract(epoch from (now() - q.quote_seen_at))::integer, 999999) > 120 then 'quote_stale'
    when coalesce(d.avg_volume5, d.avg5_volume, 0) <= 0 then 'daily_volume_missing'
    else 'ready'
  end as mother_readiness_status,
  (
    p.priority_rank <= 40
    and p.payload ->> 'basePoolEligible' = 'true'
    and q.symbol is not null
    and coalesce(extract(epoch from (now() - q.quote_seen_at))::integer, 999999) <= 120
    and coalesce(d.avg_volume5, d.avg5_volume, 0) > 0
  ) as is_formal_entry_eligible,
  'fugle_daytrade_source'::text as source_name,
  greatest(p.updated_at, coalesce(q.updated_at, p.updated_at), coalesce(d.updated_at, p.updated_at)) as updated_at,
  p.payload,
  coalesce(d.trade_date, (p.updated_at at time zone 'Asia/Taipei')::date) as source_trade_date,
  (q.quote_seen_at at time zone 'Asia/Taipei')::date as quote_trade_date,
  (p.updated_at at time zone 'Asia/Taipei')::date as pool_updated_trade_date,
  'live_quote_with_previous_daily_volume_basis'::text as pool_context,
  coalesce(d.avg_volume5, d.avg5_volume, 0) as avg_volume5,
  q.high_price as high_price,
  q.low_price as low_price,
  s.latest_candle_time,
  coalesce(s.latest_candle_age_seconds, 999999)::integer as intraday_1m_stale_seconds,
  coalesce(s.ready_ma5, false) as ready_ma5,
  coalesce(s.ready_ma10, false) as ready_ma10,
  coalesce(s.ready_ma30, false) as ready_ma30,
  s.ma5 as ma5,
  s.ma10 as ma10,
  s.ma35 as ma35,
  coalesce(s.ma5_ma10_ma35_bullish, false) as ma5_ma10_ma35_bullish,
  coalesce(s.ma5_ma10_ma35_bullish, false) as ma_bullish_alignment,
  coalesce(nullif(p.payload #>> '{motherPoolMetrics,volumeRatio5}', '')::numeric,
    case when coalesce(d.avg_volume5, d.avg5_volume, 0) > 0
      then coalesce(q.total_volume, 0) / coalesce(d.avg_volume5, d.avg5_volume, 1)
      else 0 end) as volume_vs_avg5_ratio,
  coalesce(nullif(p.payload #>> '{motherPoolMetrics,volumeRank}', '')::integer, 0) as volume_rank,
  coalesce(si.relative_volume_5m, nullif(p.payload #>> '{motherPoolMetrics,relativeVolume5m}', '')::numeric, 0) as relative_volume_5m,
  coalesce(nullif(si.recent_1m_volume_trend, ''), nullif(p.payload #>> '{motherPoolMetrics,recent1mVolumeTrend}', ''), 'unknown')::text as recent_1m_volume_trend,
  coalesce(si.ma5_rising, nullif(p.payload #>> '{motherPoolMetrics,ma5Rising}', '')::boolean, false) as ma5_rising,
  coalesce(si.ma10_rising, nullif(p.payload #>> '{motherPoolMetrics,ma10Rising}', '')::boolean, false) as ma10_rising,
  coalesce(si.ma30_rising, nullif(p.payload #>> '{motherPoolMetrics,ma30Rising}', '')::boolean, false) as ma30_rising,
  coalesce(si.ma35_rising, nullif(p.payload #>> '{motherPoolMetrics,ma35Rising}', '')::boolean, false) as ma35_rising,
  coalesce(q.price >= q.open_price and q.open_price > 0, false) as above_open_price,
  coalesce(nullif(p.payload #>> '{motherPoolMetrics,aboveVwap}', '')::boolean, false) as above_vwap,
  coalesce(q.price >= q.high_price * 0.985 and q.high_price > 0, false) as near_day_high,
  case when s.ma5 > 0 and q.price is not null then ((q.price - s.ma5) / s.ma5) * 100 else 0 end as distance_from_ma5_percent,
  coalesce(nullif(p.payload #>> '{motherPoolMetrics,sectorName}', ''), '')::text as sector_name,
  coalesce(nullif(p.payload #>> '{motherPoolMetrics,sectorStrengthScore}', '')::numeric, 0) as sector_strength_score,
  coalesce(nullif(p.payload #>> '{motherPoolMetrics,sectorMemberActiveCount}', '')::integer, 0) as sector_member_active_count,
  coalesce(nullif(p.payload #>> '{motherPoolMetrics,futoptSyncScore}', '')::numeric, 0) as futopt_sync_score,
  coalesce(nullif(p.payload #>> '{motherPoolMetrics,liquidityScore}', '')::numeric, 0) as liquidity_score,
  coalesce(nullif(p.payload #>> '{motherPoolMetrics,spreadScore}', '')::numeric, 0) as spread_score,
  coalesce(nullif(p.payload #>> '{motherPoolMetrics,fakeStrengthPenalty}', '')::numeric, 0) as fake_strength_penalty,
  s.latest_candle_time as latest_1m_time,
  s.ma30 as ma30
from public.fugle_daytrade_priority_pool p
left join public.fugle_daytrade_quotes_live q on q.symbol = p.symbol
left join public.fugle_daytrade_daily_volume_avg d on d.symbol = p.symbol
left join public.v_fugle_daytrade_intraday_1m_status s on s.symbol = p.symbol
left join public.v_fugle_daytrade_intraday_1m_technical_status si on si.symbol = p.symbol
left join public.source_status ss on ss.source_name = 'fugle_daytrade_source'
where coalesce(p.payload ->> 'basePoolEligible', 'false') = 'true'
   or coalesce(p.payload ->> 'basePoolPending', 'false') = 'true';


grant select on public.v_fugle_daytrade_mother_pool to anon, authenticated, service_role;
notify pgrst, 'reload schema';
commit;

-- Fast health contract uses the same warming membership scope.
begin;

create or replace view public.v_fugle_daytrade_mother_pool_contract_health as
with ranked as (
  select
    p.priority_rank,
    row_number() over (order by p.priority_rank asc, p.symbol asc) as formal_row,
    p.updated_at as pool_updated_at,
    q.quote_seen_at,
    q.updated_at as quote_updated_at,
    d.updated_at as daily_updated_at,
    d.symbol as daily_symbol
  from public.fugle_daytrade_priority_pool p
  left join public.fugle_daytrade_quotes_live q on q.symbol = p.symbol
  left join public.fugle_daytrade_daily_volume_avg d on d.symbol = p.symbol
  where coalesce(p.payload ->> 'basePoolEligible', 'false') = 'true'
   or coalesce(p.payload ->> 'basePoolPending', 'false') = 'true'
),
stats as (
  select
    count(*)::bigint as mother_pool_symbols,
    count(*) filter (where formal_row <= 40)::bigint as formal_priority_symbols,
    count(*) filter (where quote_seen_at >= now() - interval '120 seconds')::bigint as mother_fresh_quote_rows,
    count(*) filter (where formal_row <= 40 and quote_seen_at >= now() - interval '120 seconds')::bigint as formal_fresh_quote_rows,
    count(*) filter (where daily_symbol is not null)::bigint as mother_daily_volume_rows,
    count(*) filter (where formal_row <= 40 and daily_symbol is not null)::bigint as formal_daily_volume_rows,
    min(priority_rank)::integer as min_mother_rank,
    max(priority_rank)::integer as max_mother_rank,
    max(priority_rank) filter (where formal_row <= 40)::integer as formal_max_mother_rank,
    max(extract(epoch from (now() - quote_seen_at))) filter (where formal_row <= 40)::integer as formal_max_quote_age_seconds,
    percentile_cont(0.95) within group (order by extract(epoch from (now() - quote_seen_at)))
      filter (where formal_row <= 40 and quote_seen_at is not null)::double precision as formal_p95_quote_age_seconds,
    max(greatest(pool_updated_at, coalesce(quote_updated_at, pool_updated_at), coalesce(daily_updated_at, pool_updated_at))) as latest_updated_at
  from ranked
),
payload as (
  select
    s.*,
    case when s.mother_pool_symbols >= 300 and s.formal_priority_symbols = 40 then 'ready' else 'not_ready' end::text as contract_status,
    case when s.mother_pool_symbols >= 300 and s.formal_priority_symbols = 40 then '' else 'mother_or_priority_pool_size_invalid' end::text as contract_reason,
    case when s.mother_pool_symbols > 0 then s.mother_fresh_quote_rows::numeric / s.mother_pool_symbols else 0::numeric end as mother_fresh_quote_coverage_120s,
    case when s.formal_priority_symbols > 0 then s.formal_fresh_quote_rows::numeric / s.formal_priority_symbols else 0::numeric end as formal_fresh_quote_coverage_120s
  from stats s
)
select
  'fugle_daytrade_source'::text as source_name,
  case when formal_fresh_quote_rows = formal_priority_symbols and formal_priority_symbols = 40 then 'ready' else 'degraded' end::text as source_status,
  latest_updated_at as source_updated_at,
  case when formal_fresh_quote_rows = formal_priority_symbols and formal_priority_symbols = 40
    then 'dedicated daytrade source ready; priority=40/40'
    else format('dedicated daytrade source freshness pending; priority=%s/40', formal_fresh_quote_rows)
  end::text as source_message,
  'dynamic_daytrade_mother_pool'::text as mother_pool_source,
  'daytrade_mother_pool_base_filter_20260727'::text as mother_pool_rule_version,
  'mother_pool_rotation_priority_top40'::text as formal_scope,
  40::integer as formal_priority_limit,
  mother_pool_symbols,
  formal_priority_symbols,
  mother_fresh_quote_rows,
  formal_fresh_quote_rows,
  mother_fresh_quote_coverage_120s,
  formal_fresh_quote_coverage_120s,
  mother_daily_volume_rows,
  formal_daily_volume_rows,
  0::bigint as daytrade_ready_ma20_continuous_symbols,
  0::bigint as daytrade_ready_ma35_continuous_symbols,
  min_mother_rank,
  max_mother_rank,
  latest_updated_at as mother_updated_at,
  formal_max_mother_rank,
  formal_max_quote_age_seconds,
  formal_p95_quote_age_seconds,
  contract_status,
  contract_reason
from payload;

grant select on public.v_fugle_daytrade_mother_pool_contract_health to anon, authenticated, service_role;
commit;
