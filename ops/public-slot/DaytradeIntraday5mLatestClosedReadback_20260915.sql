begin;

-- Preserve the current consumer contract: this view only exposes the newest
-- v4 run whose receipt has already passed. Within that accepted run, select
-- each symbol's newest fully closed natural regular-session bar. Excluding
-- in-progress buckets prevents them from masking the prior closed bar.
create or replace view public.v_fugle_intraday_5m_readback as
with latest_verified_run as (
  select r.trade_date, r.run_id
  from public.fugle_intraday_5m_verification_receipts r
  where r.complete is true
    and r.status = 'complete'
    and r.exit_code = 0
    and r.contract = 'daytrade_intraday_5m_runner_verifier_receipt_v4'
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
  'Newest regular-session 5m bar that is naturally sourced and fully closed for each symbol, restricted to the newest v4 run with a passed receipt. In-progress and DATA_GAP rows remain available in the versioned history view.';
notify pgrst, 'reload schema';
commit;
