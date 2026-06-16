-- Strategy5 run_id complete gate, 2026-06-16.
-- One run_id represents one complete Strategy5 batch. Readers should only use latest complete runs.

create table if not exists public.strategy5_scan_runs (
  run_id text primary key,
  strategy text not null default 'strategy5',
  scan_date date not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',
  expected_total integer not null default 0,
  scanned_count integer not null default 0,
  result_count integer not null default 0,
  complete boolean not null default false,
  quality_status text,
  source text,
  schema_version text,
  data_contract_source text,
  generated_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  constraint strategy5_scan_runs_status_chk check (status in ('running', 'complete', 'failed'))
);

create table if not exists public.strategy5_scan_results (
  id bigserial primary key,
  run_id text not null references public.strategy5_scan_runs(run_id) on delete cascade,
  strategy text not null default 'strategy5',
  scan_date date not null,
  code text not null,
  name text,
  price numeric,
  close numeric,
  change_percent numeric,
  volume numeric,
  trade_volume numeric,
  trade_value numeric,
  score numeric,
  rank integer,
  reason text,
  signals jsonb not null default '[]'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  complete boolean not null default false,
  quality_status text,
  schema_version text,
  data_contract_source text,
  generated_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists strategy5_scan_results_run_strategy_code_uidx
  on public.strategy5_scan_results (run_id, strategy, code);

create index if not exists idx_strategy5_scan_results_run_id
  on public.strategy5_scan_results (run_id);

create index if not exists idx_strategy5_scan_runs_latest_complete
  on public.strategy5_scan_runs (strategy, status, complete, finished_at desc);

alter table public.strategy5_scan_runs enable row level security;
alter table public.strategy5_scan_results enable row level security;

drop policy if exists "read strategy5 scan runs" on public.strategy5_scan_runs;
create policy "read strategy5 scan runs"
on public.strategy5_scan_runs
for select
to anon
using (true);

drop policy if exists "read strategy5 scan results" on public.strategy5_scan_results;
create policy "read strategy5 scan results"
on public.strategy5_scan_results
for select
to anon
using (true);

grant select on public.strategy5_scan_runs to anon;
grant select on public.strategy5_scan_results to anon;
grant select, insert, update, delete on public.strategy5_scan_runs to service_role;
grant select, insert, update, delete on public.strategy5_scan_results to service_role;
grant usage, select on sequence public.strategy5_scan_results_id_seq to service_role;

create or replace view public.v_strategy5_latest_complete_run as
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
from public.strategy5_scan_runs
where strategy = 'strategy5'
  and status = 'complete'
  and complete = true
order by finished_at desc
limit 1;

grant select on public.v_strategy5_latest_complete_run to anon;
grant select on public.v_strategy5_latest_complete_run to service_role;

notify pgrst, 'reload schema';
