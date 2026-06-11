create or replace function public.cleanup_fugle_intraday_1m(retain_trade_days integer default 5)
returns integer
language plpgsql
security definer
as $$
declare
  deleted_count integer := 0;
begin
  with retained_dates as (
    select distinct trade_date
    from public.fugle_intraday_1m
    where trade_date is not null
    order by trade_date desc
    limit retain_trade_days
  ),
  ranked as (
    select
      symbol,
      candle_time,
      trade_date,
      row_number() over (partition by symbol order by candle_time desc) as rn
    from public.fugle_intraday_1m
  ),
  delete_targets as (
    select r.symbol, r.candle_time
    from ranked r
    where
      r.rn > 200
      and (
        r.trade_date is null
        or r.trade_date not in (select trade_date from retained_dates)
      )
  )
  delete from public.fugle_intraday_1m t
  using delete_targets d
  where t.symbol = d.symbol
    and t.candle_time = d.candle_time;

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

grant execute on function public.cleanup_fugle_intraday_1m(integer) to service_role;

create or replace function public.cleanup_fugle_daily_volume(retain_trade_days integer default 20)
returns integer
language plpgsql
security definer
as $$
declare
  deleted_count integer := 0;
begin
  with retained_dates as (
    select distinct trade_date
    from public.fugle_daily_volume
    where trade_date is not null
    order by trade_date desc
    limit greatest(retain_trade_days, 5)
  ),
  delete_targets as (
    select symbol, trade_date
    from public.fugle_daily_volume
    where trade_date is null
       or trade_date not in (select trade_date from retained_dates)
  )
  delete from public.fugle_daily_volume t
  using delete_targets d
  where t.symbol = d.symbol
    and (
      t.trade_date = d.trade_date
      or (t.trade_date is null and d.trade_date is null)
    );

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

grant execute on function public.cleanup_fugle_daily_volume(integer) to service_role;

-- Run manually from SQL Editor or shared source maintenance:
-- select public.cleanup_fugle_intraday_1m(5);
-- select public.cleanup_fugle_daily_volume(20);
