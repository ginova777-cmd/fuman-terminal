-- Strategy3 V2 clean chain schema contract
-- contract: strategy3-v2-clean-chain-v1
-- purpose: isolate rebuilt Strategy3 V2 from legacy Strategy3 tables and workspaces.

create table if not exists public.strategy3_v2_scan_runs (
  id bigserial primary key,
  run_id text not null unique,
  trade_date date not null,
  strategy text not null default 'strategy3_v2',
  contract text not null default 'strategy3-v2-clean-chain-v1',
  status text not null,
  complete boolean not null default false,
  formal_allowed boolean not null default false,
  publish_allowed boolean not null default false,
  line_allowed boolean not null default false,
  source_chain jsonb not null default '{}'::jsonb,
  readiness jsonb not null default '{}'::jsonb,
  coverage jsonb not null default '{}'::jsonb,
  issues jsonb not null default '[]'::jsonb,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.strategy3_v2_scan_results (
  id bigserial primary key,
  run_id text not null references public.strategy3_v2_scan_runs(run_id) on delete cascade,
  trade_date date not null,
  rank integer not null,
  code text not null,
  name text,
  entry_price numeric,
  entry_price_source text not null default 'intraday_1m',
  entry_window_start text,
  entry_window_end text,
  change_percent numeric,
  volume_ratio numeric,
  score numeric,
  quality_status text not null default 'watchlist_only',
  complete boolean not null default false,
  formal_allowed boolean not null default false,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists strategy3_v2_scan_runs_trade_date_idx
  on public.strategy3_v2_scan_runs(trade_date, created_at desc);

create index if not exists strategy3_v2_scan_results_trade_rank_idx
  on public.strategy3_v2_scan_results(trade_date, rank);

create index if not exists strategy3_v2_scan_results_run_id_idx
  on public.strategy3_v2_scan_results(run_id);

create index if not exists strategy3_v2_scan_results_code_trade_date_idx
  on public.strategy3_v2_scan_results(code, trade_date);

create or replace view public.v_strategy3_v2_latest_complete_run as
select *
from public.strategy3_v2_scan_runs
where strategy = 'strategy3_v2'
  and contract = 'strategy3-v2-clean-chain-v1'
  and complete = true
  and status = 'complete'
order by finished_at desc nulls last, created_at desc
limit 1;