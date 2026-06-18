create table if not exists public.terminal_snapshots (
  key text not null,
  trade_date text not null,
  snapshot_id text not null,
  locked boolean not null default false,
  reason text not null default 'snapshot-cache',
  payload jsonb not null,
  source text not null default 'snapshot',
  updated_at timestamptz not null default now(),
  finalized_at timestamptz,
  primary key (key, trade_date)
);

create index if not exists terminal_snapshots_key_updated_at_idx
  on public.terminal_snapshots (key, updated_at desc);

alter table public.terminal_snapshots enable row level security;

drop policy if exists "terminal snapshots anon read" on public.terminal_snapshots;
create policy "terminal snapshots anon read"
  on public.terminal_snapshots
  for select
  to anon
  using (true);

drop policy if exists "terminal snapshots service write" on public.terminal_snapshots;
create policy "terminal snapshots service write"
  on public.terminal_snapshots
  for all
  to service_role
  using (true)
  with check (true);
