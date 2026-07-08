-- Daytrade PS1 formal entry history for /88.
-- Purpose: store official intraday PS1 entry records only. Replay / observation rows are rejected.
-- Safe to run repeatedly in Supabase SQL Editor.

begin;

create table if not exists public.fugle_daytrade_entry_history (
  id bigserial primary key,
  trade_date date not null,
  entry_time time without time zone not null,
  symbol text not null,
  name text,
  entry_price numeric,
  current_price numeric,
  strategy_label text not null default 'PS1',
  signal_type text not null default 'formal',
  note text,
  source text not null default 'ps1-live',
  run_id text,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint fugle_daytrade_entry_history_symbol_not_blank
    check (btrim(symbol) <> ''),
  constraint fugle_daytrade_entry_history_formal_source
    check (
      position('replay' in lower(coalesce(source, '') || ' ' || coalesce(strategy_label, ''))) = 0
      and position('observation' in lower(coalesce(source, '') || ' ' || coalesce(strategy_label, ''))) = 0
    ),
  constraint fugle_daytrade_entry_history_signal_type
    check (signal_type in ('formal', 'detected')),
  constraint fugle_daytrade_entry_history_regular_session
    check (entry_time >= time '09:00:00' and entry_time <= time '13:30:00')
);

alter table public.fugle_daytrade_entry_history
  add column if not exists signal_type text not null default 'formal';

alter table public.fugle_daytrade_entry_history
  drop constraint if exists fugle_daytrade_entry_history_signal_type;

alter table public.fugle_daytrade_entry_history
  add constraint fugle_daytrade_entry_history_signal_type
  check (signal_type in ('formal', 'detected'));

create index if not exists idx_fugle_daytrade_entry_history_today_latest
  on public.fugle_daytrade_entry_history(trade_date desc, entry_time desc, created_at desc);

create index if not exists idx_fugle_daytrade_entry_history_symbol_latest
  on public.fugle_daytrade_entry_history(symbol, trade_date desc, entry_time desc);

create unique index if not exists uq_fugle_daytrade_entry_history_formal_entry
  on public.fugle_daytrade_entry_history(trade_date, symbol, strategy_label, entry_time, source);

alter table public.fugle_daytrade_entry_history enable row level security;

drop policy if exists "read fugle daytrade entry history" on public.fugle_daytrade_entry_history;
create policy "read fugle daytrade entry history"
  on public.fugle_daytrade_entry_history
  for select
  to anon, authenticated
  using (true);

drop policy if exists "insert fugle daytrade entry history" on public.fugle_daytrade_entry_history;
create policy "insert fugle daytrade entry history"
  on public.fugle_daytrade_entry_history
  for insert
  to anon, authenticated
  with check (true);

drop policy if exists "service manage fugle daytrade entry history" on public.fugle_daytrade_entry_history;
create policy "service manage fugle daytrade entry history"
  on public.fugle_daytrade_entry_history
  for all
  to service_role
  using (true)
  with check (true);

grant select, insert on public.fugle_daytrade_entry_history to anon, authenticated;
grant all on public.fugle_daytrade_entry_history to service_role;
grant usage, select on sequence public.fugle_daytrade_entry_history_id_seq to anon, authenticated, service_role;

commit;
