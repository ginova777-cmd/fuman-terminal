-- Seven Strategy daily history contract for /88 SourceReports.
-- Purpose: store official post-close aggregation of PS1 formal entries and detected/observation records.
-- Safe to run repeatedly in Supabase SQL Editor.

begin;

create table if not exists public.seven_strategy_daily_history (
  id bigserial primary key,
  trade_date date not null,
  detect_time time without time zone not null,
  entry_time time without time zone,
  symbol text not null,
  name text not null,
  entry_price numeric not null,
  current_price numeric,
  change_percent numeric,
  score numeric,
  strategy text not null,
  strategy_label text,
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
    check (coalesce(detect_time, entry_time) >= time '09:00:00' and coalesce(detect_time, entry_time) <= time '13:30:00'),
  constraint seven_strategy_daily_history_no_replay
    check (
      position('replay' in lower(coalesce(source, '') || ' ' || coalesce(strategy, '') || ' ' || coalesce(signal_type, ''))) = 0
    )
);

alter table public.seven_strategy_daily_history
  add column if not exists entry_time time without time zone;

alter table public.seven_strategy_daily_history
  add column if not exists strategy_label text;

update public.seven_strategy_daily_history
set entry_time = coalesce(entry_time, detect_time),
    strategy_label = coalesce(nullif(btrim(strategy_label), ''), strategy)
where entry_time is null
   or nullif(btrim(strategy_label), '') is null;

alter table public.seven_strategy_daily_history
  alter column detect_time drop not null;

alter table public.seven_strategy_daily_history
  alter column strategy drop not null;

alter table public.seven_strategy_daily_history
  drop constraint if exists seven_strategy_daily_history_strategy_not_blank;

alter table public.seven_strategy_daily_history
  add constraint seven_strategy_daily_history_strategy_not_blank
  check (btrim(coalesce(strategy, strategy_label, '')) <> '');

alter table public.seven_strategy_daily_history
  drop constraint if exists seven_strategy_daily_history_regular_session;

alter table public.seven_strategy_daily_history
  add constraint seven_strategy_daily_history_regular_session
  check (coalesce(detect_time, entry_time) >= time '09:00:00' and coalesce(detect_time, entry_time) <= time '13:30:00');

create index if not exists idx_seven_strategy_daily_history_today_latest
  on public.seven_strategy_daily_history(trade_date desc, detect_time desc, updated_at desc);

create index if not exists idx_seven_strategy_daily_history_strategy_latest
  on public.seven_strategy_daily_history(strategy, trade_date desc, detect_time desc);

create index if not exists idx_seven_strategy_daily_history_signal_type
  on public.seven_strategy_daily_history(trade_date desc, signal_type, detect_time desc);

create unique index if not exists uq_seven_strategy_daily_history_record
  on public.seven_strategy_daily_history(trade_date, detect_time, symbol, strategy, signal_type, source);

create unique index if not exists uq_seven_strategy_daily_history_record_normalized
  on public.seven_strategy_daily_history(
    trade_date,
    (coalesce(detect_time, entry_time)),
    symbol,
    (coalesce(strategy, strategy_label)),
    signal_type,
    source
  );

alter table public.seven_strategy_daily_history enable row level security;

drop policy if exists "read seven strategy daily history" on public.seven_strategy_daily_history;
create policy "read seven strategy daily history"
  on public.seven_strategy_daily_history
  for select
  to anon, authenticated
  using (true);

drop policy if exists "insert seven strategy daily history" on public.seven_strategy_daily_history;
create policy "insert seven strategy daily history"
  on public.seven_strategy_daily_history
  for insert
  to anon, authenticated
  with check (true);

drop policy if exists "service manage seven strategy daily history" on public.seven_strategy_daily_history;
create policy "service manage seven strategy daily history"
  on public.seven_strategy_daily_history
  for all
  to service_role
  using (true)
  with check (true);

grant select, insert on public.seven_strategy_daily_history to anon, authenticated;
grant all on public.seven_strategy_daily_history to service_role;
grant usage, select on sequence public.seven_strategy_daily_history_id_seq to anon, authenticated, service_role;

commit;
