-- Strategy3 V1 authority retirement.
-- Intentionally uses no CASCADE: an unexpected dependency aborts the whole transaction.
-- Strategy3 V2 and terminal_scorecard_* history are outside this deletion allowlist.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Preserve the shared health surface, but make its Strategy3 row V2-only before
-- the V1 run tables are removed.
create or replace view public.v_scanner_resource_health as
with latest_v2 as (
  select
    run_id,
    trade_date,
    status,
    complete,
    coverage,
    finished_at
  from public.strategy3_v2_scan_runs
  where strategy = 'strategy3_v2'
    and status = 'complete'
    and complete = true
  order by finished_at desc nulls last
  limit 1
), mother_pool as (
  select count(*)::bigint as row_count
  from public.v_fugle_daytrade_mother_pool
)
select
  legacy.strategy,
  legacy.required_source,
  legacy.latest_date,
  legacy.row_count,
  legacy.status,
  legacy.reason,
  legacy.suggested_scanner_behavior,
  legacy.updated_at
from public.v_scanner_resource_health_legacy_20260629 legacy
where legacy.strategy <> 'Strategy3'
union all
select
  'Strategy3'::text as strategy,
  'strategy3_v2_scan_runs/results + v_fugle_daytrade_mother_pool'::text as required_source,
  v2.trade_date as latest_date,
  coalesce((v2.coverage ->> 'result_count')::bigint, 0::bigint) as row_count,
  case when v2.run_id is not null then 'ready'::text else 'not_ready'::text end as status,
  concat(
    'latest_v2_run=', coalesce(v2.run_id, 'missing'),
    '; result_count=', coalesce(v2.coverage ->> 'result_count', '0'),
    '; scanned=', coalesce(v2.coverage ->> 'same_day_candle_symbols', '0'),
    '; expected=', coalesce(v2.coverage ->> 'formal_ready_target', v2.coverage #>> '{mother_pool,symbol_count}', '0'),
    '; mother_pool_rows=', coalesce(mp.row_count, 0)
  ) as reason,
  case
    when v2.run_id is not null then 'allow Strategy3 V2 publish and readback'
    else 'preserve latest Strategy3 V2 complete run; do not use V1 fallback'
  end::text as suggested_scanner_behavior,
  coalesce(v2.finished_at, now()) as updated_at
from mother_pool mp
left join latest_v2 v2 on true;

-- Remove every Strategy3 V1 view in dependency order. No CASCADE is used.
drop view if exists public.v_strategy3_source_gate;
drop view if exists public.v_strategy3_quote_ready_health;
drop view if exists public.v_strategy3_quote_ready_snapshot;
drop view if exists public.v_strategy3_quote_ready_heavy_20260626;
drop view if exists public.v_strategy3_source_speed_profile;
drop view if exists public.v_strategy3_quote_ready;
drop view if exists public.v_strategy3_intraday_1m_status;
drop view if exists public.v_strategy3_latest_complete_run;

-- The base shared-health compatibility view still declares this table. Keep an
-- empty shell until that shared legacy view is retired by its own module owner.
truncate table public.strategy3_ready_snapshot;

drop table if exists public.strategy3_intraday_1m_status_latest;
drop table if exists public.strategy3_scan_results;
drop table if exists public.strategy3_scan_runs;

notify pgrst, 'reload schema';

commit;
