create table if not exists public.fugle_daytrade_mother_pool_verification_receipts (
  verification_run_id text primary key,
  contract_version text not null,
  trade_date date not null,
  canonical_run_id text not null,
  verified_at timestamptz not null,
  complete boolean not null,
  mother_pool_rows integer not null,
  failed_checks jsonb not null default '[]'::jsonb,
  first_blocker text
);

create index if not exists fugle_daytrade_mother_pool_receipts_trade_date_idx
  on public.fugle_daytrade_mother_pool_verification_receipts (trade_date desc, verified_at desc);

alter table public.fugle_daytrade_mother_pool_verification_receipts enable row level security;
drop policy if exists mother_pool_receipts_read on public.fugle_daytrade_mother_pool_verification_receipts;
create policy mother_pool_receipts_read on public.fugle_daytrade_mother_pool_verification_receipts
  for select to anon, authenticated using (true);
grant select on public.fugle_daytrade_mother_pool_verification_receipts to anon, authenticated;
grant all on public.fugle_daytrade_mother_pool_verification_receipts to service_role;

create or replace view public.v_fugle_daytrade_mother_pool_receipt_v4_1
with (security_invoker=true) as
select verification_run_id, contract_version, trade_date, canonical_run_id,
       verified_at, complete, mother_pool_rows, failed_checks, first_blocker
from public.fugle_daytrade_mother_pool_verification_receipts
where contract_version = '4.1.0';

grant select on public.v_fugle_daytrade_mother_pool_receipt_v4_1 to anon, authenticated, service_role;
