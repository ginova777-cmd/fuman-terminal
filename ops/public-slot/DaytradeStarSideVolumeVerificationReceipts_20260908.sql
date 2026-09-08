begin;

create table if not exists public.fugle_daytrade_star_verification_receipts (
  verification_run_id text primary key,
  contract text not null,
  contract_version text not null,
  trade_date date not null,
  canonical_run_id text not null,
  status text not null check (status in ('complete','failed','pending')),
  complete boolean not null,
  exit_code integer not null,
  verified_at timestamptz not null,
  failed_checks text[] not null default '{}',
  first_blocker text,
  universe_count integer not null default 0,
  evaluated_count integer not null default 0,
  pass_count integer not null default 0,
  no_match_count integer not null default 0,
  data_gap_count integer not null default 0,
  missing_symbols text[] not null default '{}',
  duplicate_underlying_count integer not null default 0,
  page_count integer not null default 0,
  read_rows integer not null default 0,
  source_identity jsonb not null default '{}'::jsonb,
  diagnostic_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists fugle_daytrade_star_receipts_trade_batch
  on public.fugle_daytrade_star_verification_receipts(trade_date desc, canonical_run_id, verified_at desc);

create or replace view public.v_fugle_daytrade_star_verification_readback as
select verification_run_id,contract,contract_version,trade_date,canonical_run_id,
       status,complete,exit_code,verified_at,failed_checks,first_blocker,
       universe_count,evaluated_count,pass_count,no_match_count,data_gap_count,
       missing_symbols,duplicate_underlying_count,page_count,read_rows,
       source_identity,diagnostic_summary
from public.fugle_daytrade_star_verification_receipts;

create table if not exists public.fugle_daytrade_side_volume_verification_receipts (
  verification_run_id text primary key,
  contract text not null,
  contract_version text not null,
  trade_date date not null,
  canonical_run_id text not null,
  status text not null check (status in ('complete','failed','pending')),
  complete boolean not null,
  exit_code integer not null,
  verified_at timestamptz not null,
  failed_checks text[] not null default '{}',
  first_blocker text,
  source_view text not null,
  read_rows integer not null default 0,
  contract_complete_rows integer not null default 0,
  missing_field_rows integer not null default 0,
  wrong_trade_date_rows integer not null default 0,
  wrong_run_rows integer not null default 0,
  stale_rows integer not null default 0,
  threshold_met_rows integer not null default 0,
  source_identity jsonb not null default '{}'::jsonb,
  diagnostic_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.fugle_daytrade_side_volume_verification_receipts
  drop constraint if exists fugle_daytrade_side_volume_verification_receipts_status_check;
alter table public.fugle_daytrade_side_volume_verification_receipts
  add constraint fugle_daytrade_side_volume_verification_receipts_status_check
  check (status in ('complete','partial','failed','pending'));
alter table public.fugle_daytrade_side_volume_verification_receipts
  add column if not exists source_common_valid boolean not null default false;
alter table public.fugle_daytrade_side_volume_verification_receipts
  add column if not exists data_gap_rows integer not null default 0;

create table if not exists public.fugle_daytrade_side_volume_symbol_results (
  verification_run_id text not null references public.fugle_daytrade_side_volume_verification_receipts(verification_run_id) on delete cascade,
  contract text not null,
  contract_version text not null,
  trade_date date not null,
  canonical_run_id text not null,
  symbol text not null,
  name text,
  in_mother_pool boolean not null default true,
  source_resource text not null,
  source_common_valid boolean not null,
  quality_ok boolean not null,
  quality_status text not null check (quality_status in ('READY','DATA_GAP','BLOCKED_COMMON')),
  first_blocker text,
  failed_checks text[] not null default '{}',
  inside_volume numeric,
  outside_volume numeric,
  side_volume_total numeric,
  side_volume_unit text,
  side_volume_available boolean not null default false,
  side_volume_threshold_lots integer not null default 2000,
  side_volume_ge_2000_lots boolean not null default false,
  side_volume_source text,
  side_volume_source_event_at timestamptz,
  side_volume_trade_date date,
  side_volume_canonical_run_id text,
  total_matches_inside_plus_outside boolean not null default false,
  verified_at timestamptz not null,
  primary key (verification_run_id,symbol)
);

create index if not exists fugle_daytrade_side_volume_receipts_trade_batch
  on public.fugle_daytrade_side_volume_verification_receipts(trade_date desc, canonical_run_id, verified_at desc);
create index if not exists fugle_daytrade_side_volume_symbol_lookup
  on public.fugle_daytrade_side_volume_symbol_results(trade_date desc,canonical_run_id,symbol,verified_at desc);

create or replace view public.v_fugle_daytrade_side_volume_verification_readback as
select verification_run_id,contract,contract_version,trade_date,canonical_run_id,
       status,complete,exit_code,verified_at,failed_checks,first_blocker,
       source_view,read_rows,contract_complete_rows,missing_field_rows,
       wrong_trade_date_rows,wrong_run_rows,stale_rows,threshold_met_rows,
       source_identity,diagnostic_summary,source_common_valid,data_gap_rows
from public.fugle_daytrade_side_volume_verification_receipts;

create or replace view public.v_fugle_daytrade_side_volume_symbol_readback as
select verification_run_id,contract,contract_version,trade_date,canonical_run_id,
       symbol,name,in_mother_pool,source_resource,source_common_valid,
       quality_ok,quality_status,first_blocker,failed_checks,
       inside_volume,outside_volume,side_volume_total,side_volume_unit,
       side_volume_available,side_volume_threshold_lots,side_volume_ge_2000_lots,
       side_volume_source,side_volume_source_event_at,side_volume_trade_date,
       side_volume_canonical_run_id,total_matches_inside_plus_outside,verified_at
from public.fugle_daytrade_side_volume_symbol_results;

alter table public.fugle_daytrade_star_verification_receipts enable row level security;
alter table public.fugle_daytrade_side_volume_verification_receipts enable row level security;
alter table public.fugle_daytrade_side_volume_symbol_results enable row level security;
revoke insert,update,delete on public.fugle_daytrade_star_verification_receipts from anon,authenticated;
revoke insert,update,delete on public.fugle_daytrade_side_volume_verification_receipts from anon,authenticated;
revoke insert,update,delete on public.fugle_daytrade_side_volume_symbol_results from anon,authenticated;
grant select,insert,update,delete on public.fugle_daytrade_star_verification_receipts to service_role;
grant select,insert,update,delete on public.fugle_daytrade_side_volume_verification_receipts to service_role;
grant select,insert,update,delete on public.fugle_daytrade_side_volume_symbol_results to service_role;
grant select on public.v_fugle_daytrade_star_verification_readback to anon,authenticated,service_role;
grant select on public.v_fugle_daytrade_side_volume_verification_readback to anon,authenticated,service_role;
grant select on public.v_fugle_daytrade_side_volume_symbol_readback to anon,authenticated,service_role;

comment on view public.v_fugle_daytrade_star_verification_readback is 'Canonical cross-computer STAR receipts. Select one immutable verification_run_id by trade_date/canonical_run_id; bind evidence to that receipt and never mix batches.';
comment on view public.v_fugle_daytrade_side_volume_verification_readback is 'Canonical cross-computer side-volume v3 receipts. A partial receipt preserves READY symbol rows while isolating DATA_GAP; common source failure blocks the batch.';
comment on view public.v_fugle_daytrade_side_volume_symbol_readback is 'Immutable per-symbol side-volume result bound to verification_run_id. Viewer may use READY rows only when source_common_valid=true.';

notify pgrst,'reload schema';
commit;
