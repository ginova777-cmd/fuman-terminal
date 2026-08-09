-- Independent daily OHLCV contract for non-daytrade strategy tests.
-- Missing OHLC remains NULL and must fail the completeness verifier.

do $$
begin
  if to_regclass('public.v_stock_daily_ohlcv') is null then
    execute $view$
      create view public.v_stock_daily_ohlcv as
      select
        coalesce(nullif(d.symbol, ''), nullif(d.code, ''))::text as symbol,
        d.market::text as market,
        coalesce(d.trade_date, d.date)::date as trade_date,
        d.open::numeric as open,
        d.high::numeric as high,
        d.low::numeric as low,
        d.close::numeric as close,
        coalesce(d.volume, d.volume_lots, d.volume_shares / 1000.0)::numeric as volume,
        d.updated_at::timestamptz as updated_at
      from public.stock_daily_volume d
      where coalesce(nullif(d.symbol, ''), nullif(d.code, '')) ~ '^[0-9]{4}$'
    $view$;
  else
    raise notice 'public.v_stock_daily_ohlcv already exists; no column mutation attempted';
  end if;
end
$$;

comment on view public.v_stock_daily_ohlcv is
  'Independent read-only daily OHLCV contract. Missing OHLC remains NULL and must fail the completeness verifier.';

grant select on public.v_stock_daily_ohlcv to anon;
grant select on public.v_stock_daily_ohlcv to authenticated;
grant select on public.v_stock_daily_ohlcv to service_role;

do $$
begin
  if to_regclass('public.v_stock_daily_ohlcv_completeness') is null then
    execute $view$
      create view public.v_stock_daily_ohlcv_completeness as
      select
        trade_date,
        count(*)::bigint as rows,
        count(*) filter (
          where open is not null and high is not null and low is not null and close is not null
        )::bigint as ohlc_rows,
        count(distinct symbol) filter (
          where open is not null and high is not null and low is not null and close is not null
        )::bigint as ohlc_symbols
      from public.v_stock_daily_ohlcv
      where trade_date is not null
      group by trade_date
    $view$;
  else
    raise notice 'public.v_stock_daily_ohlcv_completeness already exists; no column mutation attempted';
  end if;
end
$$;

comment on view public.v_stock_daily_ohlcv_completeness is
  'Read-only daily OHLC completeness summary used by the terminal preflight hard gate.';

grant select on public.v_stock_daily_ohlcv_completeness to anon;
grant select on public.v_stock_daily_ohlcv_completeness to authenticated;
grant select on public.v_stock_daily_ohlcv_completeness to service_role;
