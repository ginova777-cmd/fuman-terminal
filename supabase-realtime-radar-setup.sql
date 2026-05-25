create table if not exists public.fuman_realtime_radar_cache (
  id text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.fuman_realtime_radar_cache enable row level security;

drop policy if exists "Public can read realtime radar cache" on public.fuman_realtime_radar_cache;

create policy "Public can read realtime radar cache"
on public.fuman_realtime_radar_cache
for select
to anon, authenticated
using (true);

create index if not exists fuman_realtime_radar_cache_updated_idx
on public.fuman_realtime_radar_cache (updated_at desc);
