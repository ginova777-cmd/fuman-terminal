-- Strategy4 run_id complete gate, 2026-06-16.
-- Safe to run more than once. Keeps old rows and allows multiple complete runs per day.

create table if not exists public.strategy4_scan_runs (
  run_id text primary key,
  strategy text not null default 'strategy4',
  scan_date date not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',
  expected_total integer,
  scanned_count integer,
  result_count integer,
  no_data_count integer,
  error_count integer,
  complete boolean not null default false,
  quality_status text,
  schema_version text,
  volume_unit text,
  data_contract_source text,
  source text,
  generated_at timestamptz,
  updated_at timestamptz not null default now(),
  payload jsonb default '{}'::jsonb,
  constraint strategy4_scan_runs_status_chk check (status in ('running', 'complete', 'failed'))
);

alter table public.strategy4_scan_results
  add column if not exists run_id text;

update public.strategy4_scan_results
set run_id = coalesce(
  run_id,
  'legacy-' || replace(coalesce(scan_date::text, current_date::text), '-', '') || '-' || strategy
)
where run_id is null;

alter table public.strategy4_scan_results
  alter column run_id set default ('legacy-' || replace(current_date::text, '-', '') || '-strategy4');

-- The old primary key blocks more than one same-day scan. Drop it after run_id exists.
alter table public.strategy4_scan_results
  drop constraint if exists strategy4_scan_results_pkey;

create unique index if not exists strategy4_scan_results_run_strategy_code_uidx
  on public.strategy4_scan_results (run_id, strategy, code);

create index if not exists idx_strategy4_scan_results_run_id
  on public.strategy4_scan_results (run_id);

create index if not exists idx_strategy4_scan_runs_strategy_status_finished
  on public.strategy4_scan_runs (strategy, status, finished_at desc);

alter table public.strategy4_scan_runs enable row level security;

drop policy if exists "read strategy4 scan runs" on public.strategy4_scan_runs;
create policy "read strategy4 scan runs"
on public.strategy4_scan_runs
for select
to anon
using (true);

grant select on public.strategy4_scan_runs to anon;
grant select, insert, update, delete on public.strategy4_scan_runs to service_role;
grant select on public.strategy4_scan_results to anon;
grant select, insert, update, delete on public.strategy4_scan_results to service_role;

notify pgrst, 'reload schema';
