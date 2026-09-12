create table if not exists public.fugle_daytrade_mother_pool_snapshots_v4_1 (
  run_id text primary key,
  trade_date date not null,
  canonical_run_id text not null,
  snapshot_sequence integer not null,
  snapshot_type text not null,
  generated_at timestamptz not null,
  effective_at timestamptz not null,
  status text not null,
  complete boolean not null,
  symbol_count integer not null,
  symbols jsonb not null default '[]'::jsonb,
  added_symbols jsonb not null default '[]'::jsonb,
  removed_symbols jsonb not null default '[]'::jsonb,
  previous_run_id text,
  source_max_updated_at timestamptz,
  first_blocker text,
  exit_code integer not null,
  contract text not null,
  contract_version text not null,
  created_at timestamptz not null default now(),
  unique (trade_date, canonical_run_id, snapshot_sequence)
);
create table if not exists public.fugle_daytrade_mother_pool_snapshot_members_v4_1 (
  run_id text not null references public.fugle_daytrade_mother_pool_snapshots_v4_1(run_id),
  symbol text not null,
  trade_date date not null,
  snapshot_sequence integer not null,
  membership_status text not null,
  membership_effective_at timestamptz,
  added_at timestamptz,
  removed_at timestamptz,
  source_reason text,
  source_updated_at timestamptz,
  primary key (run_id, symbol)
);
create index if not exists fugle_daytrade_mp_snapshot_lookup_v4_1 on public.fugle_daytrade_mother_pool_snapshots_v4_1(trade_date, canonical_run_id, snapshot_sequence desc);
create or replace function public.publish_fugle_daytrade_mother_pool_snapshot_v4_1(p_snapshot jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s jsonb := p_snapshot; rid text := s->>'run_id';
begin
  if rid is null or s->>'contract' <> 'daytrade_mother_pool_snapshot_v1' or s->>'contract_version' <> '4.1.0' then raise exception 'invalid snapshot contract'; end if;
  insert into public.fugle_daytrade_mother_pool_snapshots_v4_1(run_id,trade_date,canonical_run_id,snapshot_sequence,snapshot_type,generated_at,effective_at,status,complete,symbol_count,symbols,added_symbols,removed_symbols,previous_run_id,source_max_updated_at,first_blocker,exit_code,contract,contract_version)
  values(rid,(s->>'trade_date')::date,s->>'canonical_run_id',(s->>'snapshot_sequence')::integer,s->>'snapshot_type',(s->>'generated_at')::timestamptz,(s->>'effective_at')::timestamptz,s->>'status',(s->>'complete')::boolean,(s->>'symbol_count')::integer,coalesce(s->'symbols','[]'::jsonb),coalesce(s->'added_symbols','[]'::jsonb),coalesce(s->'removed_symbols','[]'::jsonb),nullif(s->>'previous_run_id',''),nullif(s->>'source_max_updated_at','')::timestamptz,nullif(s->>'first_blocker',''),(s->>'exit_code')::integer,s->>'contract',s->>'contract_version')
  on conflict (run_id) do nothing;
  insert into public.fugle_daytrade_mother_pool_snapshot_members_v4_1(run_id,symbol,trade_date,snapshot_sequence,membership_status,membership_effective_at,added_at,removed_at,source_reason,source_updated_at)
  select rid, x->>'symbol',(x->>'trade_date')::date,(x->>'mother_pool_snapshot_sequence')::integer,x->>'membership_status',nullif(x->>'membership_effective_at','')::timestamptz,nullif(x->>'added_at','')::timestamptz,nullif(x->>'removed_at','')::timestamptz,x->>'source_reason',nullif(x->>'source_updated_at','')::timestamptz from jsonb_array_elements(coalesce(s->'symbol_membership','[]'::jsonb)) x on conflict do nothing;
  return jsonb_build_object('ok',true,'run_id',rid,'snapshot_sequence',(s->>'snapshot_sequence')::integer);
end $$;
revoke all on function public.publish_fugle_daytrade_mother_pool_snapshot_v4_1(jsonb) from public, anon, authenticated;
grant execute on function public.publish_fugle_daytrade_mother_pool_snapshot_v4_1(jsonb) to service_role;
create or replace view public.v_fugle_daytrade_mother_pool_snapshot_v4_1 as
select s.contract,s.contract_version,s.trade_date,s.canonical_run_id,s.run_id as mother_pool_run_id,s.snapshot_sequence,s.snapshot_type,s.generated_at,s.effective_at,s.status,s.complete,s.symbol_count,s.symbols,s.added_symbols,s.removed_symbols,s.previous_run_id,s.source_max_updated_at,s.first_blocker,s.exit_code,m.symbol,m.membership_status,m.membership_effective_at,m.added_at,m.removed_at,m.source_reason,m.source_updated_at
from public.fugle_daytrade_mother_pool_snapshots_v4_1 s left join public.fugle_daytrade_mother_pool_snapshot_members_v4_1 m on m.run_id=s.run_id;
grant select on public.v_fugle_daytrade_mother_pool_snapshot_v4_1 to anon, authenticated;
