create table if not exists public.strategy1_open_buy_latest (
  id text primary key,
  date text,
  payload jsonb not null,
  match_count integer not null default 0,
  scanned_count integer not null default 0,
  total_count integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.strategy1_open_buy_latest enable row level security;

drop policy if exists "Public can read strategy1 open buy latest" on public.strategy1_open_buy_latest;

create policy "Public can read strategy1 open buy latest"
on public.strategy1_open_buy_latest
for select
to anon, authenticated
using (true);

create index if not exists strategy1_open_buy_latest_updated_idx
on public.strategy1_open_buy_latest (updated_at desc);

