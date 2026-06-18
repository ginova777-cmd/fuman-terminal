-- Strategy2 intraday ready cache table + fast paged RPC, 2026-06-16.
-- This solves PostgREST statement timeouts for full scans by reading a small,
-- pre-joined cache table instead of joining live views on every request.

create table if not exists public.strategy2_intraday_ready_cache (
  symbol text primary key,
  name text,
  market text,
  price numeric,
  previous_close numeric,
  change_percent numeric,
  total_volume numeric,
  trade_value numeric,
  open_price numeric,
  high_price numeric,
  low_price numeric,
  avg_5d_volume numeric,
  today_candle_count integer,
  latest_candle_time timestamptz,
  ready_ge_35 boolean,
  is_active boolean,
  is_etf boolean,
  is_warrant boolean,
  is_cb boolean,
  is_blacklisted boolean,
  is_daytrade_unsuitable boolean,
  session text,
  is_halted boolean,
  is_trial boolean,
  quote_updated_at timestamptz,
  avg_20d_volume numeric,
  avg_5d_days integer,
  avg_20d_days integer,
  intraday_1m_status_updated_at timestamptz,
  refreshed_at timestamptz not null default now()
);

create index if not exists idx_strategy2_intraday_ready_cache_symbol
  on public.strategy2_intraday_ready_cache (symbol);

create index if not exists idx_strategy2_intraday_ready_cache_quote_updated
  on public.strategy2_intraday_ready_cache (quote_updated_at desc);

create index if not exists idx_strategy2_intraday_ready_cache_ready35
  on public.strategy2_intraday_ready_cache (ready_ge_35);

alter table public.strategy2_intraday_ready_cache enable row level security;

drop policy if exists "read strategy2 intraday ready cache" on public.strategy2_intraday_ready_cache;
create policy "read strategy2 intraday ready cache"
on public.strategy2_intraday_ready_cache
for select
to anon
using (true);

grant select on public.strategy2_intraday_ready_cache to anon;
grant select, insert, update, delete on public.strategy2_intraday_ready_cache to service_role;

create or replace function public.refresh_strategy2_intraday_ready_cache()
returns integer
language plpgsql
security definer
as $$
declare
  v_count integer;
begin
  insert into public.strategy2_intraday_ready_cache (
    symbol,
    name,
    market,
    price,
    previous_close,
    change_percent,
    total_volume,
    trade_value,
    open_price,
    high_price,
    low_price,
    avg_5d_volume,
    today_candle_count,
    latest_candle_time,
    ready_ge_35,
    is_active,
    is_etf,
    is_warrant,
    is_cb,
    is_blacklisted,
    is_daytrade_unsuitable,
    session,
    is_halted,
    is_trial,
    quote_updated_at,
    avg_20d_volume,
    avg_5d_days,
    avg_20d_days,
    intraday_1m_status_updated_at,
    refreshed_at
  )
  select
    q.symbol,
    coalesce(q.name, u.name) as name,
    case
      when coalesce(q.market, u.market) = 'TSE' then 'TWSE'
      when coalesce(q.market, u.market) = 'OTC' then 'TPEX'
      else coalesce(q.market, u.market)
    end as market,
    q.price,
    q.previous_close,
    q.change_percent,
    q.total_volume,
    q.trade_value,
    q.open_price,
    q.high_price,
    q.low_price,
    coalesce(d.avg_5d_volume, 0) as avg_5d_volume,
    coalesce(s.today_candle_count, s.candle_count, 0)::integer as today_candle_count,
    s.latest_candle_time,
    coalesce(s.ready_ge_35, false) as ready_ge_35,
    coalesce(u.is_active, false) as is_active,
    coalesce(u.is_etf, false) as is_etf,
    coalesce(u.is_warrant, false) as is_warrant,
    coalesce(u.is_cb, false) as is_cb,
    coalesce(u.is_blacklisted, false) as is_blacklisted,
    coalesce(u.is_daytrade_unsuitable, false) as is_daytrade_unsuitable,
    q.session,
    q.is_halted,
    q.is_trial,
    q.updated_at as quote_updated_at,
    d.avg_20d_volume,
    d.days_5::integer as avg_5d_days,
    d.days_20::integer as avg_20d_days,
    s.updated_at as intraday_1m_status_updated_at,
    now() as refreshed_at
  from public.fugle_quotes_live q
  left join public.stock_universe u
    on u.symbol = q.symbol
  left join public.fugle_daily_volume_avg d
    on d.symbol = q.symbol
  left join public.v_fugle_intraday_1m_status s
    on s.symbol = q.symbol
  where q.symbol ~ '^[0-9]{4}$'
    and coalesce(q.stock_type, 'COMMONSTOCK') = 'COMMONSTOCK'
    and coalesce(u.is_active, true) = true
    and coalesce(u.is_etf, false) = false
    and coalesce(u.is_warrant, false) = false
    and coalesce(u.is_cb, false) = false
    and coalesce(u.is_blacklisted, false) = false
  on conflict (symbol) do update set
    name = excluded.name,
    market = excluded.market,
    price = excluded.price,
    previous_close = excluded.previous_close,
    change_percent = excluded.change_percent,
    total_volume = excluded.total_volume,
    trade_value = excluded.trade_value,
    open_price = excluded.open_price,
    high_price = excluded.high_price,
    low_price = excluded.low_price,
    avg_5d_volume = excluded.avg_5d_volume,
    today_candle_count = excluded.today_candle_count,
    latest_candle_time = excluded.latest_candle_time,
    ready_ge_35 = excluded.ready_ge_35,
    is_active = excluded.is_active,
    is_etf = excluded.is_etf,
    is_warrant = excluded.is_warrant,
    is_cb = excluded.is_cb,
    is_blacklisted = excluded.is_blacklisted,
    is_daytrade_unsuitable = excluded.is_daytrade_unsuitable,
    session = excluded.session,
    is_halted = excluded.is_halted,
    is_trial = excluded.is_trial,
    quote_updated_at = excluded.quote_updated_at,
    avg_20d_volume = excluded.avg_20d_volume,
    avg_5d_days = excluded.avg_5d_days,
    avg_20d_days = excluded.avg_20d_days,
    intraday_1m_status_updated_at = excluded.intraday_1m_status_updated_at,
    refreshed_at = excluded.refreshed_at;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.refresh_strategy2_intraday_ready_cache() to service_role;

create or replace function public.get_strategy2_intraday_ready(
  p_limit integer default 500,
  p_offset integer default 0
)
returns table (
  symbol text,
  name text,
  market text,
  price numeric,
  previous_close numeric,
  change_percent numeric,
  total_volume numeric,
  trade_value numeric,
  open_price numeric,
  high_price numeric,
  low_price numeric,
  quote_age_seconds integer,
  avg_5d_volume numeric,
  today_candle_count integer,
  latest_candle_time timestamptz,
  ready_ge_35 boolean,
  is_active boolean,
  is_etf boolean,
  is_warrant boolean,
  is_cb boolean,
  is_blacklisted boolean,
  is_daytrade_unsuitable boolean,
  session text,
  is_halted boolean,
  is_trial boolean,
  quote_updated_at timestamptz,
  avg_20d_volume numeric,
  avg_5d_days integer,
  avg_20d_days integer,
  intraday_1m_status_updated_at timestamptz,
  cache_refreshed_at timestamptz
)
language sql
stable
as $$
  select
    c.symbol,
    c.name,
    c.market,
    c.price,
    c.previous_close,
    c.change_percent,
    c.total_volume,
    c.trade_value,
    c.open_price,
    c.high_price,
    c.low_price,
    greatest(0, floor(extract(epoch from (now() - c.quote_updated_at))))::integer as quote_age_seconds,
    c.avg_5d_volume,
    c.today_candle_count,
    c.latest_candle_time,
    c.ready_ge_35,
    c.is_active,
    c.is_etf,
    c.is_warrant,
    c.is_cb,
    c.is_blacklisted,
    c.is_daytrade_unsuitable,
    c.session,
    c.is_halted,
    c.is_trial,
    c.quote_updated_at,
    c.avg_20d_volume,
    c.avg_5d_days,
    c.avg_20d_days,
    c.intraday_1m_status_updated_at,
    c.refreshed_at as cache_refreshed_at
  from public.strategy2_intraday_ready_cache c
  order by c.symbol asc
  limit greatest(1, least(coalesce(p_limit, 500), 1000))
  offset greatest(0, coalesce(p_offset, 0));
$$;

grant execute on function public.get_strategy2_intraday_ready(integer, integer) to anon;
grant execute on function public.get_strategy2_intraday_ready(integer, integer) to service_role;

notify pgrst, 'reload schema';

select public.refresh_strategy2_intraday_ready_cache();
