-- Seven Strategy daily history contract for /88 SourceReports.
-- Purpose: store official post-close aggregation of PS1 formal entries and detected/observation records.
-- Safe to run repeatedly in Supabase SQL Editor.

begin;

create table if not exists public.seven_strategy_daily_history (
  id bigserial primary key,
  trade_date date not null,
  detect_time time without time zone not null,
  symbol text not null,
  name text not null,
  entry_price numeric not null,
  current_price numeric,
  change_percent numeric,
  score numeric,
  strategy text not null,
  signal_type text not null,
  source text not null default 'seven_strategy_daily_history',
  run_id text,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint seven_strategy_daily_history_symbol_not_blank
    check (btrim(symbol) <> ''),
  constraint seven_strategy_daily_history_name_not_blank
    check (btrim(name) <> ''),
  constraint seven_strategy_daily_history_strategy_not_blank
    check (btrim(strategy) <> ''),
  constraint seven_strategy_daily_history_signal_type
    check (signal_type in ('formal', 'detected')),
  constraint seven_strategy_daily_history_regular_session
    check (detect_time >= time '09:00:00' and detect_time <= time '13:30:00'),
  constraint seven_strategy_daily_history_no_replay
    check (
      position('replay' in lower(coalesce(source, '') || ' ' || coalesce(strategy, '') || ' ' || coalesce(signal_type, ''))) = 0
    )
);

create index if not exists idx_seven_strategy_daily_history_today_latest
  on public.seven_strategy_daily_history(trade_date desc, detect_time desc, updated_at desc);

create index if not exists idx_seven_strategy_daily_history_strategy_latest
  on public.seven_strategy_daily_history(strategy, trade_date desc, detect_time desc);

create index if not exists idx_seven_strategy_daily_history_signal_type
  on public.seven_strategy_daily_history(trade_date desc, signal_type, detect_time desc);

create unique index if not exists uq_seven_strategy_daily_history_record
  on public.seven_strategy_daily_history(trade_date, detect_time, symbol, strategy, signal_type, source);

alter table public.seven_strategy_daily_history enable row level security;

drop policy if exists "read seven strategy daily history" on public.seven_strategy_daily_history;
create policy "read seven strategy daily history"
  on public.seven_strategy_daily_history
  for select
  to anon, authenticated
  using (true);

drop policy if exists "service manage seven strategy daily history" on public.seven_strategy_daily_history;
create policy "service manage seven strategy daily history"
  on public.seven_strategy_daily_history
  for all
  to service_role
  using (true)
  with check (true);

grant select on public.seven_strategy_daily_history to anon, authenticated;
grant all on public.seven_strategy_daily_history to service_role;
grant usage, select on sequence public.seven_strategy_daily_history_id_seq to service_role;

commit;
