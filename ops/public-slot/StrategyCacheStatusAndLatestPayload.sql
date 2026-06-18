-- Unified strategy cache status + latest payload RPC, 2026-06-16.

create table if not exists public.strategy_cache_status (
  strategy_key text primary key,
  label text,
  used_date text,
  updated_at timestamptz,
  scan_status text,
  scanned integer,
  total integer,
  match_count integer,
  source text,
  log text,
  error text
);

alter table public.strategy_cache_status
  add column if not exists label text,
  add column if not exists used_date text,
  add column if not exists updated_at timestamptz,
  add column if not exists scan_status text,
  add column if not exists scanned integer,
  add column if not exists total integer,
  add column if not exists match_count integer,
  add column if not exists source text,
  add column if not exists log text,
  add column if not exists error text;

create index if not exists idx_strategy_cache_status_updated
  on public.strategy_cache_status (updated_at desc);

alter table public.strategy_cache_status enable row level security;

drop policy if exists "read strategy cache status" on public.strategy_cache_status;
create policy "read strategy cache status"
on public.strategy_cache_status
for select
to anon, authenticated
using (true);

drop policy if exists "service role writes strategy cache status" on public.strategy_cache_status;
create policy "service role writes strategy cache status"
on public.strategy_cache_status
for all
to service_role
using (true)
with check (true);

alter table public.strategy1_open_buy_latest
  add column if not exists used_date text,
  add column if not exists scan_status text,
  add column if not exists completed_chunks integer,
  add column if not exists total_chunks integer,
  add column if not exists scanned integer,
  add column if not exists total integer,
  add column if not exists payload jsonb;

update public.strategy1_open_buy_latest
set
  used_date = coalesce(used_date, date),
  scan_status = coalesce(scan_status, 'complete'),
  scanned = coalesce(scanned, scanned_count),
  total = coalesce(total, total_count)
where id = 'latest';

alter table public.strategy1_open_buy_latest enable row level security;

drop policy if exists "read strategy1 open buy latest" on public.strategy1_open_buy_latest;
create policy "read strategy1 open buy latest"
on public.strategy1_open_buy_latest
for select
to anon, authenticated
using (true);

drop policy if exists "service role writes strategy1 open buy latest" on public.strategy1_open_buy_latest;
create policy "service role writes strategy1 open buy latest"
on public.strategy1_open_buy_latest
for all
to service_role
using (true)
with check (true);

insert into public.strategy_cache_status (
  strategy_key, label, used_date, updated_at, scan_status, scanned, total, match_count, source, log, error
)
select
  'strategy1',
  '策略1-明日開盤入',
  coalesce(used_date, date),
  updated_at,
  coalesce(scan_status, 'complete'),
  coalesce(scanned, scanned_count),
  coalesce(total, total_count),
  match_count,
  'strategy1_open_buy_latest',
  '',
  ''
from public.strategy1_open_buy_latest
where id = 'latest'
on conflict (strategy_key) do update set
  label = excluded.label,
  used_date = excluded.used_date,
  updated_at = excluded.updated_at,
  scan_status = excluded.scan_status,
  scanned = excluded.scanned,
  total = excluded.total,
  match_count = excluded.match_count,
  source = excluded.source,
  log = excluded.log,
  error = excluded.error;

create or replace function public.get_latest_strategy_payload(p_strategy_key text)
returns table (
  strategy_key text,
  label text,
  used_date text,
  updated_at timestamptz,
  scan_status text,
  scanned integer,
  total integer,
  match_count integer,
  source text,
  log text,
  error text,
  payload jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.strategy_key,
    s.label,
    s.used_date,
    s.updated_at,
    s.scan_status,
    s.scanned,
    s.total,
    s.match_count,
    s.source,
    s.log,
    s.error,
    case
      when s.strategy_key = 'strategy1' then (
        select l.payload
        from public.strategy1_open_buy_latest l
        where l.id = 'latest'
        limit 1
      )
      else null::jsonb
    end as payload
  from public.strategy_cache_status s
  where s.strategy_key = p_strategy_key
  limit 1
$$;

grant select on public.strategy_cache_status to anon, authenticated;
grant select, insert, update, delete on public.strategy_cache_status to service_role;
grant select on public.strategy1_open_buy_latest to anon, authenticated;
grant select, insert, update, delete on public.strategy1_open_buy_latest to service_role;
grant execute on function public.get_latest_strategy_payload(text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
