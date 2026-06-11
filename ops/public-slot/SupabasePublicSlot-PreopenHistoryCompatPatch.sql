-- Supabase public slot preopen history compatibility patch, 2026-06-12.
-- Purpose:
-- 1. Keep fugle_preopen_snapshot_history readable by anon.
-- 2. Provide a compatibility view with updated_at alias for readers that sort/filter by updated_at.
-- 3. Keep observed_at as the canonical stored timestamp.

alter table public.fugle_preopen_snapshot_history enable row level security;

alter table public.fugle_preopen_snapshot_history
  add column if not exists updated_at timestamptz;

update public.fugle_preopen_snapshot_history
set updated_at = observed_at
where updated_at is null;

grant select on public.fugle_preopen_snapshot_history to anon;
grant select, insert, update, delete on public.fugle_preopen_snapshot_history to service_role;

drop policy if exists "read fugle preopen snapshot history" on public.fugle_preopen_snapshot_history;
create policy "read fugle preopen snapshot history"
on public.fugle_preopen_snapshot_history
for select
to anon
using (true);

create index if not exists idx_fugle_preopen_snapshot_history_symbol_time
  on public.fugle_preopen_snapshot_history (symbol, observed_at desc);

create index if not exists idx_fugle_preopen_snapshot_history_symbol_updated
  on public.fugle_preopen_snapshot_history (symbol, updated_at desc);

create index if not exists idx_fugle_preopen_snapshot_history_trade_session
  on public.fugle_preopen_snapshot_history (trade_date, session, observed_at desc);

drop view if exists public.v_fugle_preopen_snapshot_history;

create or replace view public.v_fugle_preopen_snapshot_history as
select
  symbol,
  observed_at,
  coalesce(updated_at, observed_at) as updated_at,
  name,
  market,
  session,
  trade_date,
  reference_price,
  trial_price,
  is_trial,
  is_limit_up_bid,
  best_bid_price,
  best_ask_price,
  bid_volume,
  ask_volume,
  bid1_price,
  bid1_volume,
  bid2_price,
  bid2_volume,
  bid3_price,
  bid3_volume,
  bid4_price,
  bid4_volume,
  bid5_price,
  bid5_volume,
  ask1_price,
  ask1_volume,
  ask2_price,
  ask2_volume,
  ask3_price,
  ask3_volume,
  ask4_price,
  ask4_volume,
  ask5_price,
  ask5_volume,
  bid_levels_json,
  ask_levels_json,
  payload
from public.fugle_preopen_snapshot_history;

grant select on public.v_fugle_preopen_snapshot_history to anon;
grant select on public.v_fugle_preopen_snapshot_history to service_role;

comment on view public.v_fugle_preopen_snapshot_history is
  'Compatibility view for readers. observed_at is canonical; updated_at is an alias for observed_at.';
