begin;
-- Additive repair: preserve existing view columns and row selection.
alter table public.fugle_intraday_5m_verification_receipts
  add column if not exists classification_contract text,
  add column if not exists macd_parameters jsonb;
do $repair$
declare definition text; extras text := '';
begin
  definition := regexp_replace(pg_get_viewdef('public.v_fugle_intraday_5m_verification_readback'::regclass, true), ';\s*$', '');
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='v_fugle_intraday_5m_verification_readback' and column_name='classification_contract') then
    extras := extras || ', source.classification_contract';
  end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='v_fugle_intraday_5m_verification_readback' and column_name='macd_parameters') then
    extras := extras || ', source.macd_parameters';
  end if;
  if extras <> '' then
    execute 'create or replace view public.v_fugle_intraday_5m_verification_readback as select old.*' || extras ||
      ' from (' || definition || ') old join public.fugle_intraday_5m_verification_receipts source on source.run_id=old.run_id and source.trade_date=old.trade_date';
  end if;
end $repair$;
grant select on public.v_fugle_intraday_5m_verification_readback to anon, authenticated;
notify pgrst, 'reload schema';
commit;
