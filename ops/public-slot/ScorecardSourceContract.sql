-- Scorecard public source contract.
-- Apply in Supabase SQL Editor for the production public slot.
-- Terminal pipeline:
--   trade_records + strategy_daily_summary
--   -> scripts/export-scorecard-supabase-source.js
--   -> data/scorecard-latest.json
--   -> scorecard_latest snapshot
--   -> /api/scorecard
--   -> /88

create table if not exists public.trade_records (
  record_id text primary key,
  record_date date not null,
  strategy text not null,
  ticker text not null,
  name text,
  entry_time text,
  entry_price numeric,
  high_price numeric,
  pnl numeric,
  source text not null default 'scorecard-source',
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.strategy_daily_summary (
  summary_date date not null,
  strategy text not null,
  signals numeric,
  backtestable numeric,
  wins numeric,
  losses numeric,
  flats numeric,
  win_rate_pct numeric,
  total_pnl numeric,
  avg_pnl numeric,
  max_profit numeric,
  max_loss numeric,
  status text,
  note text,
  source text not null default 'scorecard-source',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (summary_date, strategy)
);

create index if not exists trade_records_date_idx
  on public.trade_records (record_date desc);

create index if not exists trade_records_strategy_date_idx
  on public.trade_records (strategy, record_date desc);

create index if not exists trade_records_ticker_idx
  on public.trade_records (ticker);

create index if not exists strategy_daily_summary_date_idx
  on public.strategy_daily_summary (summary_date desc);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trade_records_touch_updated_at on public.trade_records;
create trigger trade_records_touch_updated_at
before update on public.trade_records
for each row execute function public.touch_updated_at();

drop trigger if exists strategy_daily_summary_touch_updated_at on public.strategy_daily_summary;
create trigger strategy_daily_summary_touch_updated_at
before update on public.strategy_daily_summary
for each row execute function public.touch_updated_at();

create or replace function public.prune_trade_records()
returns void
language sql
as $$
  delete from public.trade_records
  where
    (strategy = '策略4成績單' and record_date < current_date - interval '30 days')
    or
    (strategy <> '策略4成績單' and record_date < current_date - interval '7 days');
$$;

create or replace view public.v_scorecard_source_health as
with records as (
  select
    max(record_date) as latest_record_date,
    count(*) as record_count,
    count(*) filter (where record_date >= current_date - interval '2 days') as recent_record_count,
    count(*) filter (where coalesce(source, '') = '') as missing_record_source_count
  from public.trade_records
),
daily as (
  select
    max(summary_date) as latest_summary_date,
    count(*) as summary_count,
    count(*) filter (where summary_date >= current_date - interval '2 days') as recent_summary_count,
    count(*) filter (where coalesce(source, '') = '') as missing_summary_source_count
  from public.strategy_daily_summary
)
select
  case
    when coalesce(records.record_count, 0) = 0 then 'not_ready'
    when coalesce(daily.summary_count, 0) = 0 then 'not_ready'
    when records.latest_record_date < current_date - interval '2 days' then 'stale'
    when daily.latest_summary_date < current_date - interval '2 days' then 'stale'
    when coalesce(records.missing_record_source_count, 0) > 0 then 'failed'
    when coalesce(daily.missing_summary_source_count, 0) > 0 then 'failed'
    else 'ready'
  end as status,
  records.latest_record_date,
  daily.latest_summary_date,
  records.record_count,
  daily.summary_count,
  records.recent_record_count,
  daily.recent_summary_count,
  records.missing_record_source_count,
  daily.missing_summary_source_count,
  now() as checked_at,
  case
    when coalesce(records.record_count, 0) = 0 then 'trade_records has no rows'
    when coalesce(daily.summary_count, 0) = 0 then 'strategy_daily_summary has no rows'
    when records.latest_record_date < current_date - interval '2 days' then 'trade_records latest date is stale'
    when daily.latest_summary_date < current_date - interval '2 days' then 'strategy_daily_summary latest date is stale'
    when coalesce(records.missing_record_source_count, 0) > 0 then 'trade_records rows are missing source'
    when coalesce(daily.missing_summary_source_count, 0) > 0 then 'strategy_daily_summary rows are missing source'
    else 'ready'
  end as reason
from records, daily;

alter table public.trade_records enable row level security;
alter table public.strategy_daily_summary enable row level security;

drop policy if exists "public read scorecard trade records" on public.trade_records;
create policy "public read scorecard trade records"
on public.trade_records
for select
using (true);

drop policy if exists "public read scorecard summaries" on public.strategy_daily_summary;
create policy "public read scorecard summaries"
on public.strategy_daily_summary
for select
using (true);
