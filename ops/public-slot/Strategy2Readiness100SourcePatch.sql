-- Strategy2 readiness 100% source patch, 2026-06-26.
-- Fixes:
--   1. refresh_strategy2_readiness_cache uses safe DELETE ... WHERE.
--   2. refresh_strategy2_intraday_ready_cache is paged/cache based.
--   3. v_futopt_stock_mapping_ready follows the current tradable stock-future contract.
--   4. 08:55 preopen readiness reads a fixed gate cache, not a rolling last-1-minute view.

alter table public.strategy2_intraday_ready_cache
  add column if not exists ready_ge_80 boolean,
  add column if not exists ready_ge_200 boolean,
  add column if not exists warmup_candle_count integer not null default 0,
  add column if not exists continuous_candle_count integer not null default 0,
  add column if not exists ready_ma20_continuous boolean not null default false,
  add column if not exists ready_ma35_continuous boolean not null default false,
  add column if not exists ready_macd_continuous boolean not null default false;

create table if not exists public.strategy2_intraday_ready_refresh_state (
  id text primary key,
  trade_date date not null,
  next_offset integer not null default 0,
  page_size integer not null default 250,
  total_expected integer not null default 0,
  last_processed integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.strategy2_intraday_ready_refresh_state enable row level security;
grant select, insert, update, delete on public.strategy2_intraday_ready_refresh_state to service_role;

create or replace function public.refresh_strategy2_intraday_ready_cache(
  p_page_size integer default 250,
  p_reset boolean default false
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_trade_date date := (now() at time zone 'Asia/Taipei')::date;
  v_page_size integer := greatest(25, least(coalesce(p_page_size, 250), 500));
  v_offset integer := 0;
  v_total integer := 0;
  v_processed integer := 0;
  v_next_offset integer := 0;
begin
  insert into public.strategy2_intraday_ready_refresh_state (id, trade_date, next_offset, page_size)
  values ('strategy2', v_trade_date, 0, v_page_size)
  on conflict (id) do nothing;

  select
    case
      when p_reset or trade_date <> v_trade_date then 0
      else greatest(0, coalesce(next_offset, 0))
    end
  into v_offset
  from public.strategy2_intraday_ready_refresh_state
  where id = 'strategy2'
  for update;

  select count(*)
  into v_total
  from public.fugle_quotes_live q
  left join public.stock_universe u
    on u.symbol = q.symbol
  where q.symbol ~ '^[0-9]{4}$'
    and coalesce(q.stock_type, 'COMMONSTOCK') = 'COMMONSTOCK'
    and coalesce(u.is_active, true) = true
    and coalesce(u.is_etf, false) = false
    and coalesce(u.is_warrant, false) = false
    and coalesce(u.is_cb, false) = false
    and coalesce(u.is_blacklisted, false) = false
    and coalesce(u.is_daytrade_unsuitable, false) = false;

  if v_total <= 0 then
    update public.strategy2_intraday_ready_refresh_state
       set trade_date = v_trade_date,
           next_offset = 0,
           page_size = v_page_size,
           total_expected = 0,
           last_processed = 0,
           updated_at = now()
     where id = 'strategy2';
    return jsonb_build_object('ok', false, 'status', 'not_ready', 'reason', 'strategy2 intraday universe empty', 'processed', 0, 'total_expected', 0);
  end if;

  if v_offset >= v_total then
    v_offset := 0;
  end if;

  with universe as (
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
      q.session,
      q.is_halted,
      q.is_trial,
      q.updated_at as quote_updated_at,
      coalesce(u.is_active, false) as is_active,
      coalesce(u.is_etf, false) as is_etf,
      coalesce(u.is_warrant, false) as is_warrant,
      coalesce(u.is_cb, false) as is_cb,
      coalesce(u.is_blacklisted, false) as is_blacklisted,
      coalesce(u.is_daytrade_unsuitable, false) as is_daytrade_unsuitable
    from public.fugle_quotes_live q
    left join public.stock_universe u
      on u.symbol = q.symbol
    where q.symbol ~ '^[0-9]{4}$'
      and coalesce(q.stock_type, 'COMMONSTOCK') = 'COMMONSTOCK'
      and coalesce(u.is_active, true) = true
      and coalesce(u.is_etf, false) = false
      and coalesce(u.is_warrant, false) = false
      and coalesce(u.is_cb, false) = false
      and coalesce(u.is_blacklisted, false) = false
      and coalesce(u.is_daytrade_unsuitable, false) = false
    order by q.symbol
    limit v_page_size
    offset v_offset
  ),
  candle_status as (
    select
      p.symbol,
      coalesce(s.today_candle_count, 0)::integer as today_candle_count,
      coalesce(s.warmup_candle_count, 0)::integer as warmup_candle_count,
      coalesce(s.continuous_candle_count, s.candle_count, 0)::integer as continuous_candle_count,
      s.latest_candle_time,
      s.updated_at,
      coalesce(s.ready_ma20_continuous, s.ready_ge_20, coalesce(s.continuous_candle_count, s.candle_count, 0) >= 20) as ready_ma20_continuous,
      coalesce(s.ready_ma35_continuous, s.ready_ge_35, coalesce(s.continuous_candle_count, s.candle_count, 0) >= 35) as ready_ma35_continuous,
      coalesce(s.ready_macd_continuous, s.ready_ge_80, coalesce(s.continuous_candle_count, s.candle_count, 0) >= 80) as ready_macd_continuous,
      coalesce(s.ready_ge_80, coalesce(s.continuous_candle_count, s.candle_count, 0) >= 80) as ready_ge_80,
      coalesce(s.ready_ge_200, coalesce(s.continuous_candle_count, s.candle_count, 0) >= 200) as ready_ge_200
    from universe p
    left join public.v_fugle_intraday_1m_status s
      on s.symbol = p.symbol
  )
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
    ready_ge_80,
    ready_ge_200,
    warmup_candle_count,
    continuous_candle_count,
    ready_ma20_continuous,
    ready_ma35_continuous,
    ready_macd_continuous,
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
    p.symbol,
    p.name,
    p.market,
    p.price,
    p.previous_close,
    p.change_percent,
    p.total_volume,
    p.trade_value,
    p.open_price,
    p.high_price,
    p.low_price,
    coalesce(d.avg_5d_volume, 0),
    coalesce(s.today_candle_count, 0),
    s.latest_candle_time,
    coalesce(s.ready_ma35_continuous, false),
    coalesce(s.ready_ge_80, false),
    coalesce(s.ready_ge_200, false),
    coalesce(s.warmup_candle_count, 0),
    coalesce(s.continuous_candle_count, 0),
    coalesce(s.ready_ma20_continuous, false),
    coalesce(s.ready_ma35_continuous, false),
    coalesce(s.ready_macd_continuous, false),
    p.is_active,
    p.is_etf,
    p.is_warrant,
    p.is_cb,
    p.is_blacklisted,
    p.is_daytrade_unsuitable,
    p.session,
    p.is_halted,
    p.is_trial,
    p.quote_updated_at,
    d.avg_20d_volume,
    d.days_5::integer,
    d.days_20::integer,
    s.updated_at,
    now()
  from universe p
  left join public.fugle_daily_volume_avg d
    on d.symbol = p.symbol
  left join candle_status s
    on s.symbol = p.symbol
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
    ready_ge_80 = excluded.ready_ge_80,
    ready_ge_200 = excluded.ready_ge_200,
    warmup_candle_count = excluded.warmup_candle_count,
    continuous_candle_count = excluded.continuous_candle_count,
    ready_ma20_continuous = excluded.ready_ma20_continuous,
    ready_ma35_continuous = excluded.ready_ma35_continuous,
    ready_macd_continuous = excluded.ready_macd_continuous,
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

  get diagnostics v_processed = row_count;
  v_next_offset := case when (v_offset + v_page_size) >= v_total then 0 else v_offset + v_page_size end;

  update public.strategy2_intraday_ready_refresh_state
     set trade_date = v_trade_date,
         next_offset = v_next_offset,
         page_size = v_page_size,
         total_expected = v_total,
         last_processed = v_processed,
         updated_at = now()
   where id = 'strategy2';

  delete from public.strategy2_intraday_ready_cache
   where refreshed_at < now() - interval '3 days';

  return jsonb_build_object(
    'ok', true,
    'status', 'paged',
    'trade_date', v_trade_date,
    'processed', v_processed,
    'page_size', v_page_size,
    'offset', v_offset,
    'next_offset', v_next_offset,
    'total_expected', v_total
  );
end;
$$;

grant execute on function public.refresh_strategy2_intraday_ready_cache(integer, boolean) to service_role;

create or replace function public.refresh_strategy2_intraday_ready_cache()
returns jsonb
language plpgsql
security definer
as $$
begin
  return public.refresh_strategy2_intraday_ready_cache(250, false);
end;
$$;

grant execute on function public.refresh_strategy2_intraday_ready_cache() to service_role;

create or replace view public.v_strategy2_intraday_ready as
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
  c.avg_5d_days::bigint as avg_5d_days,
  c.avg_20d_days::bigint as avg_20d_days,
  c.intraday_1m_status_updated_at,
  c.warmup_candle_count,
  c.continuous_candle_count,
  c.ready_ma20_continuous,
  c.ready_ma35_continuous,
  c.ready_macd_continuous
from public.strategy2_intraday_ready_cache c
where c.symbol ~ '^[0-9]{4}$';

grant select on public.v_strategy2_intraday_ready to anon;
grant select on public.v_strategy2_intraday_ready to service_role;

create or replace view public.v_futopt_stock_mapping_ready as
with trade_clock as (
  select (now() at time zone 'Asia/Taipei')::date as trade_date
),
txf_quote as (
  select q.change_percent
  from public.futopt_quotes_live q
  where q.future_symbol like 'TXF%'
  order by q.updated_at desc nulls last
  limit 1
),
current_contract as (
  select *
  from (
    select
      t.*,
      row_number() over (
        partition by t.underlying_symbol
        order by
          case when t.end_date >= (select trade_date from trade_clock) then 0 else 1 end,
          case when t.end_date >= (select trade_date from trade_clock) then t.end_date end asc nulls last,
          t.end_date desc nulls last,
          t.updated_at desc nulls last,
          t.future_symbol asc
      ) as rn
    from public.futopt_tickers t
    where t.product = 'STOCK_FUTURE'
      and t.underlying_symbol ~ '^[0-9]{4}$'
  ) ranked
  where rn = 1
)
select
  s.symbol as stock_symbol,
  coalesce(s.name, c.underlying_name) as stock_name,
  s.market,
  c.future_symbol,
  c.name as future_name,
  c.contract_type,
  c.product,
  c.end_date,
  c.exchange,
  c.underlying_name,
  c.session as ticker_session,
  c.updated_at as ticker_updated_at,
  q.updated_at as quote_updated_at,
  q.last_price,
  q.open_price,
  q.high_price,
  q.low_price,
  q.previous_close,
  q.change_percent as fut_change_percent,
  (select change_percent from txf_quote) as txf_change_percent,
  q.change_percent - coalesce((select change_percent from txf_quote), 0) as rel_to_txf,
  q.total_volume,
  q.session as quote_session,
  greatest(0, floor(extract(epoch from (now() - q.updated_at))))::integer as quote_age_seconds,
  c.future_symbol is not null as has_mapping,
  q.future_symbol is not null as has_quote,
  q.updated_at >= now() - interval '180 seconds' as quote_fresh_180s,
  (
    c.future_symbol is not null
    and q.future_symbol is not null
    and q.updated_at >= now() - interval '180 seconds'
    and coalesce(q.last_price, 0) > 0
  ) as futopt_ready,
  s.symbol as symbol
from public.stock_universe s
left join current_contract c
  on c.underlying_symbol = s.symbol
left join public.futopt_quotes_live q
  on q.future_symbol = c.future_symbol
where s.symbol ~ '^[0-9]{4}$'
  and coalesce(s.is_active, true) = true
  and coalesce(s.is_etf, false) = false
  and coalesce(s.is_warrant, false) = false
  and coalesce(s.is_cb, false) = false
  and coalesce(s.is_blacklisted, false) = false
  and coalesce(s.is_daytrade_unsuitable, false) = false
  and c.future_symbol is not null;

grant select on public.v_futopt_stock_mapping_ready to anon;
grant select on public.v_futopt_stock_mapping_ready to service_role;

create table if not exists public.strategy2_preopen_hot_gate_cache (
  gate_date date not null,
  symbol text not null,
  name text,
  market text,
  reference_price numeric,
  trial_price numeric,
  is_trial boolean,
  is_limit_up_bid boolean,
  best_bid_price numeric,
  best_ask_price numeric,
  bid_volume numeric,
  ask_volume numeric,
  snapshots_last_1m integer not null default 0,
  has_3_snapshots_last_1m boolean not null default false,
  final_blind_buy_history_ready boolean not null default false,
  latest_observed_at timestamptz,
  captured_at timestamptz not null default now(),
  details jsonb not null default '{}'::jsonb,
  primary key (gate_date, symbol)
);

create index if not exists idx_strategy2_preopen_hot_gate_cache_date_ready
  on public.strategy2_preopen_hot_gate_cache (gate_date, has_3_snapshots_last_1m, final_blind_buy_history_ready);

alter table public.strategy2_preopen_hot_gate_cache enable row level security;

drop policy if exists "read strategy2 preopen hot gate cache" on public.strategy2_preopen_hot_gate_cache;
create policy "read strategy2 preopen hot gate cache"
on public.strategy2_preopen_hot_gate_cache
for select
to anon
using (true);

grant select on public.strategy2_preopen_hot_gate_cache to anon;
grant select, insert, update, delete on public.strategy2_preopen_hot_gate_cache to service_role;

create or replace function public.refresh_strategy2_preopen_hot_gate_cache(
  p_gate_date date default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_gate_date date := coalesce(p_gate_date, (now() at time zone 'Asia/Taipei')::date);
  v_pick_start timestamptz := (v_gate_date::text || ' 08:50:00+08')::timestamptz;
  v_gate_start timestamptz := (v_gate_date::text || ' 08:54:00+08')::timestamptz;
  v_gate_end timestamptz := (v_gate_date::text || ' 08:56:00+08')::timestamptz;
  v_rows integer := 0;
  v_ready integer := 0;
begin
  with latest as (
    select distinct on (h.symbol)
      h.symbol,
      h.name,
      h.market,
      h.reference_price,
      h.trial_price,
      h.is_trial,
      h.is_limit_up_bid,
      h.best_bid_price,
      h.best_ask_price,
      h.bid_volume,
      h.ask_volume,
      h.observed_at as latest_observed_at
    from public.fugle_preopen_snapshot_history h
    where h.trade_date = v_gate_date
      and h.observed_at >= v_pick_start
      and h.observed_at <= v_gate_end
      and h.symbol ~ '^[0-9]{4}$'
    order by h.symbol, h.observed_at desc
  ),
  counts as (
    select
      h.symbol,
      count(*)::integer as snapshots_last_1m,
      max(h.observed_at) as max_observed_at
    from public.fugle_preopen_snapshot_history h
    where h.trade_date = v_gate_date
      and h.observed_at >= v_gate_start
      and h.observed_at <= v_gate_end
      and h.symbol ~ '^[0-9]{4}$'
    group by h.symbol
  )
  insert into public.strategy2_preopen_hot_gate_cache (
    gate_date,
    symbol,
    name,
    market,
    reference_price,
    trial_price,
    is_trial,
    is_limit_up_bid,
    best_bid_price,
    best_ask_price,
    bid_volume,
    ask_volume,
    snapshots_last_1m,
    has_3_snapshots_last_1m,
    final_blind_buy_history_ready,
    latest_observed_at,
    captured_at,
    details
  )
  select
    v_gate_date,
    l.symbol,
    l.name,
    l.market,
    l.reference_price,
    l.trial_price,
    l.is_trial,
    l.is_limit_up_bid,
    l.best_bid_price,
    l.best_ask_price,
    l.bid_volume,
    l.ask_volume,
    coalesce(c.snapshots_last_1m, 0),
    coalesce(c.snapshots_last_1m, 0) >= 3,
    coalesce(c.snapshots_last_1m, 0) >= 3,
    coalesce(c.max_observed_at, l.latest_observed_at),
    now(),
    jsonb_build_object(
      'source', 'fugle_preopen_snapshot_history',
      'gate', '08:55_preopen_hot',
      'fixed_window_start', v_gate_start,
      'fixed_window_end', v_gate_end,
      'pick_start', v_pick_start
    )
  from latest l
  left join counts c
    on c.symbol = l.symbol
  on conflict (gate_date, symbol) do update set
    name = excluded.name,
    market = excluded.market,
    reference_price = excluded.reference_price,
    trial_price = excluded.trial_price,
    is_trial = excluded.is_trial,
    is_limit_up_bid = excluded.is_limit_up_bid,
    best_bid_price = excluded.best_bid_price,
    best_ask_price = excluded.best_ask_price,
    bid_volume = excluded.bid_volume,
    ask_volume = excluded.ask_volume,
    snapshots_last_1m = excluded.snapshots_last_1m,
    has_3_snapshots_last_1m = excluded.has_3_snapshots_last_1m,
    final_blind_buy_history_ready = excluded.final_blind_buy_history_ready,
    latest_observed_at = excluded.latest_observed_at,
    captured_at = excluded.captured_at,
    details = excluded.details;

  get diagnostics v_rows = row_count;

  delete from public.strategy2_preopen_hot_gate_cache gc
   where gc.gate_date = v_gate_date
     and gc.symbol is not null
     and not exists (
       select 1
       from public.fugle_preopen_snapshot_history h
       where h.trade_date = v_gate_date
         and h.observed_at >= v_pick_start
         and h.observed_at <= v_gate_end
         and h.symbol = gc.symbol
     );

  select count(*) filter (
    where has_3_snapshots_last_1m = true
      and final_blind_buy_history_ready = true
  )
  into v_ready
  from public.strategy2_preopen_hot_gate_cache
  where gate_date = v_gate_date;

  return jsonb_build_object(
    'ok', v_rows > 0,
    'status', case when v_rows > 0 then 'cached' else 'not_ready' end,
    'gate_date', v_gate_date,
    'rows', v_rows,
    'ready', coalesce(v_ready, 0),
    'gate', '08:55_preopen_hot',
    'source', 'fugle_preopen_snapshot_history'
  );
end;
$$;

grant execute on function public.refresh_strategy2_preopen_hot_gate_cache(date) to service_role;

alter table public.strategy2_readiness_status_cache
  add column if not exists futopt_coverage numeric not null default 0,
  add column if not exists futopt_ready boolean not null default false,
  add column if not exists preopen_hot_coverage numeric not null default 0,
  add column if not exists preopen_hot_ready boolean not null default false,
  add column if not exists intraday_1m_coverage numeric not null default 0,
  add column if not exists intraday_1m_ready boolean not null default false,
  add column if not exists latest_execution_rate numeric not null default 0,
  add column if not exists execution_ready boolean not null default false;

create or replace function public.refresh_strategy2_readiness_cache()
returns jsonb
language plpgsql
security definer
as $$
declare
  v_checked_at timestamptz := now();
  v_trade_date date := (now() at time zone 'Asia/Taipei')::date;
  v_futopt_expected integer := 0;
  v_futopt_ready integer := 0;
  v_preopen_snapshot integer := 0;
  v_preopen_hot_expected integer := 0;
  v_preopen_hot_ready integer := 0;
  v_intraday_expected integer := 0;
  v_intraday_ready integer := 0;
  v_latest record;
  v_execution_expected numeric := 0;
  v_execution_scanned numeric := 0;
  v_missing_summary jsonb := '[]'::jsonb;
  v_reasons text[] := array[]::text[];
  v_status text := 'ready';
  v_ready_100 boolean := false;
begin
  delete from public.strategy2_readiness_missing_cache
   where id is not null;

  insert into public.strategy2_readiness_missing_cache (
    checked_at, gate, symbol, name, future_symbol, missing_reason, details
  )
  select
    v_checked_at,
    '08:45_futopt',
    stock_symbol,
    stock_name,
    future_symbol,
    case
      when coalesce(has_mapping, false) = false then 'missing_mapping'
      when coalesce(has_quote, false) = false then 'missing_quote'
      when coalesce(quote_fresh_180s, false) = false then 'stale_quote'
      when coalesce(futopt_ready, false) = false then 'futopt_not_ready'
      else 'unknown'
    end,
    jsonb_build_object(
      'source', 'v_futopt_stock_mapping_ready',
      'contract_policy', 'current_tradable_contract_month',
      'has_mapping', has_mapping,
      'has_quote', has_quote,
      'quote_fresh_180s', quote_fresh_180s,
      'futopt_ready', futopt_ready,
      'quote_age_seconds', quote_age_seconds,
      'quote_updated_at', quote_updated_at,
      'end_date', end_date,
      'fut_change_percent', fut_change_percent,
      'txf_change_percent', txf_change_percent,
      'rel_to_txf', rel_to_txf,
      'total_volume', total_volume
    )
  from public.v_futopt_stock_mapping_ready
  where coalesce(has_mapping, false) = true
    and not (
      coalesce(has_quote, false) = true
      and coalesce(quote_fresh_180s, false) = true
      and coalesce(futopt_ready, false) = true
    );

  insert into public.strategy2_readiness_missing_cache (
    checked_at, gate, symbol, name, future_symbol, missing_reason, details
  )
  select
    v_checked_at,
    '08:55_preopen_hot',
    symbol,
    name,
    null,
    case
      when coalesce(has_3_snapshots_last_1m, false) = false then 'missing_3_snapshots_last_1m'
      when coalesce(final_blind_buy_history_ready, false) = false then 'final_blind_buy_history_not_ready'
      else 'unknown'
    end,
    jsonb_build_object(
      'source', 'strategy2_preopen_hot_gate_cache',
      'reference_price', reference_price,
      'trial_price', trial_price,
      'is_trial', is_trial,
      'is_limit_up_bid', is_limit_up_bid,
      'best_bid_price', best_bid_price,
      'bid_volume', bid_volume,
      'ask_volume', ask_volume,
      'snapshots_last_1m', snapshots_last_1m,
      'has_3_snapshots_last_1m', has_3_snapshots_last_1m,
      'final_blind_buy_history_ready', final_blind_buy_history_ready,
      'latest_observed_at', latest_observed_at,
      'captured_at', captured_at
    )
  from public.strategy2_preopen_hot_gate_cache
  where gate_date = v_trade_date
    and not (
      coalesce(has_3_snapshots_last_1m, false) = true
      and coalesce(final_blind_buy_history_ready, false) = true
    );

  insert into public.strategy2_readiness_missing_cache (
    checked_at, gate, symbol, name, future_symbol, missing_reason, details
  )
  select
    v_checked_at,
    '09:00_12:00_intraday_1m',
    symbol,
    name,
    null,
    'intraday_1m_not_ready_ma35_continuous',
    jsonb_build_object(
      'source', 'v_strategy2_intraday_ready',
      'cache_policy', 'paged_strategy2_intraday_ready_cache',
      'today_candle_count', today_candle_count,
      'warmup_candle_count', warmup_candle_count,
      'continuous_candle_count', continuous_candle_count,
      'latest_candle_time', latest_candle_time,
      'ready_ge_35', ready_ge_35,
      'ready_ma35_continuous', ready_ma35_continuous,
      'quote_age_seconds', quote_age_seconds,
      'quote_updated_at', quote_updated_at,
      'price', price,
      'change_percent', change_percent,
      'total_volume', total_volume
    )
  from public.v_strategy2_intraday_ready
  where not (
    coalesce(ready_ma35_continuous, ready_ge_35, false) = true
    or coalesce(continuous_candle_count, 0) >= 35
  );

  select
    count(*) filter (where coalesce(has_mapping, false) = true),
    count(*) filter (
      where coalesce(has_mapping, false) = true
        and coalesce(has_quote, false) = true
        and coalesce(quote_fresh_180s, false) = true
        and coalesce(futopt_ready, false) = true
    )
  into v_futopt_expected, v_futopt_ready
  from public.v_futopt_stock_mapping_ready;

  select count(distinct symbol)
  into v_preopen_snapshot
  from public.fugle_preopen_snapshot
  where symbol is not null;

  select
    count(*),
    count(*) filter (
      where coalesce(has_3_snapshots_last_1m, false) = true
        and coalesce(final_blind_buy_history_ready, false) = true
    )
  into v_preopen_hot_expected, v_preopen_hot_ready
  from public.strategy2_preopen_hot_gate_cache
  where gate_date = v_trade_date;

  select
    count(*),
    count(*) filter (
      where coalesce(ready_ma35_continuous, ready_ge_35, false) = true
         or coalesce(continuous_candle_count, 0) >= 35
    )
  into v_intraday_expected, v_intraday_ready
  from public.v_strategy2_intraday_ready;

  select
    l.run_id,
    l.scan_date,
    l.finished_at,
    l.status,
    l.complete,
    l.result_count,
    l.record_count,
    l.event_count,
    l.entry_count,
    l.payload
  into v_latest
  from (select 1) anchor
  left join lateral (
    select *
    from public.v_strategy2_latest_complete_run
    limit 1
  ) l on true;

  if v_latest.run_id is not null then
    v_execution_expected := coalesce(
      public.strategy2_numeric_payload_value(v_latest.payload, 'total', 'totalCount', 'expected_total', 'expectedTotal', 'sourceCount'),
      v_latest.record_count,
      v_latest.result_count,
      0
    );
    v_execution_scanned := coalesce(
      public.strategy2_numeric_payload_value(v_latest.payload, 'scanned', 'scannedCount', 'scanned_count'),
      case
        when jsonb_typeof(v_latest.payload -> 'scannedCodes') = 'array'
        then jsonb_array_length(v_latest.payload -> 'scannedCodes')::numeric
        else null
      end,
      v_latest.record_count,
      v_latest.result_count,
      0
    );
  end if;

  if v_futopt_expected <= 0 or v_futopt_ready <> v_futopt_expected then
    v_reasons := array_append(v_reasons, format('08:45 futopt %s/%s ready', v_futopt_ready, v_futopt_expected));
  end if;
  if v_preopen_hot_expected <= 0 or v_preopen_hot_ready <> v_preopen_hot_expected then
    v_reasons := array_append(v_reasons, format('08:55 preopen_hot %s/%s ready', v_preopen_hot_ready, v_preopen_hot_expected));
  end if;
  if v_intraday_expected <= 0 or v_intraday_ready <> v_intraday_expected then
    v_reasons := array_append(v_reasons, format('08:45-12:00 intraday_1m %s/%s ready', v_intraday_ready, v_intraday_expected));
  end if;
  if v_latest.run_id is null
     or v_latest.complete is not true
     or v_latest.status <> 'complete'
     or v_execution_expected <= 0
     or v_execution_scanned <> v_execution_expected then
    v_reasons := array_append(v_reasons, format('execution %s/%s scanned latest=%s', v_execution_scanned, v_execution_expected, coalesce(v_latest.run_id, 'missing')));
    insert into public.strategy2_readiness_missing_cache (
      checked_at, gate, symbol, name, future_symbol, missing_reason, details
    ) values (
      v_checked_at,
      '09:00_12:00_execution',
      coalesce(v_latest.run_id, ''),
      'latest_complete_run',
      null,
      case
        when v_latest.run_id is null then 'latest_run_missing'
        when v_latest.complete is not true then 'latest_run_not_complete'
        when v_latest.status <> 'complete' then 'latest_status_not_complete'
        when v_execution_expected <= 0 then 'execution_denominator_missing'
        when v_execution_scanned <> v_execution_expected then 'execution_not_100_percent'
        else 'unknown'
      end,
      jsonb_build_object(
        'source', 'v_strategy2_latest_complete_run',
        'run_id', v_latest.run_id,
        'scan_date', v_latest.scan_date,
        'finished_at', v_latest.finished_at,
        'status', v_latest.status,
        'complete', v_latest.complete,
        'result_count', v_latest.result_count,
        'record_count', v_latest.record_count,
        'event_count', v_latest.event_count,
        'entry_count', v_latest.entry_count,
        'execution_expected', v_execution_expected,
        'execution_scanned', v_execution_scanned
      )
    );
  end if;

  v_ready_100 := array_length(v_reasons, 1) is null;
  v_status := case when v_ready_100 then 'ready' else 'not_ready' end;

  select coalesce(
    jsonb_agg(jsonb_build_object('gate', gate, 'missing_reason', missing_reason, 'rows', rows) order by gate, rows desc),
    '[]'::jsonb
  )
  into v_missing_summary
  from (
    select gate, missing_reason, count(*) as rows
    from public.strategy2_readiness_missing_cache
    group by gate, missing_reason
  ) grouped;

  insert into public.strategy2_readiness_status_cache (
    id,
    checked_at,
    status,
    reason,
    strategy2_ready_100,
    futopt_expected_count,
    futopt_ready_count,
    preopen_snapshot_count,
    preopen_hot_candidate_count,
    preopen_hot_ready_count,
    detection_expected_count,
    intraday_1m_ready_count,
    latest_run_id,
    latest_scan_date,
    latest_finished_at,
    latest_status,
    latest_complete,
    latest_result_count,
    latest_record_count,
    latest_event_count,
    latest_entry_count,
    latest_execution_expected,
    latest_execution_scanned,
    missing_summary,
    futopt_coverage,
    futopt_ready,
    preopen_hot_coverage,
    preopen_hot_ready,
    intraday_1m_coverage,
    intraday_1m_ready,
    latest_execution_rate,
    execution_ready
  ) values (
    'latest',
    v_checked_at,
    v_status,
    array_to_string(v_reasons, '; '),
    v_ready_100,
    v_futopt_expected,
    v_futopt_ready,
    v_preopen_snapshot,
    v_preopen_hot_expected,
    v_preopen_hot_ready,
    v_intraday_expected,
    v_intraday_ready,
    v_latest.run_id,
    v_latest.scan_date,
    v_latest.finished_at,
    v_latest.status,
    v_latest.complete,
    v_latest.result_count,
    v_latest.record_count,
    v_latest.event_count,
    v_latest.entry_count,
    v_execution_expected,
    v_execution_scanned,
    v_missing_summary,
    case when v_futopt_expected > 0 then v_futopt_ready::numeric / v_futopt_expected else 0 end,
    v_futopt_expected > 0 and v_futopt_ready = v_futopt_expected,
    case when v_preopen_hot_expected > 0 then v_preopen_hot_ready::numeric / v_preopen_hot_expected else 0 end,
    v_preopen_hot_expected > 0 and v_preopen_hot_ready = v_preopen_hot_expected,
    case when v_intraday_expected > 0 then v_intraday_ready::numeric / v_intraday_expected else 0 end,
    v_intraday_expected > 0 and v_intraday_ready = v_intraday_expected,
    case when v_execution_expected > 0 then v_execution_scanned / v_execution_expected else 0 end,
    v_latest.complete = true and v_latest.status = 'complete' and v_execution_expected > 0 and v_execution_scanned = v_execution_expected
  )
  on conflict (id) do update set
    checked_at = excluded.checked_at,
    status = excluded.status,
    reason = excluded.reason,
    strategy2_ready_100 = excluded.strategy2_ready_100,
    futopt_expected_count = excluded.futopt_expected_count,
    futopt_ready_count = excluded.futopt_ready_count,
    preopen_snapshot_count = excluded.preopen_snapshot_count,
    preopen_hot_candidate_count = excluded.preopen_hot_candidate_count,
    preopen_hot_ready_count = excluded.preopen_hot_ready_count,
    detection_expected_count = excluded.detection_expected_count,
    intraday_1m_ready_count = excluded.intraday_1m_ready_count,
    latest_run_id = excluded.latest_run_id,
    latest_scan_date = excluded.latest_scan_date,
    latest_finished_at = excluded.latest_finished_at,
    latest_status = excluded.latest_status,
    latest_complete = excluded.latest_complete,
    latest_result_count = excluded.latest_result_count,
    latest_record_count = excluded.latest_record_count,
    latest_event_count = excluded.latest_event_count,
    latest_entry_count = excluded.latest_entry_count,
    latest_execution_expected = excluded.latest_execution_expected,
    latest_execution_scanned = excluded.latest_execution_scanned,
    missing_summary = excluded.missing_summary,
    futopt_coverage = excluded.futopt_coverage,
    futopt_ready = excluded.futopt_ready,
    preopen_hot_coverage = excluded.preopen_hot_coverage,
    preopen_hot_ready = excluded.preopen_hot_ready,
    intraday_1m_coverage = excluded.intraday_1m_coverage,
    intraday_1m_ready = excluded.intraday_1m_ready,
    latest_execution_rate = excluded.latest_execution_rate,
    execution_ready = excluded.execution_ready;

  return jsonb_build_object(
    'ok', v_ready_100,
    'status', v_status,
    'reason', array_to_string(v_reasons, '; '),
    'strategy2_ready_100', v_ready_100,
    'futopt_ready_count', v_futopt_ready,
    'futopt_expected_count', v_futopt_expected,
    'preopen_hot_ready_count', v_preopen_hot_ready,
    'preopen_hot_candidate_count', v_preopen_hot_expected,
    'intraday_1m_ready_count', v_intraday_ready,
    'detection_expected_count', v_intraday_expected,
    'latest_run_id', v_latest.run_id,
    'latest_execution_scanned', v_execution_scanned,
    'latest_execution_expected', v_execution_expected,
    'missing_summary', v_missing_summary
  );
end;
$$;

grant execute on function public.refresh_strategy2_readiness_cache() to service_role;

create or replace view public.v_strategy2_readiness_status as
select
  id,
  checked_at,
  status,
  reason,
  strategy2_ready_100,
  futopt_expected_count,
  futopt_ready_count,
  preopen_snapshot_count,
  preopen_hot_candidate_count,
  preopen_hot_ready_count,
  detection_expected_count,
  intraday_1m_ready_count,
  latest_run_id,
  latest_scan_date,
  latest_finished_at,
  latest_status,
  latest_complete,
  latest_result_count,
  latest_record_count,
  latest_event_count,
  latest_entry_count,
  latest_execution_expected,
  latest_execution_scanned,
  missing_summary
from public.strategy2_readiness_status_cache
where id = 'latest';

create or replace view public.v_strategy2_readiness_missing as
select
  checked_at,
  gate,
  symbol,
  name,
  future_symbol,
  missing_reason,
  details
from public.strategy2_readiness_missing_cache;

grant select on public.v_strategy2_readiness_status to anon;
grant select on public.v_strategy2_readiness_status to service_role;
grant select on public.v_strategy2_readiness_missing to anon;
grant select on public.v_strategy2_readiness_missing to service_role;

notify pgrst, 'reload schema';

select public.refresh_strategy2_preopen_hot_gate_cache();
select public.refresh_strategy2_intraday_ready_cache(250, true);
select public.refresh_strategy2_readiness_cache();
