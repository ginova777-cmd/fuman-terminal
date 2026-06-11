-- Supabase public slot hardening patch, 2026-06-11.
-- Purpose:
-- 1. Keep Fugle raw tables as raw data only.
-- 2. Keep daily volume history long enough for Strategy4 / swing filters.
-- 3. Make UTC timestamp and lots-volume conventions explicit.
-- 4. Keep common stale/session/index lookups fast.

comment on table public.fugle_quotes_live is
  'Raw Fugle latest quote table. Timestamp columns are timestamptz/UTC. Volume columns are normalized to lots.';

comment on table public.fugle_intraday_1m is
  'Raw/public-slot 1 minute candles. candle_time and updated_at are timestamptz/UTC. volume is lots.';

comment on table public.fugle_daily_volume is
  'Raw daily volume cache for average-volume filters. volume is lots. Retain at least the latest 20 trading days.';

comment on table public.futopt_tickers is
  'Raw TAIFEX/Fugle futures contract master. Keep underlying_symbol/future_symbol mapping here, not in strategy result tables.';

comment on table public.futopt_quotes_live is
  'Raw futures quote table. Includes TXF; add stock futures as shared source coverage expands.';

comment on table public.fugle_preopen_snapshot is
  'Raw preopen/trial-auction snapshot. Data may be stale after preopen; readers must check session/market_calendar/source_status.';

comment on table public.source_status is
  'Shared source health. payload should include symbols, blacklist_count, last_quote_at, last_1m_at, volume_unit, time_standard, session.';

comment on column public.fugle_quotes_live.total_volume is 'Unit: lots.';
comment on column public.fugle_quotes_live.bid_volume is 'Unit: lots.';
comment on column public.fugle_quotes_live.ask_volume is 'Unit: lots.';
comment on column public.fugle_intraday_1m.volume is 'Unit: lots.';
comment on column public.fugle_daily_volume.volume is 'Unit: lots.';
comment on column public.futopt_quotes_live.total_volume is 'Unit: lots.';
comment on column public.fugle_preopen_snapshot.bid_volume is 'Unit: lots.';
comment on column public.fugle_preopen_snapshot.ask_volume is 'Unit: lots.';

create index if not exists idx_fugle_daily_volume_trade_date_symbol
  on public.fugle_daily_volume (trade_date desc, symbol);

create index if not exists idx_market_calendar_session
  on public.market_calendar (trade_date, market, session);

create index if not exists idx_stock_tickers_type_symbol
  on public.stock_tickers (stock_type, is_etf, symbol);

create index if not exists idx_futopt_tickers_underlying_future
  on public.futopt_tickers (underlying_symbol, future_symbol);

create or replace view public.v_fugle_intraday_1m_status as
select
  symbol,
  market,
  max(candle_time) as latest_candle_time,
  count(*) as candle_count,
  (count(*) >= 35) as ready_ge_35,
  (count(*) >= 80) as ready_ge_80,
  (count(*) >= 200) as ready_ge_200,
  bool_or(trade_date = current_date) as has_today_data,
  max(updated_at) as updated_at
from public.fugle_intraday_1m
group by symbol, market;

create or replace view public.v_fugle_intraday_1m_latest_200 as
select
  symbol,
  market,
  trade_date,
  candle_time,
  open,
  high,
  low,
  close,
  volume,
  updated_at,
  payload
from (
  select
    m.*,
    row_number() over (
      partition by m.symbol
      order by m.candle_time desc
    ) as rn
  from public.fugle_intraday_1m m
) ranked
where rn <= 200;

grant select on public.v_fugle_intraday_1m_status to anon;
grant select on public.v_fugle_intraday_1m_latest_200 to anon;

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

-- Manual maintenance examples:
-- select public.cleanup_fugle_daily_volume(20);
-- select public.cleanup_fugle_intraday_1m(5);
