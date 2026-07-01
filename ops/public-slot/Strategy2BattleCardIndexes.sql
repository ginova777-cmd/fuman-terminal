set statement_timeout = '10min';
set lock_timeout = '30s';

create index concurrently if not exists strategy2_scan_results_card_run_idx
  on public.strategy2_scan_results (run_id, row_kind, score desc, scan_time desc)
  where strategy = 'strategy2' and complete is true;

create index concurrently if not exists strategy2_scan_runs_run_lookup_idx
  on public.strategy2_scan_runs (run_id)
  where strategy = 'strategy2';

analyze public.strategy2_scan_results;
analyze public.strategy2_scan_runs;
