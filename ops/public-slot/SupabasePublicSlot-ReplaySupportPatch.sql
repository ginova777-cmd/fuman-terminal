-- Supabase public slot replay support patch, 2026-06-11.
-- Purpose:
-- 1. Preserve intraday preopen snapshot history for STAR / preopen replay.
-- 2. Provide an RPC for strategy readers to fetch latest N 1m candles per symbol.
-- 3. Avoid the REST 1000-row default/limit problem when reading all symbols.

create table if not exists public.fugle_preopen_snapshot_history (
  symbol text not null,
  observed_at timestamptz not null,
  name text,
  market text,
  session text,
  trade_date date,
  reference_price numeric,
  trial_price numeric,
  is_trial boolean default false,
  is_limit_up_bid boolean default false,
  best_bid_price numeric,
  best_ask_price numeric,
  bid_volume numeric,
  ask_volume numeric,
  bid1_price numeric,
  bid1_volume numeric,
  bid2_price numeric,
  bid2_volume numeric,
  bid3_price numeric,
  bid3_volume numeric,
  bid4_price numeric,
  bid4_volume numeric,
  bid5_price numeric,
  bid5_volume numeric,
  ask1_price numeric,
  ask1_volume numeric,
  ask2_price numeric,
  ask2_volume numeric,
  ask3_price numeric,
  ask3_volume numeric,
  ask4_price numeric,
  ask4_volume numeric,
  ask5_price numeric,
  ask5_volume numeric,
  bid_levels_json jsonb default '[]'::jsonb,
  ask_levels_json jsonb default '[]'::jsonb,
  payload jsonb default '{}'::jsonb,
  primary key (symbol, observed_at)
);

alter table public.fugle_preopen_snapshot_history enable row level security;

grant select on public.fugle_preopen_snapshot_history to anon;
grant select, insert, update, delete on public.fugle_preopen_snapshot_history to service_role;

drop policy if exists "read fugle preopen snapshot history" on public.fugle_preopen_snapshot_history;
create policy "read fugle preopen snapshot history"
on public.fugle_preopen_snapshot_history
for select
to anon
using (true);

create index if not exists idx_fugle_preopen_snapshot_history_symbol_time
  on public.fugle_preopen_snapshot_history (symbol, observed_at desc);

create index if not exists idx_fugle_preopen_snapshot_history_trade_session
  on public.fugle_preopen_snapshot_history (trade_date, session, observed_at desc);

create or replace function public.get_fugle_intraday_1m_latest_n(
  symbols text[],
  bars_per_symbol integer default 200
)
returns table (
  symbol text,
  market text,
  trade_date date,
  candle_time timestamptz,
  open numeric,
  high numeric,
  low numeric,
  close numeric,
  volume numeric,
  updated_at timestamptz,
  payload jsonb
)
language sql
stable
as $$
  select
    ranked.symbol,
    ranked.market,
    ranked.trade_date,
    ranked.candle_time,
    ranked.open,
    ranked.high,
    ranked.low,
    ranked.close,
    ranked.volume,
    ranked.updated_at,
    ranked.payload
  from (
    select
      m.*,
      row_number() over (
        partition by m.symbol
        order by m.candle_time desc
      ) as rn
    from public.fugle_intraday_1m m
    where m.symbol = any(symbols)
  ) ranked
  where ranked.rn <= greatest(1, least(coalesce(bars_per_symbol, 200), 500))
  order by ranked.symbol asc, ranked.candle_time desc;
$$;

grant execute on function public.get_fugle_intraday_1m_latest_n(text[], integer) to anon;
grant execute on function public.get_fugle_intraday_1m_latest_n(text[], integer) to service_role;
