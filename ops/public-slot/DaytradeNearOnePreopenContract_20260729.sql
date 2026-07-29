-- Dedicated daytrade near-one and preopen time-series source contract.
-- Run after the existing daytrade dedicated tables. Safe to run repeatedly.
-- This source contract is read by PS1/viewers; readers must not infer a
-- contract month from a symbol or from the latest shared view.

begin;

create table if not exists public.fugle_daytrade_canonical_near_one_contracts (
  trade_date date not null,
  symbol text not null,
  fut_contract text not null,
  contract_month text,
  expiry_date date,
  is_near_one boolean not null default true,
  resolved_at timestamptz not null default now(),
  source text not null default 'fugle_daytrade_source:canonical_near_one',
  payload jsonb not null default '{}'::jsonb,
  primary key (trade_date, symbol)
);

create index if not exists idx_daytrade_near_one_trade_symbol
  on public.fugle_daytrade_canonical_near_one_contracts(trade_date, symbol);
create index if not exists idx_daytrade_near_one_expiry
  on public.fugle_daytrade_canonical_near_one_contracts(trade_date, expiry_date);

create table if not exists public.fugle_daytrade_preopen_futopt_snapshots (
  trade_date date not null,
  capture_slot text not null,
  underlying_symbol text not null,
  fut_contract text not null,
  contract_month text,
  expiry_date date,
  captured_at timestamptz not null,
  fut_price numeric,
  fut_change_pct numeric,
  fut_volume numeric,
  trial_price numeric,
  trial_change_pct numeric,
  best_bid numeric,
  best_ask numeric,
  bid_ask_ratio numeric,
  natural_schedule_evidence boolean not null default false,
  source text not null default 'fugle_daytrade_source:preopen_snapshot',
  payload jsonb not null default '{}'::jsonb,
  primary key (trade_date, capture_slot, underlying_symbol),
  constraint daytrade_preopen_capture_slot_ck
    check (capture_slot in ('0845', '0850', '0855', '0859'))
);

create index if not exists idx_daytrade_preopen_snapshots_date_slot
  on public.fugle_daytrade_preopen_futopt_snapshots(trade_date, capture_slot, underlying_symbol);
create index if not exists idx_daytrade_preopen_snapshots_captured
  on public.fugle_daytrade_preopen_futopt_snapshots(captured_at desc);

create or replace view public.v_fugle_daytrade_near_one_contract as
select
  trade_date,
  symbol,
  fut_contract,
  contract_month,
  expiry_date,
  is_near_one,
  resolved_at,
  source,
  payload
from public.fugle_daytrade_canonical_near_one_contracts
where is_near_one = true;

create or replace view public.v_fugle_daytrade_preopen_snapshot_contract as
select
  trade_date,
  capture_slot,
  underlying_symbol,
  fut_contract,
  contract_month,
  expiry_date,
  captured_at,
  fut_price,
  fut_change_pct,
  fut_volume,
  trial_price,
  trial_change_pct,
  best_bid,
  best_ask,
  bid_ask_ratio,
  natural_schedule_evidence,
  source,
  payload
from public.fugle_daytrade_preopen_futopt_snapshots;

create or replace view public.v_fugle_daytrade_inverse_convergence as
with pivot as (
  select
    trade_date,
    underlying_symbol,
    max(fut_contract) filter (where capture_slot = '0845') as fut_contract_0845,
    max(fut_contract) filter (where capture_slot = '0859') as fut_contract_0859,
    max(contract_month) filter (where capture_slot = '0845') as contract_month_0845,
    max(expiry_date) filter (where capture_slot = '0845') as expiry_date_0845,
    max(fut_price) filter (where capture_slot = '0845') as fut_price_0845,
    max(fut_price) filter (where capture_slot = '0859') as fut_price_0859,
    max(fut_change_pct) filter (where capture_slot = '0845') as fut_change_pct_0845,
    max(fut_change_pct) filter (where capture_slot = '0859') as fut_change_pct_0859,
    max(fut_volume) filter (where capture_slot = '0845') as fut_volume_0845,
    max(fut_volume) filter (where capture_slot = '0859') as fut_volume_0859,
    max(trial_price) filter (where capture_slot = '0845') as trial_price_0845,
    max(trial_price) filter (where capture_slot = '0859') as trial_price_0859,
    max(trial_change_pct) filter (where capture_slot = '0845') as trial_change_pct_0845,
    max(trial_change_pct) filter (where capture_slot = '0859') as trial_change_pct_0859,
    max(best_bid) filter (where capture_slot = '0845') as best_bid_0845,
    max(best_bid) filter (where capture_slot = '0859') as best_bid_0859,
    max(best_ask) filter (where capture_slot = '0845') as best_ask_0845,
    max(best_ask) filter (where capture_slot = '0859') as best_ask_0859,
    max(bid_ask_ratio) filter (where capture_slot = '0845') as bid_ask_ratio_0845,
    max(bid_ask_ratio) filter (where capture_slot = '0859') as bid_ask_ratio_0859,
    count(*) filter (where capture_slot in ('0845', '0850', '0855', '0859'))::integer as snapshot_count,
    bool_and(natural_schedule_evidence) filter (where capture_slot in ('0845', '0850', '0855', '0859')) as natural_schedule_evidence
  from public.fugle_daytrade_preopen_futopt_snapshots
  group by trade_date, underlying_symbol
)
select
  trade_date,
  underlying_symbol,
  fut_contract_0845,
  fut_contract_0859,
  contract_month_0845,
  expiry_date_0845,
  fut_price_0845,
  fut_price_0859,
  fut_change_pct_0845,
  fut_change_pct_0859,
  fut_volume_0845,
  fut_volume_0859,
  trial_price_0845,
  trial_price_0859,
  trial_change_pct_0845,
  trial_change_pct_0859,
  best_bid_0845,
  best_bid_0859,
  best_ask_0845,
  best_ask_0859,
  bid_ask_ratio_0845,
  bid_ask_ratio_0859,
  snapshot_count,
  natural_schedule_evidence,
  case
    when fut_price_0845 is null
      or trial_price_0845 is null
      or fut_price_0859 is null
      or trial_price_0859 is null
    then 'INCOMPLETE'
    else 'READY'
  end as basis_status,
  case
    when fut_price_0845 is null
      or trial_price_0845 is null
      or fut_price_0859 is null
      or trial_price_0859 is null
    then null::boolean
    else (
      (fut_price_0845 - trial_price_0845) < 0
      and (fut_price_0859 - trial_price_0859) < 0
      and abs(fut_price_0859 - trial_price_0859) < abs(fut_price_0845 - trial_price_0845)
    )
  end as inverse_convergence,
  case when fut_price_0845 is not null and trial_price_0845 is not null
    then fut_price_0845 - trial_price_0845 end as basis_0845,
  case when fut_price_0859 is not null and trial_price_0859 is not null
    then fut_price_0859 - trial_price_0859 end as basis_0859
from pivot;

grant select on public.fugle_daytrade_canonical_near_one_contracts to anon, authenticated, service_role;
grant select, insert, update on public.fugle_daytrade_canonical_near_one_contracts to service_role;
grant select on public.fugle_daytrade_preopen_futopt_snapshots to anon, authenticated, service_role;
grant select, insert, update on public.fugle_daytrade_preopen_futopt_snapshots to service_role;
grant select on public.v_fugle_daytrade_near_one_contract to anon, authenticated, service_role;
grant select on public.v_fugle_daytrade_preopen_snapshot_contract to anon, authenticated, service_role;
grant select on public.v_fugle_daytrade_inverse_convergence to anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;
