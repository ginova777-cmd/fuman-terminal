begin;

-- Ticket 1: dedicated daytrade futures contract for near-one/basis/convergence.
-- This is additive. It does not replace existing views, drop dependencies, or
-- change the daytrade formal gate by itself.

create table if not exists public.fugle_daytrade_futopt_preopen_baseline (
  trade_date date not null,
  underlying_symbol text not null,
  future_symbol text not null,
  baseline_price numeric,
  baseline_change_percent numeric,
  baseline_total_volume numeric,
  baseline_observed_at timestamptz,
  captured_at timestamptz not null default now(),
  source text not null default 'fugle_daytrade_futopt_quotes_live',
  capture_window text not null default '0845_natural',
  payload jsonb not null default '{}'::jsonb,
  primary key (trade_date, underlying_symbol)
);

create index if not exists idx_daytrade_futopt_preopen_baseline_date_symbol
  on public.fugle_daytrade_futopt_preopen_baseline (trade_date, underlying_symbol);

create index if not exists idx_daytrade_futopt_preopen_baseline_date_future
  on public.fugle_daytrade_futopt_preopen_baseline (trade_date, future_symbol);

alter table public.fugle_daytrade_futopt_preopen_baseline enable row level security;
grant select on public.fugle_daytrade_futopt_preopen_baseline to anon, authenticated;
grant select, insert, update, delete on public.fugle_daytrade_futopt_preopen_baseline to service_role;

-- One current, non-expired stock-futures contract per underlying. The source
-- table is historical/live mixed, so date and row_number filtering are part of
-- the contract and must remain in the canonical read path.
create or replace view public.v_fugle_daytrade_stock_future_near_one_contract as
with clock as (
  select (now() at time zone 'Asia/Taipei')::date as trade_date
), ticker_meta as (
  select distinct on (t.future_symbol)
    t.future_symbol,
    t.name as future_name,
    t.contract_type,
    t.product as ticker_product,
    case
      when nullif(t.end_date::text, '') ~ '^\d{4}-\d{2}-\d{2}$' then t.end_date::date
      when nullif(t.end_date::text, '') ~ '^\d{8}$' then to_date(t.end_date::text, 'YYYYMMDD')
      when nullif(t.payload ->> 'CDate', '') ~ '^\d{8}$' then to_date(t.payload ->> 'CDate', 'YYYYMMDD')
      else null
    end as contract_end_date,
    t.exchange,
    t.underlying_name as ticker_underlying_name,
    t.underlying_symbol as ticker_underlying_symbol,
    t.session as ticker_session,
    t.updated_at as ticker_updated_at
  from public.futopt_tickers t
  where t.future_symbol is not null
  order by t.future_symbol, t.updated_at desc nulls last
), raw as (
  select
    q.future_symbol,
    c.trade_date,
    coalesce(nullif(q.underlying_symbol, ''), nullif(q.payload ->> 'underlying_symbol', '')) as underlying_symbol,
    coalesce(nullif(q.underlying_name, ''), nullif(q.payload ->> 'underlying_name', ''), nullif(q.payload ->> 'name', '')) as underlying_name,
    coalesce(nullif(q.product, ''), nullif(q.payload ->> 'product', '')) as quote_product,
    q.last_price,
    q.change_percent,
    q.total_volume,
    q.updated_at,
    q.source,
    q.payload,
    tm.future_name,
    tm.contract_type,
    tm.ticker_product,
    tm.contract_end_date,
    tm.exchange,
    tm.ticker_underlying_name,
    tm.ticker_underlying_symbol,
    tm.ticker_session,
    tm.ticker_updated_at
  from public.fugle_daytrade_futopt_quotes_live q
  left join ticker_meta tm on tm.future_symbol = q.future_symbol
  cross join clock c
  where q.future_symbol is not null
    and coalesce(nullif(q.underlying_symbol, ''), nullif(q.payload ->> 'underlying_symbol', '')) ~ '^\d{4}$'
    and upper(coalesce(nullif(q.product, ''), nullif(q.payload ->> 'product', ''), 'STOCK_FUTURE')) in ('S', 'STOCK_FUTURE')
    and (q.updated_at at time zone 'Asia/Taipei')::date = c.trade_date
    and (tm.contract_end_date is null or tm.contract_end_date >= c.trade_date)
), ranked as (
  select
    r.*,
    row_number() over (
      partition by r.underlying_symbol
      order by
        case when r.contract_end_date is null then 1 else 0 end,
        r.contract_end_date asc nulls last,
        r.updated_at desc nulls last,
        r.future_symbol asc
    ) as rn
  from raw r
), txf as (
  select
    q.future_symbol as txf_future_symbol,
    q.last_price as txf_last_price,
    q.change_percent as txf_change_percent,
    q.total_volume as txf_total_volume,
    q.updated_at as txf_updated_at
  from public.fugle_daytrade_futopt_quotes_live q
  cross join clock c
  where upper(coalesce(nullif(q.product, ''), nullif(q.payload ->> 'product', ''), '')) = 'TXF'
    and (q.updated_at at time zone 'Asia/Taipei')::date = c.trade_date
  order by q.updated_at desc nulls last, q.future_symbol asc
  limit 1
), chosen as (
  select r.*
  from ranked r
  where r.rn = 1
)
select
  c.trade_date,
  c.underlying_symbol,
  coalesce(nullif(c.underlying_name, ''), nullif(c.ticker_underlying_name, ''), c.ticker_underlying_symbol, c.underlying_symbol) as underlying_name,
  c.future_symbol,
  c.future_name,
  c.contract_type,
  c.contract_end_date,
  c.exchange,
  c.ticker_session,
  c.last_price,
  c.change_percent,
  c.total_volume,
  c.updated_at,
  c.source as contract_source,
  'fugle_daytrade_futopt_quotes_live'::text as formal_quote_source,
  case
    when c.contract_end_date is null then 'current_live_expiry_unknown'
    when c.contract_end_date >= c.trade_date then 'current_live_valid'
    else 'expired'
  end as near_contract_status,
  extract(epoch from (now() - c.updated_at))::integer as quote_age_seconds,
  tx.txf_future_symbol,
  tx.txf_last_price,
  tx.txf_change_percent,
  tx.txf_total_volume,
  tx.txf_updated_at,
  c.change_percent - coalesce(tx.txf_change_percent, 0) as relative_to_txf_percent,
  case
    when tx.txf_updated_at is null then 'txf_missing'
    when extract(epoch from (now() - tx.txf_updated_at)) > 180 then 'txf_stale'
    else 'ready'
  end as txf_status
from chosen c
left join txf tx on true;

create or replace view public.v_fugle_daytrade_futopt_preopen_baseline as
with clock as (
  select
    (now() at time zone 'Asia/Taipei')::date as trade_date,
    now() as checked_at
)
select
  b.trade_date,
  b.underlying_symbol,
  b.future_symbol,
  b.baseline_price,
  b.baseline_change_percent,
  b.baseline_total_volume,
  b.baseline_observed_at,
  b.captured_at,
  b.source,
  b.capture_window,
  extract(epoch from (c.checked_at - b.captured_at))::integer as baseline_age_seconds,
  case
    when b.trade_date <> c.trade_date then 'stale_trade_date'
    when b.baseline_observed_at is null then 'baseline_observed_at_missing'
    when (b.baseline_observed_at at time zone 'Asia/Taipei')::time < time '08:45' then 'before_0845'
    else 'ready'
  end as baseline_status,
  case when b.trade_date = c.trade_date
    and b.baseline_observed_at is not null
    and (b.baseline_observed_at at time zone 'Asia/Taipei')::time >= time '08:45'
    then true else false end as natural_0845_baseline_ready,
  b.payload
from public.fugle_daytrade_futopt_preopen_baseline b
cross join clock c;

create or replace view public.v_fugle_daytrade_futopt_basis_current as
select
  n.trade_date,
  n.underlying_symbol,
  n.underlying_name,
  n.future_symbol,
  n.contract_end_date,
  n.near_contract_status,
  n.last_price as future_price,
  n.change_percent as future_change_percent,
  n.total_volume as future_total_volume,
  n.updated_at as future_updated_at,
  n.txf_future_symbol,
  n.txf_last_price,
  n.txf_change_percent,
  n.txf_updated_at,
  n.relative_to_txf_percent,
  b.baseline_price,
  b.baseline_observed_at,
  b.baseline_status,
  b.natural_0845_baseline_ready,
  case when n.last_price is not null and n.txf_last_price > 0
    then (n.last_price - n.txf_last_price) / n.txf_last_price * 100
    else null end as basis_percent,
  case when b.natural_0845_baseline_ready and b.baseline_price > 0 and n.last_price is not null
    then (n.last_price - b.baseline_price) / b.baseline_price * 100
    else null end as convergence_from_0845_percent,
  case when not b.natural_0845_baseline_ready then 'baseline_missing'
    when n.last_price is null then 'current_future_quote_missing'
    else 'ready' end as convergence_status,
  n.formal_quote_source
from public.v_fugle_daytrade_stock_future_near_one_contract n
left join public.v_fugle_daytrade_futopt_preopen_baseline b
  on b.trade_date = n.trade_date
 and b.underlying_symbol = n.underlying_symbol;

comment on view public.v_fugle_daytrade_stock_future_near_one_contract is
  'Ticket 1 canonical current-day unique non-expired stock-futures contract; never use raw historical rows directly.';
comment on view public.v_fugle_daytrade_futopt_preopen_baseline is
  'Ticket 1 natural 08:45 futures baseline; missing baseline must remain explicit and block convergence claims.';
comment on view public.v_fugle_daytrade_futopt_basis_current is
  'Ticket 1 basis and convergence read path: current near-one plus same-day 08:45 baseline.';

grant select on public.v_fugle_daytrade_stock_future_near_one_contract to anon, authenticated;
grant select on public.v_fugle_daytrade_futopt_preopen_baseline to anon, authenticated;
grant select on public.v_fugle_daytrade_futopt_basis_current to anon, authenticated;

notify pgrst, 'reload schema';
commit;
