-- Strategy4 run_id complete gate follow-up.
-- Purpose:
--   Allow multiple Strategy4 scan runs on the same date.
--   The terminal/API should read only the latest complete run_id batch.
--
-- Why this is needed:
--   The run_id gate SQL added run_id support, but the old same-day unique
--   constraint can still block inserts like:
--   duplicate key value violates unique constraint
--   "strategy4_scan_results_strategy_code_date_unique"

alter table public.strategy4_scan_results
  drop constraint if exists strategy4_scan_results_strategy_code_date_unique;

drop index if exists public.strategy4_scan_results_strategy_code_date_unique;
drop index if exists public.strategy4_scan_results_scan_date_strategy_code_uidx;
drop index if exists public.strategy4_scan_results_strategy_code_scan_date_uidx;

create unique index if not exists strategy4_scan_results_run_strategy_code_uidx
  on public.strategy4_scan_results (run_id, strategy, code);

create index if not exists idx_strategy4_scan_results_run_id
  on public.strategy4_scan_results (run_id);

notify pgrst, 'reload schema';
