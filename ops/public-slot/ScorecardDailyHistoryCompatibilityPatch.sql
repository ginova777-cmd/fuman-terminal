-- /88 PS1 + seven_strategy_daily_history compatibility patch.
-- Purpose: allow afternoon publishers to insert with anon key and newer field names.
-- Safe to run repeatedly in Supabase SQL Editor.

begin;

alter table public.fugle_daytrade_entry_history
  add column if not exists signal_type text not null default 'formal';

alter table public.fugle_daytrade_entry_history
  drop constraint if exists fugle_daytrade_entry_history_signal_type;

alter table public.fugle_daytrade_entry_history
  add constraint fugle_daytrade_entry_history_signal_type
  check (signal_type in ('formal', 'detected'));

drop policy if exists "insert fugle daytrade entry history" on public.fugle_daytrade_entry_history;
create policy "insert fugle daytrade entry history"
  on public.fugle_daytrade_entry_history
  for insert
  to anon, authenticated
  with check (true);

grant select, insert on public.fugle_daytrade_entry_history to anon, authenticated;
grant all on public.fugle_daytrade_entry_history to service_role;
grant usage, select on sequence public.fugle_daytrade_entry_history_id_seq to anon, authenticated, service_role;

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

create unique index if not exists uq_seven_strategy_daily_history_record_normalized
  on public.seven_strategy_daily_history(
    trade_date,
    (coalesce(detect_time, entry_time)),
    symbol,
    (coalesce(strategy, strategy_label)),
    signal_type,
    source
  );

drop policy if exists "insert seven strategy daily history" on public.seven_strategy_daily_history;
create policy "insert seven strategy daily history"
  on public.seven_strategy_daily_history
  for insert
  to anon, authenticated
  with check (true);

grant select, insert on public.seven_strategy_daily_history to anon, authenticated;
grant all on public.seven_strategy_daily_history to service_role;
grant usage, select on sequence public.seven_strategy_daily_history_id_seq to anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;
