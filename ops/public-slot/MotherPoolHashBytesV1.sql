BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
ALTER TABLE public.fugle_daytrade_mother_pool_verification_receipts ADD COLUMN IF NOT EXISTS hash_evidence jsonb;
CREATE OR REPLACE VIEW public.v_fugle_daytrade_mother_pool_receipt_v4_1 WITH (security_invoker=true) AS
SELECT verification_run_id,contract_version,trade_date,canonical_run_id,verified_at,complete,mother_pool_rows,failed_checks,first_blocker,
mother_pool_run_id,generation,snapshot_sequence,symbols_sha256,snapshot_sha256,snapshot_readback_sha256,snapshot_readback_verified_at,snapshot_readback_count,receipt_generation_verified,hash_evidence
FROM public.fugle_daytrade_mother_pool_verification_receipts WHERE contract_version='4.1.0';
NOTIFY pgrst,'reload schema';
COMMIT;
