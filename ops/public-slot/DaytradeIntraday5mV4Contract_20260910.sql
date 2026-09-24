begin;

alter table public.fugle_intraday_5m_signal_cache
  add column if not exists classification_contract text not null default 'daytrade_intraday_5m_branch_independent_strict_wait_v1',
  add column if not exists macd_fast_period integer not null default 3,
  add column if not exists macd_slow_period integer not null default 9,
  add column if not exists macd_signal_period integer not null default 3,
  add column if not exists macd_3_9_3_dif_5m numeric,
  add column if not exists macd_3_9_3_dea_5m numeric,
  add column if not exists macd_3_9_3_histogram_5m numeric,
  add column if not exists previous_macd_3_9_3_dif_5m numeric,
  add column if not exists previous_macd_3_9_3_dea_5m numeric,
  add column if not exists macd_3_9_3_golden_cross_5m boolean,
  add column if not exists macd_3_9_3_zero_cross_up_5m boolean;

alter table public.fugle_intraday_5m_history
  add column if not exists classification_contract text not null default 'daytrade_intraday_5m_branch_independent_strict_wait_v1',
  add column if not exists macd_fast_period integer not null default 3,
  add column if not exists macd_slow_period integer not null default 9,
  add column if not exists macd_signal_period integer not null default 3,
  add column if not exists macd_3_9_3_dif_5m numeric,
  add column if not exists macd_3_9_3_dea_5m numeric,
  add column if not exists macd_3_9_3_histogram_5m numeric,
  add column if not exists previous_macd_3_9_3_dif_5m numeric,
  add column if not exists previous_macd_3_9_3_dea_5m numeric,
  add column if not exists macd_3_9_3_golden_cross_5m boolean,
  add column if not exists macd_3_9_3_zero_cross_up_5m boolean;

alter table public.fugle_intraday_5m_verification_receipts
  add column if not exists classification_contract text not null default 'daytrade_intraday_5m_branch_independent_strict_wait_v1',
  add column if not exists macd_parameters jsonb not null default '{"fast":3,"slow":9,"signal":3,"histogram":"dif_minus_dea"}'::jsonb,
  add column if not exists failed_checks text[] not null default '{}';

drop view if exists public.v_fugle_intraday_5m_readback;
create view public.v_fugle_intraday_5m_readback as
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
select * from (
  select h.*,
         row_number() over(
           partition by h.trade_date,h.symbol
           order by h.candle_time desc,h.updated_at desc
         ) as latest_rank
  from public.fugle_intraday_5m_history h
  join latest_verified_run r
    on r.trade_date = h.trade_date
   and r.run_id = h.run_id
) x where latest_rank=1;

drop view if exists public.v_fugle_intraday_5m_history_readback;
create view public.v_fugle_intraday_5m_history_readback as
select * from public.fugle_intraday_5m_history;

drop view if exists public.v_fugle_intraday_5m_verification_readback;
create view public.v_fugle_intraday_5m_verification_readback as
select contract,strategy_version,calculation_version,classification_contract,run_id,trade_date,
       status,complete,exit_code,first_blocker,failed_checks,anon_http_status,ssl_ok,verified_at,
       latest_complete_bar_end,requested_symbols,written_symbols,missing_symbols,readback_rows,
       writer_update_frequency,history_readback_rows,diagnostic_summary,macd_parameters
from public.fugle_intraday_5m_verification_receipts;

grant select on public.v_fugle_intraday_5m_readback,
  public.v_fugle_intraday_5m_history_readback,
  public.v_fugle_intraday_5m_verification_readback to anon,authenticated,service_role;
revoke insert,update,delete on public.fugle_intraday_5m_signal_cache,
  public.fugle_intraday_5m_history,
  public.fugle_intraday_5m_verification_receipts from anon,authenticated;
grant select,insert,update,delete on public.fugle_intraday_5m_signal_cache,
  public.fugle_intraday_5m_history,
  public.fugle_intraday_5m_verification_receipts to service_role;

comment on column public.fugle_intraday_5m_signal_cache.macd_3_9_3_histogram_5m is
  'MACD(3,9,3) histogram = DIF - DEA. DIF zero crossing is diagnostic only and never substitutes for a DIF/DEA golden cross.';
comment on column public.fugle_intraday_5m_history.macd_3_9_3_histogram_5m is
  'Immutable per-run calculation evidence. Historical rows are append-only by run_id and are not rewritten by later verification.';

comment on view public.v_fugle_intraday_5m_readback is
  'Latest symbol row from the newest successfully verified v4 batch. Unverified writer runs cannot replace the anon formal readback batch.';

notify pgrst,'reload schema';
commit;
