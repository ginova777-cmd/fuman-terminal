-- Institution / 三大法人 run_id complete gate, 2026-06-16.

create table if not exists public.institution_scan_runs (
  run_id text primary key,
  strategy text not null default 'institution',
  scan_date date not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',
  expected_total integer not null default 0,
  scanned_count integer not null default 0,
  result_count integer not null default 0,
  complete boolean not null default false,
  quality_status text not null default 'running',
  source text not null default '',
  schema_version text not null default 'institution-run-id-complete-v1',
  data_contract_source text not null default 'institution-cache',
  generated_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  constraint institution_scan_runs_status_chk check (status in ('running', 'complete', 'failed'))
);

create table if not exists public.institution_scan_results (
  run_id text not null references public.institution_scan_runs(run_id) on delete cascade,
  strategy text not null default 'institution',
  scan_date date not null,
  code text not null,
  name text not null default '',
  close numeric,
  change_percent numeric,
  trade_volume numeric,
  trade_value numeric,
  foreign_net numeric,
  trust_net numeric,
  dealer_net numeric,
  total_net numeric,
  rank integer not null default 0,
  reason text not null default '',
  payload jsonb not null default '{}'::jsonb,
  complete boolean not null default true,
  quality_status text not null default 'complete',
  schema_version text not null default 'institution-run-id-complete-v1',
  data_contract_source text not null default 'institution-cache',
  generated_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (run_id, strategy, code)
);

create index if not exists idx_institution_scan_runs_latest_complete
  on public.institution_scan_runs (strategy, status, complete, finished_at desc);

create index if not exists idx_institution_scan_results_run_id
  on public.institution_scan_results (run_id);

alter table public.institution_scan_runs enable row level security;
alter table public.institution_scan_results enable row level security;

drop policy if exists "read institution scan runs" on public.institution_scan_runs;
create policy "read institution scan runs"
on public.institution_scan_runs for select to anon using (true);

drop policy if exists "read institution scan results" on public.institution_scan_results;
create policy "read institution scan results"
on public.institution_scan_results for select to anon using (true);

grant select on public.institution_scan_runs to anon;
grant select on public.institution_scan_results to anon;
grant select, insert, update, delete on public.institution_scan_runs to service_role;
grant select, insert, update, delete on public.institution_scan_results to service_role;

create or replace view public.v_institution_latest_complete_run as
select
  run_id,
  strategy,
  scan_date,
  started_at,
  finished_at,
  status,
  expected_total,
  scanned_count,
  result_count,
  complete,
  quality_status,
  source,
  schema_version,
  data_contract_source,
  generated_at,
  updated_at,
  payload
from public.institution_scan_runs
where strategy = 'institution'
  and status = 'complete'
  and complete = true
order by scan_date desc, finished_at desc
limit 1;

grant select on public.v_institution_latest_complete_run to anon;

notify pgrst, 'reload schema';
