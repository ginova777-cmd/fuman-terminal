begin;

-- Keep the existing health-view column contract and hard-filtered membership,
-- but align the reported rule/scope with the dynamic 300-600 mother pool.
-- This patch deliberately avoids DROP CASCADE so dependent read paths remain
-- intact.
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
  where p.payload ->> 'basePoolEligible' = 'true'
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
  'daytrade_mother_pool_dynamic_discovery_union_20260808_avg5_classified'::text as mother_pool_rule_version,
  'mother_pool_300_rotating_deep_scan'::text as formal_scope,
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
notify pgrst, 'reload schema';
commit;
