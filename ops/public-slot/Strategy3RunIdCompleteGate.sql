-- Strategy3 run_id complete gate, 2026-06-16.
--
-- Purpose:
--   Give Strategy3 the same stable publish pattern as Strategy4:
--   - one run_id represents one complete scan batch
--   - readers trust only the latest complete run
--   - partial/running batches are not shown as official latest signals

create table if not exists public.strategy3_scan_runs (
  run_id text primary key,
  strategy text not null default 'strategy3',
  scan_date date not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',
  expected_total integer not null default 0,
  scanned_count integer not null default 0,
  result_count integer not null default 0,
  error_count integer not null default 0,
  complete boolean not null default false,
  quality_status text,
  source text,
  generated_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb
);

create table if not exists public.strategy3_scan_results (
  id bigserial primary key,
  run_id text not null references public.strategy3_scan_runs(run_id) on delete cascade,
  strategy text not null default 'strategy3',
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
  generated_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.strategy3_scan_runs
  add column if not exists expected_total integer not null default 0,
  add column if not exists scanned_count integer not null default 0,
  add column if not exists result_count integer not null default 0,
  add column if not exists error_count integer not null default 0,
  add column if not exists complete boolean not null default false,
  add column if not exists quality_status text,
  add column if not exists source text,
  add column if not exists generated_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists payload jsonb not null default '{}'::jsonb;

alter table public.strategy3_scan_results
  add column if not exists run_id text,
  add column if not exists strategy text not null default 'strategy3',
  add column if not exists scan_date date,
  add column if not exists code text,
  add column if not exists name text,
  add column if not exists price numeric,
  add column if not exists close numeric,
  add column if not exists change_percent numeric,
  add column if not exists volume numeric,
  add column if not exists trade_volume numeric,
  add column if not exists trade_value numeric,
  add column if not exists score numeric,
  add column if not exists rank integer,
  add column if not exists reason text,
  add column if not exists signals jsonb not null default '[]'::jsonb,
  add column if not exists payload jsonb not null default '{}'::jsonb,
  add column if not exists complete boolean not null default false,
  add column if not exists quality_status text,
  add column if not exists generated_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists strategy3_scan_results_run_strategy_code_uidx
  on public.strategy3_scan_results (run_id, strategy, code);

create index if not exists idx_strategy3_scan_results_run_id
  on public.strategy3_scan_results (run_id);

create index if not exists idx_strategy3_scan_runs_strategy_status_finished
  on public.strategy3_scan_runs (strategy, status, finished_at desc);

alter table public.strategy3_scan_runs enable row level security;
alter table public.strategy3_scan_results enable row level security;

drop policy if exists "read strategy3 scan runs" on public.strategy3_scan_runs;
create policy "read strategy3 scan runs"
on public.strategy3_scan_runs
for select
to anon
using (true);

drop policy if exists "read strategy3 scan results" on public.strategy3_scan_results;
create policy "read strategy3 scan results"
on public.strategy3_scan_results
for select
to anon
using (true);

grant select on public.strategy3_scan_runs to anon;
grant select on public.strategy3_scan_results to anon;
grant select, insert, update, delete on public.strategy3_scan_runs to service_role;
grant select, insert, update, delete on public.strategy3_scan_results to service_role;
grant usage, select on sequence public.strategy3_scan_results_id_seq to service_role;

create or replace view public.v_strategy3_latest_complete_run as
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
  error_count,
  complete,
  quality_status,
  source,
  generated_at,
  updated_at,
  payload
from public.strategy3_scan_runs
where strategy = 'strategy3'
  and status = 'complete'
  and complete = true
order by finished_at desc
limit 1;

grant select on public.v_strategy3_latest_complete_run to anon;
grant select on public.v_strategy3_latest_complete_run to service_role;

notify pgrst, 'reload schema';
