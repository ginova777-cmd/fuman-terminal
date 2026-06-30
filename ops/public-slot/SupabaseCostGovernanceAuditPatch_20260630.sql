-- Supabase cost governance audit hardening.
-- Purpose:
--   1. Persist before/after row and size evidence in fuman_retention_cleanup_log.
--   2. Keep retention cleanup functions return-compatible with existing cron jobs.
--   3. Align fugle_intraday_1m retention audit wording with the 3-day cost contract.

begin;

alter table public.fuman_retention_cleanup_log
  add column if not exists before_rows bigint,
  add column if not exists after_rows bigint,
  add column if not exists before_total_bytes bigint,
  add column if not exists after_total_bytes bigint,
  add column if not exists before_total_size text,
  add column if not exists after_total_size text,
  add column if not exists audit_payload jsonb;

create index if not exists fuman_retention_cleanup_log_table_ran_at_idx
  on public.fuman_retention_cleanup_log (table_name, ran_at desc);

create or replace function public.fuman_retention_cleanup_once()
returns table(table_name text, keep_from_date date, deleted_rows integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  preopen_keep_from date := current_date - 3;
  intraday_keep_from date := current_date - 3;
  preopen_deleted integer := 0;
  intraday_deleted integer := 0;
  preopen_before_rows bigint := 0;
  preopen_after_rows bigint := 0;
  preopen_before_total_bytes bigint := 0;
  preopen_after_total_bytes bigint := 0;
  intraday_before_rows bigint := 0;
  intraday_after_rows bigint := 0;
  intraday_before_total_bytes bigint := 0;
  intraday_after_total_bytes bigint := 0;
  lock_acquired boolean := false;
begin
  lock_acquired := pg_try_advisory_lock(72620260630);
  if not lock_acquired then
    return;
  end if;

  select
    count(*)::bigint,
    pg_total_relation_size('public.fugle_preopen_snapshot_history'::regclass)
  into preopen_before_rows, preopen_before_total_bytes
  from public.fugle_preopen_snapshot_history;

  with doomed as (
    select ctid
    from public.fugle_preopen_snapshot_history
    where trade_date < preopen_keep_from
    limit 5000
  ),
  deleted as (
    delete from public.fugle_preopen_snapshot_history t
    using doomed d
    where t.ctid = d.ctid
    returning 1
  )
  select count(*)::integer into preopen_deleted from deleted;

  select
    count(*)::bigint,
    pg_total_relation_size('public.fugle_preopen_snapshot_history'::regclass)
  into preopen_after_rows, preopen_after_total_bytes
  from public.fugle_preopen_snapshot_history;

  insert into public.fuman_retention_cleanup_log (
    table_name,
    keep_from_date,
    deleted_rows,
    mode,
    note,
    keep_policy,
    before_rows,
    after_rows,
    before_total_bytes,
    after_total_bytes,
    before_total_size,
    after_total_size,
    audit_payload
  )
  values (
    'fugle_preopen_snapshot_history',
    preopen_keep_from,
    preopen_deleted,
    'apply',
    'keep rolling 3 days with before/after audit',
    'keep 3 days',
    preopen_before_rows,
    preopen_after_rows,
    preopen_before_total_bytes,
    preopen_after_total_bytes,
    pg_size_pretty(preopen_before_total_bytes),
    pg_size_pretty(preopen_after_total_bytes),
    jsonb_build_object(
      'auditContract', 'cost-governance-before-after-v1',
      'table', 'fugle_preopen_snapshot_history',
      'keepPolicy', 'keep 3 days',
      'deletedRows', preopen_deleted,
      'beforeRows', preopen_before_rows,
      'afterRows', preopen_after_rows,
      'beforeTotalBytes', preopen_before_total_bytes,
      'afterTotalBytes', preopen_after_total_bytes,
      'beforeTotalSize', pg_size_pretty(preopen_before_total_bytes),
      'afterTotalSize', pg_size_pretty(preopen_after_total_bytes)
    )
  );

  select
    count(*)::bigint,
    pg_total_relation_size('public.fugle_intraday_1m'::regclass)
  into intraday_before_rows, intraday_before_total_bytes
  from public.fugle_intraday_1m;

  with doomed as (
    select ctid
    from public.fugle_intraday_1m
    where trade_date < intraday_keep_from
    limit 5000
  ),
  deleted as (
    delete from public.fugle_intraday_1m t
    using doomed d
    where t.ctid = d.ctid
    returning 1
  )
  select count(*)::integer into intraday_deleted from deleted;

  select
    count(*)::bigint,
    pg_total_relation_size('public.fugle_intraday_1m'::regclass)
  into intraday_after_rows, intraday_after_total_bytes
  from public.fugle_intraday_1m;

  insert into public.fuman_retention_cleanup_log (
    table_name,
    keep_from_date,
    deleted_rows,
    mode,
    note,
    keep_policy,
    before_rows,
    after_rows,
    before_total_bytes,
    after_total_bytes,
    before_total_size,
    after_total_size,
    audit_payload
  )
  values (
    'fugle_intraday_1m',
    intraday_keep_from,
    intraday_deleted,
    'apply',
    'keep rolling 3 days with before/after audit',
    'keep 3 days',
    intraday_before_rows,
    intraday_after_rows,
    intraday_before_total_bytes,
    intraday_after_total_bytes,
    pg_size_pretty(intraday_before_total_bytes),
    pg_size_pretty(intraday_after_total_bytes),
    jsonb_build_object(
      'auditContract', 'cost-governance-before-after-v1',
      'table', 'fugle_intraday_1m',
      'keepPolicy', 'keep 3 days',
      'deletedRows', intraday_deleted,
      'beforeRows', intraday_before_rows,
      'afterRows', intraday_after_rows,
      'beforeTotalBytes', intraday_before_total_bytes,
      'afterTotalBytes', intraday_after_total_bytes,
      'beforeTotalSize', pg_size_pretty(intraday_before_total_bytes),
      'afterTotalSize', pg_size_pretty(intraday_after_total_bytes)
    )
  );

  perform pg_advisory_unlock(72620260630);
  lock_acquired := false;

  table_name := 'fugle_preopen_snapshot_history';
  keep_from_date := preopen_keep_from;
  deleted_rows := preopen_deleted;
  return next;

  table_name := 'fugle_intraday_1m';
  keep_from_date := intraday_keep_from;
  deleted_rows := intraday_deleted;
  return next;

exception when others then
  if lock_acquired then
    perform pg_advisory_unlock(72620260630);
  end if;
  raise;
end;
$function$;

grant execute on function public.fuman_retention_cleanup_once() to service_role;

create or replace function public.fuman_cleanup_intraday_1m_3d_once()
returns table(table_name text, keep_policy text, keep_from_date date, deleted_rows bigint, mode text, note text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  keep_from_date_value date := current_date - 3;
  deleted_count bigint := 0;
  before_rows_value bigint := 0;
  after_rows_value bigint := 0;
  before_total_bytes_value bigint := 0;
  after_total_bytes_value bigint := 0;
begin
  select
    count(*)::bigint,
    pg_total_relation_size('public.fugle_intraday_1m'::regclass)
  into before_rows_value, before_total_bytes_value
  from public.fugle_intraday_1m;

  delete from public.fugle_intraday_1m t
  where t.trade_date < keep_from_date_value;

  get diagnostics deleted_count = row_count;

  select
    count(*)::bigint,
    pg_total_relation_size('public.fugle_intraday_1m'::regclass)
  into after_rows_value, after_total_bytes_value
  from public.fugle_intraday_1m;

  insert into public.fuman_retention_cleanup_log (
    table_name,
    keep_from_date,
    deleted_rows,
    mode,
    note,
    keep_policy,
    before_rows,
    after_rows,
    before_total_bytes,
    after_total_bytes,
    before_total_size,
    after_total_size,
    audit_payload
  )
  values (
    'fugle_intraday_1m',
    keep_from_date_value,
    deleted_count::integer,
    'apply',
    'intraday 1m raw retention fixed cleanup robot with before/after audit',
    'keep 3 days',
    before_rows_value,
    after_rows_value,
    before_total_bytes_value,
    after_total_bytes_value,
    pg_size_pretty(before_total_bytes_value),
    pg_size_pretty(after_total_bytes_value),
    jsonb_build_object(
      'auditContract', 'cost-governance-before-after-v1',
      'table', 'fugle_intraday_1m',
      'keepPolicy', 'keep 3 days',
      'deletedRows', deleted_count,
      'beforeRows', before_rows_value,
      'afterRows', after_rows_value,
      'beforeTotalBytes', before_total_bytes_value,
      'afterTotalBytes', after_total_bytes_value,
      'beforeTotalSize', pg_size_pretty(before_total_bytes_value),
      'afterTotalSize', pg_size_pretty(after_total_bytes_value)
    )
  );

  return query
  select
    'fugle_intraday_1m'::text,
    'keep 3 days'::text,
    keep_from_date_value,
    deleted_count,
    'apply'::text,
    'intraday 1m raw retention fixed cleanup robot with before/after audit'::text;
end;
$function$;

grant execute on function public.fuman_cleanup_intraday_1m_3d_once() to service_role;

create or replace function public.fuman_guard_intraday_1m_3d_robot()
returns jsonb
language sql
security definer
set search_path to 'public'
as $function$
with metrics as (
  select
    count(*)::bigint as old_rows,
    pg_total_relation_size('public.fugle_intraday_1m'::regclass) as total_bytes,
    (
      select count(*)::integer
      from cron.job
      where jobname in (
        'fuman-intraday-1m-retention-3d-daily-2055-taipei',
        'fuman-intraday-1m-retention-3d-guard-2110-taipei'
      )
        and active
    ) as cleanup_job_active
  from public.fugle_intraday_1m
  where trade_date < current_date - 3
),
latest_audit as (
  select
    id,
    ran_at,
    table_name,
    keep_policy,
    keep_from_date,
    deleted_rows,
    before_rows,
    after_rows,
    before_total_bytes,
    after_total_bytes,
    before_total_size,
    after_total_size,
    audit_payload
  from public.fuman_retention_cleanup_log
  where table_name = 'fugle_intraday_1m'
  order by ran_at desc
  limit 1
),
payload as (
  select
    case
      when m.old_rows > 0
        or m.cleanup_job_active = 0
        or m.total_bytes > 512::bigint * 1024 * 1024
      then 'critical'
      else 'ok'
    end as status,
    jsonb_build_object(
      'status', case
        when m.old_rows > 0
          or m.cleanup_job_active = 0
          or m.total_bytes > 512::bigint * 1024 * 1024
        then 'critical'
        else 'ok'
      end,
      'table', 'fugle_intraday_1m',
      'keepPolicy', 'keep 3 days',
      'oldRows', m.old_rows,
      'cleanupJobActive', m.cleanup_job_active,
      'totalBytes', m.total_bytes,
      'totalSize', pg_size_pretty(m.total_bytes),
      'checkedAt', now(),
      'latestAudit', case
        when a.id is null then null
        else jsonb_build_object(
          'id', a.id,
          'ranAt', a.ran_at,
          'tableName', a.table_name,
          'keepPolicy', a.keep_policy,
          'keepFromDate', a.keep_from_date,
          'deletedRows', a.deleted_rows,
          'beforeRows', a.before_rows,
          'afterRows', a.after_rows,
          'beforeTotalBytes', a.before_total_bytes,
          'afterTotalBytes', a.after_total_bytes,
          'beforeTotalSize', a.before_total_size,
          'afterTotalSize', a.after_total_size,
          'hasBeforeAfterAudit',
            a.before_rows is not null
            and a.after_rows is not null
            and a.before_total_bytes is not null
            and a.after_total_bytes is not null,
          'auditPayload', coalesce(a.audit_payload, '{}'::jsonb)
        )
      end
    ) as payload
  from metrics m
  left join latest_audit a on true
),
insert_alert as (
  insert into public.fuman_cost_alerts (
    severity,
    code,
    message,
    payload
  )
  select
    'critical',
    'intraday_1m_retention_guard_critical',
    'Fuman intraday 1m cleanup robot needs attention',
    payload
  from payload
  where status = 'critical'
    and not exists (
      select 1
      from public.fuman_cost_alerts
      where code = 'intraday_1m_retention_guard_critical'
        and created_at >= now() - interval '12 hours'
    )
  returning 1
)
select payload from payload;
$function$;

grant execute on function public.fuman_guard_intraday_1m_3d_robot() to service_role;

create or replace view public.v_fuman_cost_governance_audit_status as
with latest as (
  select distinct on (table_name)
    table_name,
    ran_at,
    keep_policy,
    keep_from_date,
    deleted_rows,
    before_rows,
    after_rows,
    before_total_bytes,
    after_total_bytes,
    before_total_size,
    after_total_size,
    audit_payload
  from public.fuman_retention_cleanup_log
  where table_name in ('fugle_preopen_snapshot_history', 'fugle_intraday_1m')
  order by table_name, ran_at desc
)
select
  table_name,
  ran_at,
  keep_policy,
  keep_from_date,
  deleted_rows,
  before_rows,
  after_rows,
  before_total_bytes,
  after_total_bytes,
  before_total_size,
  after_total_size,
  (
    before_rows is not null
    and after_rows is not null
    and before_total_bytes is not null
    and after_total_bytes is not null
  ) as has_before_after_audit,
  coalesce(audit_payload, '{}'::jsonb) as audit_payload
from latest;

grant select on public.v_fuman_cost_governance_audit_status to anon;
grant select on public.v_fuman_cost_governance_audit_status to authenticated;
grant select on public.v_fuman_cost_governance_audit_status to service_role;

notify pgrst, 'reload schema';

commit;
