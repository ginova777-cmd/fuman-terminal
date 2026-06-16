-- FinMind chip data and intraday 1m fallback, 2026-06-16.
-- Run after FinMindSupplementalSource.sql and FinMindUnifiedDailyUniverse.sql.

create table if not exists public.finmind_institutional_flows (
  symbol text not null,
  trade_date date not null,
  name text,
  foreign_buy numeric,
  foreign_sell numeric,
  foreign_net numeric,
  investment_trust_buy numeric,
  investment_trust_sell numeric,
  investment_trust_net numeric,
  dealer_buy numeric,
  dealer_sell numeric,
  dealer_net numeric,
  total_net numeric,
  source text not null default 'finmind:TaiwanStockInstitutionalInvestorsBuySell',
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (symbol, trade_date)
);

create table if not exists public.finmind_margin_short (
  symbol text not null,
  trade_date date not null,
  name text,
  margin_buy numeric,
  margin_sell numeric,
  margin_cash_repayment numeric,
  margin_balance numeric,
  short_sell numeric,
  short_buy numeric,
  short_cash_repayment numeric,
  short_balance numeric,
  source text not null default 'finmind:TaiwanStockMarginPurchaseShortSale',
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (symbol, trade_date)
);

create table if not exists public.finmind_chip_raw (
  dataset text not null,
  symbol text not null,
  trade_date date not null,
  actor text not null default '',
  name text,
  buy numeric,
  sell numeric,
  net numeric,
  source text not null default 'finmind',
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (dataset, symbol, trade_date, actor)
);

create table if not exists public.finmind_intraday_1m (
  symbol text not null,
  candle_time timestamptz not null,
  trade_date date not null,
  open numeric,
  high numeric,
  low numeric,
  close numeric,
  volume numeric,
  volume_shares numeric,
  source text not null default 'finmind:TaiwanStockKBar',
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (symbol, candle_time)
);

create index if not exists idx_finmind_institutional_flows_date
  on public.finmind_institutional_flows (trade_date desc, symbol);

create index if not exists idx_finmind_margin_short_date
  on public.finmind_margin_short (trade_date desc, symbol);

create index if not exists idx_finmind_chip_raw_dataset_date
  on public.finmind_chip_raw (dataset, trade_date desc, symbol);

create index if not exists idx_finmind_intraday_1m_symbol_time
  on public.finmind_intraday_1m (symbol, candle_time desc);

create index if not exists idx_finmind_intraday_1m_trade_date
  on public.finmind_intraday_1m (trade_date desc);

alter table public.finmind_institutional_flows enable row level security;
alter table public.finmind_margin_short enable row level security;
alter table public.finmind_chip_raw enable row level security;
alter table public.finmind_intraday_1m enable row level security;

drop policy if exists "read finmind institutional flows" on public.finmind_institutional_flows;
create policy "read finmind institutional flows"
on public.finmind_institutional_flows for select to anon using (true);

drop policy if exists "read finmind margin short" on public.finmind_margin_short;
create policy "read finmind margin short"
on public.finmind_margin_short for select to anon using (true);

drop policy if exists "read finmind chip raw" on public.finmind_chip_raw;
create policy "read finmind chip raw"
on public.finmind_chip_raw for select to anon using (true);

drop policy if exists "read finmind intraday 1m" on public.finmind_intraday_1m;
create policy "read finmind intraday 1m"
on public.finmind_intraday_1m for select to anon using (true);

grant select on public.finmind_institutional_flows to anon;
grant select on public.finmind_margin_short to anon;
grant select on public.finmind_chip_raw to anon;
grant select on public.finmind_intraday_1m to anon;
grant select, insert, update, delete on public.finmind_institutional_flows to service_role;
grant select, insert, update, delete on public.finmind_margin_short to service_role;
grant select, insert, update, delete on public.finmind_chip_raw to service_role;
grant select, insert, update, delete on public.finmind_intraday_1m to service_role;

create or replace view public.v_chip_flows_unified as
select
  coalesce(i.symbol, m.symbol) as symbol,
  coalesce(i.trade_date, m.trade_date) as trade_date,
  coalesce(i.name, m.name) as name,
  i.foreign_buy,
  i.foreign_sell,
  i.foreign_net,
  i.investment_trust_buy,
  i.investment_trust_sell,
  i.investment_trust_net,
  i.dealer_buy,
  i.dealer_sell,
  i.dealer_net,
  i.total_net as institution_total_net,
  m.margin_buy,
  m.margin_sell,
  m.margin_cash_repayment,
  m.margin_balance,
  m.short_sell,
  m.short_buy,
  m.short_cash_repayment,
  m.short_balance,
  case
    when i.symbol is not null and m.symbol is not null then 'finmind:institution+margin'
    when i.symbol is not null then i.source
    when m.symbol is not null then m.source
    else 'unknown'
  end as source,
  greatest(coalesce(i.updated_at, '-infinity'::timestamptz), coalesce(m.updated_at, '-infinity'::timestamptz)) as updated_at,
  jsonb_build_object('institution', i.payload, 'margin', m.payload) as payload
from public.finmind_institutional_flows i
full outer join public.finmind_margin_short m
  on m.symbol = i.symbol
 and m.trade_date = i.trade_date
where coalesce(i.symbol, m.symbol) ~ '^[0-9]{4}$';

create or replace view public.v_chip_flows_latest as
select *
from (
  select
    c.*,
    row_number() over (partition by symbol order by trade_date desc, updated_at desc) as rn
  from public.v_chip_flows_unified c
) ranked
where rn = 1;

create or replace view public.v_intraday_1m_unified as
with candidates as (
  select
    symbol,
    candle_time,
    trade_date,
    open,
    high,
    low,
    close,
    volume,
    volume * 1000 as volume_shares,
    'fugle_intraday_1m'::text as source,
    updated_at,
    payload,
    1 as source_priority
  from public.fugle_intraday_1m
  where symbol ~ '^[0-9]{4}$'

  union all

  select
    symbol,
    candle_time,
    trade_date,
    open,
    high,
    low,
    close,
    volume,
    volume_shares,
    source,
    updated_at,
    payload,
    2 as source_priority
  from public.finmind_intraday_1m
  where symbol ~ '^[0-9]{4}$'
),
ranked as (
  select
    *,
    row_number() over (
      partition by symbol, candle_time
      order by source_priority asc, updated_at desc
    ) as rn
  from candidates
)
select
  symbol,
  candle_time,
  trade_date,
  open,
  high,
  low,
  close,
  volume,
  volume_shares,
  source,
  updated_at,
  payload
from ranked
where rn = 1;

create or replace view public.v_intraday_1m_unified_status as
select
  symbol,
  max(candle_time) as latest_candle_time,
  count(*)::integer as today_candle_count,
  count(*)::integer as candle_count,
  (count(*) >= 35) as ready_ge_35,
  max(updated_at) as updated_at,
  max(source) as source
from public.v_intraday_1m_unified
where trade_date = (now() at time zone 'Asia/Taipei')::date
group by symbol;

create or replace function public.get_strategy2_intraday_1m_latest_n(
  symbols text[],
  bars_per_symbol integer default 200
)
returns table (
  symbol text,
  candle_time timestamptz,
  open numeric,
  high numeric,
  low numeric,
  close numeric,
  volume numeric,
  trade_date date
)
language sql
stable
as $$
  select
    ranked.symbol,
    ranked.candle_time,
    ranked.open,
    ranked.high,
    ranked.low,
    ranked.close,
    ranked.volume,
    ranked.trade_date
  from (
    select
      m.symbol,
      m.candle_time,
      m.open,
      m.high,
      m.low,
      m.close,
      m.volume,
      m.trade_date,
      row_number() over (
        partition by m.symbol
        order by m.candle_time desc
      ) as rn
    from public.v_intraday_1m_unified m
    where m.symbol = any(symbols)
  ) ranked
  where ranked.rn <= greatest(1, least(coalesce(bars_per_symbol, 200), 500))
  order by ranked.symbol asc, ranked.candle_time desc;
$$;

grant select on public.v_chip_flows_unified to anon;
grant select on public.v_chip_flows_unified to service_role;
grant select on public.v_chip_flows_latest to anon;
grant select on public.v_chip_flows_latest to service_role;
grant select on public.v_intraday_1m_unified to anon;
grant select on public.v_intraday_1m_unified to service_role;
grant select on public.v_intraday_1m_unified_status to anon;
grant select on public.v_intraday_1m_unified_status to service_role;
grant execute on function public.get_strategy2_intraday_1m_latest_n(text[], integer) to anon;
grant execute on function public.get_strategy2_intraday_1m_latest_n(text[], integer) to service_role;

notify pgrst, 'reload schema';
