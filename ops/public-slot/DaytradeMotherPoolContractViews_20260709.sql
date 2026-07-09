-- Dedicated daytrade mother-pool contract views.
-- Purpose: expose the full chain explicitly:
--   full-market quote radar -> mother_pool 300 -> formal priority_top40.
-- Safe to run repeatedly in Supabase SQL Editor or via exec_sql.

begin;

drop view if exists public.v_fugle_daytrade_mother_pool_contract_health;
drop view if exists public.v_fugle_daytrade_formal_priority_top40;
drop view if exists public.v_fugle_daytrade_mother_pool;

create or replace view public.v_fugle_daytrade_mother_pool as
select
  p.symbol,
  p.name,
  p.market,
  p.priority_rank as mother_rank,
  p.priority_reason as mother_reason,
  p.source as mother_source,
  p.updated_at as mother_updated_at,
  coalesce(nullif(p.payload ->> 'score', '')::numeric, 0) as mother_score,
  coalesce(p.payload ->> 'motherPoolRuleVersion', 'daytrade_mother_pool_rank_overlap_20260709') as mother_pool_rule_version,
  coalesce(p.payload -> 'motherPoolRuleHits', '[]'::jsonb) as mother_pool_rule_hits,
  coalesce(p.payload -> 'motherPoolMetrics', '{}'::jsonb) as mother_pool_metrics,
  coalesce(nullif(p.payload #>> '{motherPoolMetrics,tradeValue}', '')::numeric, 0) as trade_value,
  coalesce(nullif(p.payload #>> '{motherPoolMetrics,totalVolume}', '')::numeric, 0) as total_volume,
  coalesce(nullif(p.payload #>> '{motherPoolMetrics,changePercent}', '')::numeric, 0) as change_percent,
  coalesce(nullif(p.payload #>> '{motherPoolMetrics,avgVolume5}', '')::numeric, 0) as avg_volume5,
  coalesce(nullif(p.payload #>> '{motherPoolMetrics,turnoverRate}', '')::numeric, 0) as turnover_rate,
  coalesce(nullif(p.payload #>> '{motherPoolMetrics,quoteFresh}', '')::boolean, false) as quote_fresh_at_rank,
  q.quote_seen_at,
  q.updated_at as quote_updated_at,
  coalesce(extract(epoch from (now() - q.quote_seen_at))::integer, 999999) as quote_age_seconds,
  q.price,
  q.change_percent as live_change_percent,
  q.total_volume as live_total_volume,
  q.trade_value as live_trade_value,
  d.trade_date as daily_volume_trade_date,
  coalesce(d.avg_volume5, 0) as live_avg_volume5,
  case
    when p.priority_rank <= coalesce(nullif(ss.payload ->> 'formal_daytrade_priority_limit', '')::integer, 40) then true
    else false
  end as in_formal_priority_top40,
  case
    when q.symbol is null then 'quote_missing'
    when coalesce(extract(epoch from (now() - q.quote_seen_at))::integer, 999999) > 120 then 'quote_stale'
    when coalesce(d.avg_volume5, 0) <= 0 then 'daily_volume_missing'
    else 'ready'
  end as mother_readiness_status,
  p.payload
from public.fugle_daytrade_priority_pool p
left join public.fugle_daytrade_quotes_live q on q.symbol = p.symbol
left join public.fugle_daytrade_daily_volume_avg d on d.symbol = p.symbol
left join public.source_status ss on ss.source_name = 'fugle_daytrade_source';

create or replace view public.v_fugle_daytrade_formal_priority_top40 as
select *
from public.v_fugle_daytrade_mother_pool
where in_formal_priority_top40 is true
order by mother_rank asc, symbol asc;

create or replace view public.v_fugle_daytrade_mother_pool_contract_health as
with status_row as (
  select
    s.status,
    s.updated_at,
    s.message,
    s.payload
  from public.source_status s
  where s.source_name = 'fugle_daytrade_source'
  limit 1
),
mother as (
  select
    count(*)::integer as mother_pool_symbols,
    count(*) filter (where mother_readiness_status = 'ready')::integer as mother_ready_rows,
    count(*) filter (where quote_age_seconds <= 120)::integer as mother_fresh_quote_rows,
    count(*) filter (where live_avg_volume5 > 0)::integer as mother_daily_volume_rows,
    min(mother_rank)::integer as min_mother_rank,
    max(mother_rank)::integer as max_mother_rank,
    max(mother_updated_at) as mother_updated_at
  from public.v_fugle_daytrade_mother_pool
),
formal as (
  select
    count(*)::integer as formal_priority_symbols,
    count(*) filter (where mother_readiness_status = 'ready')::integer as formal_ready_rows,
    count(*) filter (where quote_age_seconds <= 120)::integer as formal_fresh_quote_rows,
    count(*) filter (where live_avg_volume5 > 0)::integer as formal_daily_volume_rows,
    max(quote_age_seconds)::integer as formal_max_quote_age_seconds,
    (percentile_disc(0.95) within group (order by quote_age_seconds))::integer as formal_p95_quote_age_seconds
  from public.v_fugle_daytrade_formal_priority_top40
)
select
  'fugle_daytrade_source'::text as source_name,
  coalesce(sr.status, 'missing') as source_status,
  sr.updated_at as source_updated_at,
  sr.message as source_message,
  coalesce(sr.payload ->> 'mother_pool_source', 'dynamic_daytrade_mother_pool') as mother_pool_source,
  coalesce(sr.payload ->> 'mother_pool_rule_version', 'daytrade_mother_pool_rank_overlap_20260709') as mother_pool_rule_version,
  coalesce((sr.payload ->> 'formal_scope'), 'priority_top40') as formal_scope,
  coalesce(nullif(sr.payload ->> 'formal_daytrade_priority_limit', '')::integer, 40) as formal_priority_limit,
  coalesce(m.mother_pool_symbols, 0) as mother_pool_symbols,
  coalesce(m.mother_ready_rows, 0) as mother_ready_rows,
  coalesce(m.mother_fresh_quote_rows, 0) as mother_fresh_quote_rows,
  case
    when coalesce(m.mother_pool_symbols, 0) > 0
      then round((m.mother_fresh_quote_rows::numeric / greatest(m.mother_pool_symbols, 1)), 4)
    else 0::numeric
  end as mother_fresh_quote_coverage_120s,
  coalesce(m.mother_daily_volume_rows, 0) as mother_daily_volume_rows,
  coalesce(nullif(sr.payload ->> 'ready_ma20_continuous_symbols', '')::integer, 0) as daytrade_ready_ma20_continuous_symbols,
  coalesce(nullif(sr.payload ->> 'ready_ma35_continuous_symbols', '')::integer, 0) as daytrade_ready_ma35_continuous_symbols,
  coalesce(m.min_mother_rank, 0) as min_mother_rank,
  coalesce(m.max_mother_rank, 0) as max_mother_rank,
  m.mother_updated_at,
  coalesce(f.formal_priority_symbols, 0) as formal_priority_symbols,
  coalesce(f.formal_ready_rows, 0) as formal_ready_rows,
  coalesce(f.formal_fresh_quote_rows, 0) as formal_fresh_quote_rows,
  case
    when coalesce(f.formal_priority_symbols, 0) > 0
      then round((f.formal_fresh_quote_rows::numeric / greatest(f.formal_priority_symbols, 1)), 4)
    else 0::numeric
  end as formal_fresh_quote_coverage_120s,
  coalesce(f.formal_daily_volume_rows, 0) as formal_daily_volume_rows,
  coalesce(f.formal_max_quote_age_seconds, 999999) as formal_max_quote_age_seconds,
  coalesce(f.formal_p95_quote_age_seconds, 999999) as formal_p95_quote_age_seconds,
  case
    when coalesce(m.mother_pool_symbols, 0) >= 300
      and coalesce(f.formal_priority_symbols, 0) >= coalesce(nullif(sr.payload ->> 'formal_daytrade_priority_limit', '')::integer, 40)
      then 'ready'
    when coalesce(m.mother_pool_symbols, 0) >= 180
      and coalesce(f.formal_priority_symbols, 0) >= 40
      then 'partial'
    else 'not_ready'
  end as contract_status,
  case
    when coalesce(m.mother_pool_symbols, 0) < 180 then 'mother_pool_below_min_180'
    when coalesce(f.formal_priority_symbols, 0) < 40 then 'formal_priority_top40_below_40'
    when coalesce(m.mother_pool_symbols, 0) < 300 then 'mother_pool_below_target_300'
    else ''
  end as contract_reason
from status_row sr
cross join mother m
cross join formal f;

grant select on public.v_fugle_daytrade_mother_pool to anon, authenticated, service_role;
grant select on public.v_fugle_daytrade_formal_priority_top40 to anon, authenticated, service_role;
grant select on public.v_fugle_daytrade_mother_pool_contract_health to anon, authenticated, service_role;

commit;
