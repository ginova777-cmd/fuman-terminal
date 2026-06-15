-- Strategy4 scan result compatibility patch.
-- Safe to run multiple times in Supabase SQL editor.

alter table public.strategy4_scan_results
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
  add column if not exists complete boolean default false,
  add column if not exists quality_status text,
  add column if not exists payload jsonb;

create index if not exists strategy4_scan_results_complete_idx
  on public.strategy4_scan_results (scan_date desc, complete, quality_status);
