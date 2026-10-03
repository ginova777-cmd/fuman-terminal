-- Additive receipt identity. Existing receipts remain unverified.
-- Producer and consumer changes must be released together with this schema.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '15s';
alter table public.fugle_daytrade_mother_pool_verification_receipts
  add column if not exists mother_pool_run_id text,
  add column if not exists generation text,
  add column if not exists snapshot_sequence integer,
  add column if not exists symbols_sha256 text,
  add column if not exists snapshot_sha256 text,
  add column if not exists snapshot_readback_sha256 text,
  add column if not exists snapshot_readback_verified_at timestamptz,
  add column if not exists snapshot_readback_count integer,
  add column if not exists receipt_generation_verified boolean;

create or replace view public.v_fugle_daytrade_mother_pool_receipt_v4_1
with (security_invoker=true) as
select verification_run_id, contract_version, trade_date, canonical_run_id,
       verified_at, complete, mother_pool_rows, failed_checks, first_blocker,
       mother_pool_run_id, generation, snapshot_sequence, symbols_sha256,
       snapshot_sha256, snapshot_readback_sha256,
       snapshot_readback_verified_at, snapshot_readback_count,
       receipt_generation_verified
from public.fugle_daytrade_mother_pool_verification_receipts
where contract_version = '4.1.0';
notify pgrst, 'reload schema';
commit;
