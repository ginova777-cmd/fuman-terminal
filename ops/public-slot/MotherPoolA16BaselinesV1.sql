begin;
create table if not exists public.mother_pool_a16_baselines (
 trade_date date not null,
 canonical_run_id text not null,
 generation text not null,
 symbol text not null check (symbol ~ '^[0-9]{4}$'),
 payload_sha256 text not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
 payload jsonb not null,
 updated_at timestamptz not null default now(),
 primary key(trade_date,generation,symbol),
 check(canonical_run_id = 'fugle_daytrade_source:' || to_char(trade_date,'YYYYMMDD') || ':canonical'),
 check(payload->>'contract' = 'mother_pool_a16_same_minute_baseline_v1'),
 check(payload->>'symbol' = symbol),
 check(payload->>'trade_date' = trade_date::text),
 check(payload->>'canonical_run_id' = canonical_run_id)
);
alter table public.mother_pool_a16_baselines enable row level security;
drop policy if exists mother_pool_a16_read on public.mother_pool_a16_baselines;
create policy mother_pool_a16_read on public.mother_pool_a16_baselines for select to anon,authenticated using(true);
grant select on public.mother_pool_a16_baselines to anon,authenticated;
grant all on public.mother_pool_a16_baselines to service_role;
create or replace view public.v_mother_pool_a16_baselines with (security_invoker=true) as
select trade_date,canonical_run_id,generation,symbol,payload_sha256,payload,updated_at
from public.mother_pool_a16_baselines;
grant select on public.v_mother_pool_a16_baselines to anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
