begin;

-- Canonical gates must consume the writer's dynamic formal-scan scope, rather
-- than deriving a legacy fixed 40-symbol subset from rank order.
create or replace view public.v_fugle_daytrade_mother_pool_contract_health as
with source_row as (
  select
    coalesce((
      select s.payload
      from public.source_status s
      where s.source_name = 'fugle_daytrade_source'
      order by s.updated_at desc
      limit 1
    ), '{}'::jsonb) as payload,
    coalesce((
      select s.updated_at
      from public.source_status s
      where s.source_name = 'fugle_daytrade_source'
      order by s.updated_at desc
      limit 1
    ), to_timestamp(0)) as source_updated_at
),
metadata as (
  select
    min(p.priority_rank)::integer as min_mother_rank,
    max(p.priority_rank)::integer as max_mother_rank,
    max(p.updated_at) as mother_updated_at,
    count(*) filter (where d.symbol is not null)::bigint as mother_daily_volume_rows
  from public.fugle_daytrade_priority_pool p
  left join public.fugle_daytrade_daily_volume_avg d on d.symbol = p.symbol
  where p.payload ->> 'basePoolEligible' = 'true'
),
dynamic_scope as (
  select
    coalesce((payload ->> 'mother_pool_symbols')::bigint, 0) as mother_pool_symbols,
    coalesce((payload ->> 'mother_pool_fresh_quotes_120s')::bigint, 0) as mother_fresh_quote_rows,
    coalesce((payload ->> 'mother_pool_fresh_coverage_120s')::numeric, 0) as mother_fresh_quote_coverage_120s,
    coalesce((payload ->> 'formal_scan_pool_symbols')::bigint, 0) as formal_priority_symbols,
    coalesce((payload ->> 'formal_deep_scan_fresh_quotes_120s')::bigint, 0) as formal_fresh_quote_rows,
    coalesce((payload ->> 'formal_deep_scan_fresh_quote_coverage_120s')::numeric, 0) as formal_fresh_quote_coverage_120s,
    coalesce((payload ->> 'formal_scan_max_quote_age_seconds')::integer, 999999) as formal_max_quote_age_seconds,
    coalesce((payload ->> 'daily_volume_rows')::bigint, 0) as daily_volume_rows,
    coalesce((payload ->> 'ready_ma20_continuous')::bigint, 0) as daytrade_ready_ma20_continuous_symbols,
    coalesce((payload ->> 'ready_ma35_continuous')::bigint, 0) as daytrade_ready_ma35_continuous_symbols
  from source_row
),
projected as (
  select
    d.*,
    m.min_mother_rank,
    m.max_mother_rank,
    m.mother_updated_at,
    m.mother_daily_volume_rows,
    case
      when d.mother_pool_symbols >= 300
       and d.formal_priority_symbols > 0
       and d.formal_priority_symbols <= d.mother_pool_symbols
       and d.mother_fresh_quote_coverage_120s >= 0.80
       and d.formal_fresh_quote_coverage_120s >= 0.95
       and d.formal_max_quote_age_seconds <= 120
      then 'ready'
      else 'not_ready'
    end::text as contract_status
  from dynamic_scope d
  cross join metadata m
)
select
  'fugle_daytrade_source'::text as source_name,
  case when contract_status = 'ready' then 'ready' else 'degraded' end::text as source_status,
  source_row.source_updated_at,
  case when contract_status = 'ready'
    then format('dynamic formal scan ready; formal=%s/%s', formal_priority_symbols, mother_pool_symbols)
    else format('dynamic formal scan pending; formal=%s/%s', formal_priority_symbols, mother_pool_symbols)
  end::text as source_message,
  'dynamic_daytrade_mother_pool'::text as mother_pool_source,
  'daytrade_mother_pool_dynamic_discovery_union_20260827'::text as mother_pool_rule_version,
  'priority_hot_deep_scan_pool_only'::text as formal_scope,
  0::integer as formal_priority_limit,
  mother_pool_symbols,
  formal_priority_symbols,
  mother_fresh_quote_rows,
  formal_fresh_quote_rows,
  mother_fresh_quote_coverage_120s,
  formal_fresh_quote_coverage_120s,
  mother_daily_volume_rows,
  daily_volume_rows as formal_daily_volume_rows,
  daytrade_ready_ma20_continuous_symbols,
  daytrade_ready_ma35_continuous_symbols,
  min_mother_rank,
  max_mother_rank,
  mother_updated_at,
  null::integer as formal_max_mother_rank,
  formal_max_quote_age_seconds,
  null::double precision as formal_p95_quote_age_seconds,
  contract_status,
  case when contract_status = 'ready' then '' else 'dynamic_formal_scan_scope_not_ready' end::text as contract_reason,
  50::numeric as mother_pool_min_price,
  true as mother_pool_price_floor_enforced
from projected
cross join source_row;

grant select on public.v_fugle_daytrade_mother_pool_contract_health to anon, authenticated, service_role;
notify pgrst, 'reload schema';
commit;