begin;

-- Compatibility cleanup for contract-only alias views created by previous attempts.
-- Do not drop raw source tables or legacy v_strategy12_stock_future_contract_health.
drop view if exists public.v_fugle_daytrade_source_status_contract;
drop view if exists public.v_fugle_daytrade_stock_future_scorecard;
drop view if exists public.v_fugle_daytrade_stock_future_contract_health;
drop view if exists public.v_fugle_daytrade_intraday_1m_today_status;
drop view if exists public.v_fugle_intraday_1m_contract_notice;-- Daytrade source contract closure, 2026-07-21.
-- Scope: Supabase/read-only source contract only. UI/Auth/terminal display are out of scope.
-- Formal daytrade source remains fugle_daytrade_source. Legacy shared-source 1m paths are marked/delegated.

create or replace view public.v_stock_future_live_contract as
with raw as (
  select
    q.future_symbol,
    q.future_symbol as source_symbol,
    nullif(q.underlying_symbol, '') as raw_underlying_symbol,
    nullif(q.underlying_name, '') as raw_underlying_name,
    coalesce(nullif(q.product, ''), nullif(q.payload ->> 'product', '')) as raw_product,
    q.last_price,
    q.change_percent,
    q.total_volume,
    q.updated_at,
    q.payload
  from public.fugle_daytrade_futopt_quotes_live q
  where q.future_symbol is not null
),
txf as (
  select
    future_symbol as txf_future_symbol,
    last_price as txf_last_price,
    change_percent as txf_change_percent,
    total_volume as txf_total_volume,
    updated_at as txf_updated_at
  from raw
  where upper(coalesce(raw_product, '')) = 'TXF'
     or upper(coalesce(raw_underlying_symbol, '')) = 'TXF'
     or upper(coalesce(future_symbol, '')) like 'TXF%'
  order by updated_at desc
  limit 1
),
stock_future as (
  select
    coalesce(raw_underlying_symbol, nullif(payload ->> 'underlying_symbol', '')) as symbol,
    coalesce(raw_underlying_name, nullif(payload ->> 'underlying_name', ''), nullif(payload ->> 'name', '')) as stock_name,
    future_symbol,
    source_symbol,
    last_price as futopt_last_price,
    change_percent as futopt_change_percent,
    total_volume as futopt_total_volume,
    updated_at as futopt_updated_at,
    payload,
    coalesce(raw_product, 'STOCK_FUTURE') as product
  from raw
  where upper(coalesce(raw_product, 'STOCK_FUTURE')) in ('S', 'STOCK_FUTURE')
    and coalesce(raw_underlying_symbol, payload ->> 'underlying_symbol', '') ~ '^[0-9]{4}$'
)
select
  (sf.futopt_updated_at at time zone 'Asia/Taipei')::date as trade_date,
  sf.symbol,
  coalesce(nullif(sf.stock_name, ''), st.name, sf.symbol) as stock_name,
  sf.future_symbol,
  sf.source_symbol,
  sf.futopt_last_price,
  sf.futopt_change_percent,
  sf.futopt_total_volume,
  sf.futopt_updated_at,
  txf.txf_future_symbol,
  txf.txf_last_price,
  txf.txf_change_percent,
  txf.txf_total_volume,
  txf.txf_updated_at,
  sf.futopt_change_percent - coalesce(txf.txf_change_percent, 0) as relative_to_txf_percent,
  extract(epoch from (now() - sf.futopt_updated_at)) <= 60 as futopt_fresh_60s,
  extract(epoch from (now() - txf.txf_updated_at)) <= 60 as txf_fresh_60s,
  case
    when sf.futopt_updated_at is null then 'missing'
    when (sf.futopt_updated_at at time zone 'Asia/Taipei')::date <> (now() at time zone 'Asia/Taipei')::date then 'stale'
    when extract(epoch from (now() - sf.futopt_updated_at)) <= 180 then 'ready'
    else 'stale'
  end as source_status,
  case
    when sf.futopt_updated_at is null then 'stock future quote missing'
    when (sf.futopt_updated_at at time zone 'Asia/Taipei')::date <> (now() at time zone 'Asia/Taipei')::date then 'stock future quote not today'
    when extract(epoch from (now() - sf.futopt_updated_at)) <= 180 then 'stock future quote ready'
    else 'stock future quote stale'
  end as reason,
  (
    sf.futopt_change_percent >= 2
    and (sf.futopt_change_percent - coalesce(txf.txf_change_percent, 0)) >= 1
    and sf.futopt_total_volume >= 50
  ) as star_precheck_ok,
  (
    sf.futopt_change_percent >= 2
    and (sf.futopt_change_percent - coalesce(txf.txf_change_percent, 0)) >= 1
    and sf.futopt_total_volume >= 50
    and extract(epoch from (now() - sf.futopt_updated_at)) <= 180
  ) as strategy2_futopt_gate_ok,
  sf.futopt_updated_at as updated_at,
  sf.product,
  substring(sf.future_symbol from '[0-9]{3}$') as near_month,
  sf.symbol as underlying_symbol,
  sf.futopt_last_price as last_price,
  sf.futopt_change_percent as change_percent,
  sf.futopt_total_volume as total_volume,
  'fugle_daytrade_futopt_quotes_live'::text as contract_source,
  (sf.payload ->> 'source')::text as formal_quote_source
from stock_future sf
left join txf on true
left join public.stock_tickers st on st.symbol = sf.symbol
order by sf.futopt_updated_at desc, sf.symbol asc;

create or replace view public.v_fugle_daytrade_stock_future_contract_health as
select
  max(trade_date) as trade_date,
  count(*) as contract_rows,
  count(distinct symbol) as symbol_rows,
  count(distinct future_symbol) as future_symbol_rows,
  count(*) filter (where futopt_last_price > 0) as last_price_rows,
  count(*) filter (where futopt_change_percent is not null) as change_percent_rows,
  count(*) filter (where futopt_total_volume is not null) as total_volume_rows,
  count(*) filter (where source_status = 'ready') as ready_rows,
  count(*) filter (where source_status = 'stale') as stale_rows,
  count(*) filter (where source_status <> 'ready') as not_ready_rows,
  count(*) filter (where star_precheck_ok) as star_precheck_rows,
  count(*) filter (where strategy2_futopt_gate_ok) as strategy2_futopt_gate_rows,
  max(futopt_updated_at) as latest_futopt_updated_at,
  max(txf_updated_at) as latest_txf_updated_at,
  max(updated_at) as latest_updated_at,
  case
    when count(*) = 0 then 'missing'
    when count(*) filter (where source_status = 'ready') > 0 then 'ready'
    else 'not_ready'
  end as source_status,
  case
    when count(*) = 0 then 'stock future contract rows missing'
    when count(*) filter (where source_status = 'ready') > 0 then 'stock future contract ready'
    else 'ready_rows_zero'
  end as reason,
  now() as checked_at,
  'fugle_daytrade_futopt_quotes_live'::text as contract_source,
  'daytrade_stock_future_health_v20260721_compat'::text as contract_version
from public.v_stock_future_live_contract;

create or replace view public.v_fugle_daytrade_stock_future_scorecard as
select * from public.v_fugle_daytrade_stock_future_contract_health;
create or replace view public.v_fugle_daytrade_intraday_1m_today_status as
with rows_today as (
  select *
  from public.fugle_daytrade_intraday_1m
  where trade_date = (now() at time zone 'Asia/Taipei')::date
),
by_symbol as (
  select
    symbol,
    max(market) as market,
    max(candle_time) as latest_candle_time,
    count(*)::integer as today_candle_count,
    count(*) filter (where synthetic is false)::integer as real_candle_count,
    count(*) filter (where synthetic is true)::integer as synthetic_candle_count,
    max(updated_at) as updated_at
  from rows_today
  group by symbol
)
select
  symbol,
  market,
  latest_candle_time,
  to_char(latest_candle_time at time zone 'Asia/Taipei', 'YYYY-MM-DD HH24:MI:SS') as latest_candle_time_taipei,
  today_candle_count,
  real_candle_count,
  synthetic_candle_count,
  today_candle_count > 0 as has_today_data,
  today_candle_count >= 20 as ready_ge_20,
  today_candle_count >= 35 as ready_ge_35,
  today_candle_count >= 80 as ready_ge_80,
  today_candle_count >= 200 as ready_ge_200,
  today_candle_count >= 20 as ready_ma20_continuous,
  today_candle_count >= 35 as ready_ma35_continuous,
  extract(epoch from (now() - latest_candle_time))::integer as latest_candle_age_seconds,
  updated_at,
  'fugle_daytrade_intraday_1m'::text as contract_source,
  'formal_daytrade_1m_today'::text as contract_status
from by_symbol;

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
    ranked.payload || jsonb_build_object(
      'legacy_rpc_contract_status', 'deprecated_delegated_to_fugle_daytrade_intraday_1m',
      'formal_rpc', 'get_fugle_daytrade_intraday_1m_latest_n'
    ) as payload
  from (
    select
      m.*,
      row_number() over (
        partition by m.symbol
        order by m.candle_time desc
      ) as rn
    from public.fugle_daytrade_intraday_1m m
    where m.symbol = any(symbols)
      and m.trade_date = (now() at time zone 'Asia/Taipei')::date
  ) ranked
  where ranked.rn <= greatest(1, least(coalesce(bars_per_symbol, 200), 500))
  order by ranked.symbol asc, ranked.candle_time desc;
$$;

create or replace view public.v_fugle_daytrade_source_status_contract as
with status_row as (
  select source_name, status, updated_at, message, payload
  from public.source_status
  where source_name = 'fugle_daytrade_source'
  order by updated_at desc
  limit 1
),
canonical as (
  select * from public.v_fugle_daytrade_canonical_gate limit 1
),
intraday as (
  select
    count(*)::integer as today_1m_symbol_rows,
    coalesce(sum(today_candle_count), 0)::integer as today_1m_bar_rows,
    max(latest_candle_time) as latest_candle_time,
    count(*) filter (where ready_ge_35)::integer as ready_ge_35_symbols,
    count(*) filter (where ready_ge_80)::integer as ready_ge_80_symbols,
    count(*) filter (where ready_ge_200)::integer as ready_ge_200_symbols
  from public.v_fugle_daytrade_intraday_1m_today_status
),
futopt as (
  select * from public.v_fugle_daytrade_stock_future_contract_health limit 1
)
select
  s.source_name,
  s.status as source_status,
  s.updated_at,
  s.message,
  s.payload,
  coalesce(s.payload ->> 'intraday_1m_status', s.payload ->> 'today_1m_status', case when i.today_1m_symbol_rows > 0 then 'ready' else 'not_ready' end) as intraday_1m_status,
  coalesce(s.payload ->> 'build_id', s.payload ->> 'writer_version', 'daytrade-source-writer') as build_id,
  nullif(s.payload ->> 'writer_pid', '') as writer_pid,
  to_char(i.latest_candle_time at time zone 'Asia/Taipei', 'YYYY-MM-DD HH24:MI:SS') as latest_candle_time_taipei,
  coalesce(nullif(s.payload ->> 'top_movers_1m_ready_count', '')::integer, i.ready_ge_35_symbols, 0) as top_movers_1m_ready_count,
  coalesce(nullif(s.payload ->> 'top_movers_1m_ready80_count', '')::integer, i.ready_ge_80_symbols, 0) as top_movers_1m_ready80_count,
  coalesce(nullif(s.payload ->> 'top_movers_1m_universe_count', '')::integer, nullif(s.payload ->> 'active_symbols', '')::integer, 0) as top_movers_1m_universe_count,
  coalesce(c.txf_ok, false) as txf_ok,
  coalesce(c.futopt_txf_ok, false) as futopt_txf_ok,
  coalesce(f.symbol_rows, c.futopt_contract_rows, 0) as mapped_underlying_count,
  coalesce(i.ready_ge_35_symbols, nullif(s.payload ->> 'ready_ge_35_symbols', '')::integer, nullif(s.payload ->> 'ready_ma35_continuous', '')::integer, 0) as ready_ge_35_symbols,
  coalesce(i.ready_ge_80_symbols, nullif(s.payload ->> 'ready_ge_80_symbols', '')::integer, 0) as ready_ge_80_symbols,
  coalesce(i.ready_ge_200_symbols, nullif(s.payload ->> 'ready_ge_200_symbols', '')::integer, 0) as ready_ge_200_symbols,
  coalesce(nullif(s.payload ->> 'futopt_stock_this_loop', '')::integer, nullif(s.payload ->> 'futopt_stock_quotes_this_loop', '')::integer, c.futopt_ready_rows, 0) as futopt_stock_this_loop,
  coalesce(c.futopt_gate_status, 'not_ready') as futopt_gate_status,
  coalesce(c.futopt_reason, 'not_ready') as futopt_reason,
  coalesce(c.canonical_gate_grade, 'D') as canonical_gate_grade,
  coalesce(c.canonical_gate_status, 'not_ready') as canonical_gate_status,
  coalesce(c.canonical_gate_reason, 'source_contract_not_ready') as canonical_gate_reason,
  coalesce(c.formal_entry_allowed, false) as formal_entry_allowed,
  'v_fugle_daytrade_source_status_contract'::text as contract_view,
  'daytrade_source_status_flat_v20260721'::text as contract_version
from status_row s
left join canonical c on true
left join intraday i on true
left join futopt f on true;

create or replace view public.v_fugle_intraday_1m_contract_notice as
select
  'deprecated_legacy_shared_source'::text as legacy_contract_status,
  'Use fugle_daytrade_intraday_1m, v_fugle_daytrade_intraday_1m_today_status, or get_fugle_daytrade_intraday_1m_latest_n for formal daytrade readiness.'::text as reason,
  'get_fugle_daytrade_intraday_1m_latest_n'::text as formal_rpc,
  'v_fugle_daytrade_intraday_1m_today_status'::text as formal_status_view,
  now() as checked_at;

grant select on public.v_stock_future_live_contract to anon, authenticated, service_role;
grant select on public.v_fugle_daytrade_stock_future_contract_health to anon, authenticated, service_role;
grant select on public.v_fugle_daytrade_stock_future_scorecard to anon, authenticated, service_role;
grant select on public.v_fugle_daytrade_intraday_1m_today_status to anon, authenticated, service_role;
grant select on public.v_fugle_daytrade_source_status_contract to anon, authenticated, service_role;
grant select on public.v_fugle_intraday_1m_contract_notice to anon, authenticated, service_role;
grant execute on function public.get_fugle_intraday_1m_latest_n(text[], integer) to anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;

