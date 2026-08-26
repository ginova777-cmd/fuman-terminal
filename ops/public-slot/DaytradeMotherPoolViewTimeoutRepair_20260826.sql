-- Performance-only repair for public.v_fugle_daytrade_mother_pool.
-- The legacy source_status join is unused by the view projection/predicate and multiplies rows.
-- Remove it without changing columns, eligibility rules, or data.
do $$
declare
  definition_sql text;
begin
  select pg_get_viewdef('public.v_fugle_daytrade_mother_pool'::regclass, true)
    into definition_sql;

  definition_sql := regexp_replace(
    definition_sql,
    E'\\s+LEFT JOIN source_status ss ON ss\\.source_name = ''fugle_daytrade_source''::text',
    '',
    'g'
  );

  execute 'create or replace view public.v_fugle_daytrade_mother_pool as ' || definition_sql;

  if to_regclass('public.fugle_daytrade_priority_pool') is not null then
    execute $index$
      create index if not exists fugle_daytrade_priority_pool_base_eligible_rank_idx
      on public.fugle_daytrade_priority_pool (priority_rank, symbol)
      where (payload ->> 'basePoolEligible') = 'true'
    $index$;
  end if;

  if to_regclass('public.fugle_daytrade_intraday_1m') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'fugle_daytrade_intraday_1m' and column_name = 'trade_date') then
    execute 'create index if not exists fugle_daytrade_intraday_1m_trade_date_symbol_candle_time_idx on public.fugle_daytrade_intraday_1m (trade_date, symbol, candle_time desc)';
  end if;
end
$$;
