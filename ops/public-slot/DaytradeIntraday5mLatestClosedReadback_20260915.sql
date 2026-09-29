begin;

-- Preserve the current consumer contract: this view only exposes the newest
-- v4 run whose receipt passed the current exact 90% effective-coverage rule.
-- Older v4 receipts created under the former 70% policy remain in history but
-- cannot become the current latest view. Within the accepted run, select each
-- symbol's newest fully closed natural regular-session bar.
create or replace view public.v_fugle_intraday_5m_readback as
with latest_verified_run as (
  select r.trade_date, r.run_id
  from public.fugle_intraday_5m_verification_receipts r
  where r.complete is true
    and r.status = 'complete'
    and r.exit_code = 0
    and r.contract = 'daytrade_intraday_5m_runner_verifier_receipt_v4'
    and coalesce((r.diagnostic_summary->'latest_view_quality'->>'effective_threshold')::numeric, 0) >= 0.9
    and coalesce((r.diagnostic_summary->'latest_view_quality'->>'effective_count')::integer, 0) > 0
    and coalesce((r.diagnostic_summary->'latest_view_quality'->>'total')::integer, 0) > 0
    and coalesce((r.diagnostic_summary->'latest_view_quality'->>'effective_count')::integer, 0) * 10
        >= coalesce((r.diagnostic_summary->'latest_view_quality'->>'total')::integer, 0) * 9
    and coalesce((r.diagnostic_summary->'latest_view_quality'->>'meets_effective_coverage')::boolean, false) is true
  order by r.trade_date desc, r.verified_at desc, r.run_id desc
  limit 1
)
select *
from (
  select h.*,
         row_number() over (
           partition by h.trade_date, h.symbol
           order by h.candle_time desc, h.updated_at desc
         ) as latest_rank
  from public.fugle_intraday_5m_history h
  join latest_verified_run r
    on r.trade_date = h.trade_date
   and r.run_id = h.run_id
  where h.bar_kind = 'regular_session'
    and h.bar_complete is true
    and h.bar_count = 5
) accepted_complete_bars
where latest_rank = 1;

grant select on public.v_fugle_intraday_5m_readback to anon, authenticated, service_role;
comment on view public.v_fugle_intraday_5m_readback is
  'Newest regular-session 5m bar naturally sourced and fully closed for each symbol, restricted to newest v4 receipt meeting exact >=90% effective coverage. Legacy 70% receipts remain in history but are not exposed as current latest. In-progress and DATA_GAP rows remain available in versioned history.';
notify pgrst, 'reload schema';
commit;
