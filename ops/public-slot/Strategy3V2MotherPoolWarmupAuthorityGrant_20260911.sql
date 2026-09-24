-- Strategy3 V2 -> Mother Pool warmup authority read contract.
-- The 06:00 canonical Source Writer reads with the configured Supabase read key,
-- so only the latest-complete authority view and its result rows are exposed.

begin;

grant select on public.v_strategy3_v2_latest_complete_run
  to anon, authenticated, service_role;

grant select on public.strategy3_v2_scan_results
  to anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;
