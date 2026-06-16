-- Strategy4 scan results schema fix, 2026-06-16.
-- Safe to run more than once. Does not drop existing data.

create table if not exists public.strategy4_scan_results (
  scan_date date not null,
  strategy text not null default 'strategy4',
  code text not null,
  name text,
  scan_time timestamptz,
  updated_at timestamptz not null default now(),
  primary key (scan_date, strategy, code)
);

alter table public.strategy4_scan_results
  add column if not exists scan_date date,
  add column if not exists scan_time timestamptz,
  add column if not exists strategy text default 'strategy4',
  add column if not exists code text,
  add column if not exists name text,
  add column if not exists market text,
  add column if not exists price numeric,
  add column if not exists change_percent numeric,
  add column if not exists volume numeric,
  add column if not exists trade_value numeric,
  add column if not exists score numeric,
  add column if not exists zone text,
  add column if not exists zone_label text,
  add column if not exists rank integer,
  add column if not exists reason text,
  add column if not exists source text,
  add column if not exists price_source text,
  add column if not exists scan_stamp text,
  add column if not exists run_mode text,
  add column if not exists complete boolean,
  add column if not exists quality_status text,
  add column if not exists schema_version text,
  add column if not exists volume_unit text,
  add column if not exists data_contract_source text,
  add column if not exists generated_at timestamptz,
  add column if not exists updated_at timestamptz default now(),
  add column if not exists signals jsonb default '[]'::jsonb,
  add column if not exists has_wallet_strong_buy boolean default false,
  add column if not exists has_wallet_volume_cross boolean default false,
  add column if not exists payload jsonb default '{}'::jsonb;

update public.strategy4_scan_results
set
  strategy = coalesce(strategy, 'strategy4'),
  updated_at = coalesce(updated_at, now()),
  generated_at = coalesce(generated_at, scan_time, updated_at, now()),
  volume_unit = coalesce(volume_unit, 'lots'),
  schema_version = coalesce(schema_version, 'strategy4-cache-v3-unit-contract')
where
  strategy is null
  or updated_at is null
  or generated_at is null
  or volume_unit is null
  or schema_version is null;

delete from public.strategy4_scan_results a
using public.strategy4_scan_results b
where a.ctid < b.ctid
  and a.scan_date = b.scan_date
  and a.strategy = b.strategy
  and a.code = b.code;

create unique index if not exists strategy4_scan_results_scan_date_strategy_code_uidx
  on public.strategy4_scan_results (scan_date, strategy, code);

create index if not exists idx_strategy4_scan_results_scan_time
  on public.strategy4_scan_results (scan_time desc);

create index if not exists idx_strategy4_scan_results_quality_status
  on public.strategy4_scan_results (quality_status);

alter table public.strategy4_scan_results enable row level security;

drop policy if exists "read strategy4 scan results" on public.strategy4_scan_results;
create policy "read strategy4 scan results"
on public.strategy4_scan_results
for select
to anon
using (true);

grant select on public.strategy4_scan_results to anon;
grant select, insert, update, delete on public.strategy4_scan_results to service_role;

notify pgrst, 'reload schema';
