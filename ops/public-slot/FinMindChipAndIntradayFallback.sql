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

create or replace view public.v_finmind_branch_flows_latest as
with branch_rows as (
  select
    symbol,
    trade_date,
    actor,
    coalesce(nullif(payload ->> 'securities_trader', ''), actor) as branch_name,
    buy,
    sell,
    coalesce(net, buy - sell) as net,
    source,
    updated_at
  from public.finmind_chip_raw
  where dataset = 'TaiwanStockTradingDailyReport'
    and symbol ~ '^[0-9]{4}$'
),
latest_date as (
  select symbol, max(trade_date) as trade_date
  from branch_rows
  group by symbol
),
latest_rows as (
  select b.*
  from branch_rows b
  join latest_date d
    on d.symbol = b.symbol
   and d.trade_date = b.trade_date
),
ranked as (
  select
    *,
    row_number() over (partition by symbol order by net desc, buy desc) as buy_rank,
    row_number() over (partition by symbol order by net asc, sell desc) as sell_rank
  from latest_rows
)
select
  symbol,
  trade_date,
  sum(buy) as branch_buy,
  sum(sell) as branch_sell,
  sum(net) as branch_net_buy,
  coalesce(sum(net) filter (where buy_rank <= 15 and net > 0), 0)
    - abs(coalesce(sum(net) filter (where sell_rank <= 15 and net < 0), 0)) as main_force_branch_net_buy,
  count(*) filter (where buy > 0) as branch_buy_count,
  count(*) filter (where sell > 0) as branch_sell_count,
  coalesce(sum(net) filter (where buy_rank <= 15 and net > 0), 0) as top_branch_net_buy,
  abs(coalesce(sum(net) filter (where sell_rank <= 15 and net < 0), 0)) as top_branch_net_sell,
  count(*) filter (where buy_rank <= 15 and net > 0) as top_branch_count,
  case
    when sum(buy) > 0 then coalesce(sum(net) filter (where buy_rank <= 15 and net > 0), 0) / sum(buy)
    else 0
  end as branch_concentration_ratio,
  least(100, greatest(0,
    round(
      coalesce(sum(net) filter (where buy_rank <= 15 and net > 0), 0) / greatest(sum(buy), 1) * 70
      + least(count(*) filter (where buy_rank <= 15 and net > 0), 15) * 2
    )
  )) as branch_power_score,
  case
    when coalesce(sum(net) filter (where buy_rank <= 15 and net > 0), 0) > abs(coalesce(sum(net) filter (where sell_rank <= 15 and net < 0), 0))
      and sum(net) > 0 then 'branch_net_buy'
    when sum(net) > 0 then 'branch_mild_buy'
    when sum(net) < 0 then 'branch_net_sell'
    else 'branch_neutral'
  end as branch_status,
  'finmind:TaiwanStockTradingDailyReport'::text as source,
  max(updated_at) as updated_at,
  jsonb_agg(
    jsonb_build_object(
      'rank', buy_rank,
      'branchId', actor,
      'branchName', branch_name,
      'buy', buy,
      'sell', sell,
      'net', net
    )
    order by buy_rank
  ) filter (where buy_rank <= 15) as top_buy_branches
from ranked
group by symbol, trade_date;

grant select on public.v_finmind_branch_flows_latest to anon;
grant select on public.v_finmind_branch_flows_latest to service_role;

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
