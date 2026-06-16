-- FinMind supplemental source tables, 2026-06-16.
-- These tables are intended as fallback/supplemental inputs.
-- Fugle remains the primary realtime source; FinMind fills coverage gaps.

create table if not exists public.finmind_quotes_live (
  symbol text primary key,
  name text,
  price numeric,
  previous_close numeric,
  change_price numeric,
  change_percent numeric,
  open_price numeric,
  high_price numeric,
  low_price numeric,
  total_volume_lots numeric,
  trade_value_twd numeric,
  buy_price numeric,
  buy_volume_lots numeric,
  sell_price numeric,
  sell_volume_lots numeric,
  volume_ratio numeric,
  quote_time timestamptz,
  source text not null default 'finmind:taiwan_stock_tick_snapshot',
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists idx_finmind_quotes_live_updated_at
  on public.finmind_quotes_live (updated_at desc);

create index if not exists idx_finmind_quotes_live_quote_time
  on public.finmind_quotes_live (quote_time desc);

alter table public.finmind_quotes_live enable row level security;

drop policy if exists "read finmind quotes live" on public.finmind_quotes_live;
create policy "read finmind quotes live"
on public.finmind_quotes_live
for select
to anon
using (true);

grant select on public.finmind_quotes_live to anon;
grant select, insert, update, delete on public.finmind_quotes_live to service_role;

create or replace view public.v_finmind_quotes_live_health as
select
  count(*)::integer as quote_rows,
  count(*) filter (where updated_at >= now() - interval '120 seconds')::integer as fresh_rows_120s,
  max(updated_at) as last_updated_at,
  max(quote_time) as last_quote_time,
  greatest(0, floor(extract(epoch from (now() - max(updated_at)))))::integer as age_seconds,
  case
    when max(updated_at) >= now() - interval '120 seconds' then true
    else false
  end as quotes_ok
from public.finmind_quotes_live;

grant select on public.v_finmind_quotes_live_health to anon;
grant select on public.v_finmind_quotes_live_health to service_role;

notify pgrst, 'reload schema';
