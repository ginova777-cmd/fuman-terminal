begin;
-- Fixed-run readback. Consumers MUST bind trade_date + run_id from a verified receipt.
-- Unlike the mutable latest cache, another publication cannot replace this run's rows.
create or replace view public.v_fugle_intraday_5m_batch_readback as
select * from (
  select h.*, row_number() over (
    partition by h.run_id,h.trade_date,h.symbol
    order by h.candle_time desc,h.updated_at desc
  ) as batch_latest_rank
  from public.fugle_intraday_5m_history h
) pinned where batch_latest_rank=1;
grant select on public.v_fugle_intraday_5m_batch_readback to anon,authenticated;
comment on view public.v_fugle_intraday_5m_batch_readback is
  'Read-only fixed-run latest row per symbol. Bind trade_date and run_id to complete verified receipt. Quality DATA_GAP retained, not promoted. No latest-generation fallback.';
notify pgrst,'reload schema';
commit;
