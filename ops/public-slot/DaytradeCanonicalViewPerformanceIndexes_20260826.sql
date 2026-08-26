-- Additive only: indexes support current canonical gate and Mother Pool readbacks.
-- No views, columns, strategy thresholds, or data are modified.
do $$
begin
  if to_regclass('public.source_status') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'source_status' and column_name = 'source_name')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'source_status' and column_name = 'updated_at') then
    execute 'create index if not exists source_status_source_name_updated_at_idx on public.source_status (source_name, updated_at desc)';
  end if;

  if to_regclass('public.fugle_daytrade_quotes_live') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'fugle_daytrade_quotes_live' and column_name = 'symbol')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'fugle_daytrade_quotes_live' and column_name = 'updated_at') then
    execute 'create index if not exists fugle_daytrade_quotes_live_symbol_updated_at_idx on public.fugle_daytrade_quotes_live (symbol, updated_at desc)';
  end if;

  if to_regclass('public.fugle_daytrade_quotes_live') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'fugle_daytrade_quotes_live' and column_name = 'quote_seen_at') then
    execute 'create index if not exists fugle_daytrade_quotes_live_quote_seen_at_idx on public.fugle_daytrade_quotes_live (quote_seen_at desc)';
  end if;

  if to_regclass('public.fugle_daytrade_intraday_1m') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'fugle_daytrade_intraday_1m' and column_name = 'symbol')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'fugle_daytrade_intraday_1m' and column_name = 'candle_time') then
    execute 'create index if not exists fugle_daytrade_intraday_1m_symbol_candle_time_idx on public.fugle_daytrade_intraday_1m (symbol, candle_time desc)';
  end if;

  if to_regclass('public.fugle_daytrade_intraday_1m_status_cache') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'fugle_daytrade_intraday_1m_status_cache' and column_name = 'trade_date')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'fugle_daytrade_intraday_1m_status_cache' and column_name = 'symbol')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'fugle_daytrade_intraday_1m_status_cache' and column_name = 'updated_at') then
    execute 'create index if not exists fugle_daytrade_intraday_1m_status_cache_date_symbol_updated_at_idx on public.fugle_daytrade_intraday_1m_status_cache (trade_date, symbol, updated_at desc)';
  end if;

  if to_regclass('public.fugle_daytrade_futopt_quotes_live') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'fugle_daytrade_futopt_quotes_live' and column_name = 'updated_at') then
    execute 'create index if not exists fugle_daytrade_futopt_quotes_live_updated_at_idx on public.fugle_daytrade_futopt_quotes_live (updated_at desc)';
  end if;
end
$$;
