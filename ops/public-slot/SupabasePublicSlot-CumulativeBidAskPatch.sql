-- Supabase public slot cumulative bid/ask volume patch, 2026-06-11.
-- Run once in Supabase SQL Editor before restarting Run-PublicSlotSharedSource.ps1.
--
-- Important definition:
-- fugle_quotes_live.bid_volume / ask_volume currently come from Fugle websocket
-- best bid/ask level size (bids[0].size / asks[0].size), not confirmed cumulative
-- intraday bid-side / ask-side traded volume.
--
-- Strategy-side intraday liquidity filters should use:
-- cumulative_bid_ask_volume >= 3000
-- only when cumulative_bid_ask_volume is not null.

alter table public.fugle_quotes_live
  add column if not exists cumulative_bid_volume numeric;

alter table public.fugle_quotes_live
  add column if not exists cumulative_ask_volume numeric;

alter table public.fugle_quotes_live
  add column if not exists cumulative_bid_ask_volume numeric;

comment on column public.fugle_quotes_live.bid_volume is
  'Unit: lots. Current shared source maps this from Fugle websocket best bid level size, not confirmed cumulative intraday bid-side traded volume.';

comment on column public.fugle_quotes_live.ask_volume is
  'Unit: lots. Current shared source maps this from Fugle websocket best ask level size, not confirmed cumulative intraday ask-side traded volume.';

comment on column public.fugle_quotes_live.cumulative_bid_volume is
  'Unit: lots. Confirmed cumulative intraday bid-side traded volume when source provides it; null when unavailable.';

comment on column public.fugle_quotes_live.cumulative_ask_volume is
  'Unit: lots. Confirmed cumulative intraday ask-side traded volume when source provides it; null when unavailable.';

comment on column public.fugle_quotes_live.cumulative_bid_ask_volume is
  'Unit: lots. cumulative_bid_volume + cumulative_ask_volume. Strategy liquidity filter should use this only when not null.';

drop view if exists public.v_fugle_quotes_commonstock_active;

create or replace view public.v_fugle_quotes_commonstock_active as
select
  symbol,
  name,
  market,
  stock_type,
  session,
  updated_at,
  last_trade_time,
  price,
  open_price,
  high_price,
  low_price,
  previous_close,
  change_percent,
  total_volume,
  trade_value,
  bid_volume,
  ask_volume,
  ask_bid_ratio,
  ask_ratio,
  cumulative_bid_volume,
  cumulative_ask_volume,
  cumulative_bid_ask_volume,
  is_halted,
  is_trial,
  payload
from public.fugle_quotes_live
where coalesce(stock_type, 'COMMONSTOCK') = 'COMMONSTOCK'
  and coalesce(is_halted, false) = false
  and coalesce(is_trial, false) = false
  and market in ('TSE', 'OTC')
  and symbol ~ '^[0-9]{4}$'
  and symbol not like '00%'
  and upper(symbol) <> 'TEST'
  and price between 10 and 1000;

grant select on public.v_fugle_quotes_commonstock_active to anon;
