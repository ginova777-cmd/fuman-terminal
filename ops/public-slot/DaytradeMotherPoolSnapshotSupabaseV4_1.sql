create table if not exists public.fugle_daytrade_mother_pool_snapshots_v4_1 (
  run_id text primary key,
  generation text not null,
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
declare
  s jsonb := p_snapshot;
  rid text := s->>'run_id';
  expected_header public.fugle_daytrade_mother_pool_snapshots_v4_1;
  existing_header public.fugle_daytrade_mother_pool_snapshots_v4_1;
  prior_header public.fugle_daytrade_mother_pool_snapshots_v4_1;
  expected_added jsonb;
  expected_removed jsonb;
  expected_members jsonb;
  existing_members jsonb;
begin
  if nullif(rid,'') is null or jsonb_typeof(s->'generation') is distinct from 'string'
     or s->>'generation' is distinct from rid or s->>'contract' is distinct from 'daytrade_mother_pool_snapshot_v1'
     or s->>'contract_version' is distinct from '4.1.0'
     or s->'complete' is distinct from 'true'::jsonb
     or s->>'status' is distinct from 'complete'
     or s->'exit_code' is distinct from '0'::jsonb
     or nullif(s->>'first_blocker','') is not null then
    raise exception 'invalid snapshot contract or incomplete verification';
  end if;
  if jsonb_typeof(s->'symbols') is distinct from 'array'
     or jsonb_typeof(s->'symbol_membership') is distinct from 'array'
     or jsonb_typeof(s->'added_symbols') is distinct from 'array'
     or jsonb_typeof(s->'removed_symbols') is distinct from 'array' then
    raise exception 'snapshot arrays required';
  end if;
  expected_header := jsonb_populate_record(null::public.fugle_daytrade_mother_pool_snapshots_v4_1,
    s || jsonb_build_object('previous_run_id',nullif(s->>'previous_run_id',''),
      'source_max_updated_at',nullif(s->>'source_max_updated_at',''), 'first_blocker',null));
  if expected_header.snapshot_sequence is null or expected_header.snapshot_sequence < 1
     or expected_header.trade_date is null
     or expected_header.canonical_run_id is distinct from
        ('fugle_daytrade_source:' || to_char(expected_header.trade_date,'YYYYMMDD') || ':canonical')
     or expected_header.symbol_count is distinct from jsonb_array_length(s->'symbols')
     or expected_header.generated_at is null or expected_header.effective_at is null then
    raise exception 'invalid snapshot identity or count';
  end if;
  if not isfinite(expected_header.generated_at) or not isfinite(expected_header.effective_at)
     or expected_header.generated_at > clock_timestamp()
     or expected_header.effective_at > expected_header.generated_at
     or (expected_header.effective_at at time zone 'Asia/Taipei')::date <> expected_header.trade_date
     or expected_header.snapshot_type not in ('OPENING_SNAPSHOT','INTRADAY_INCREMENTAL','INTRADAY_FULL_SNAPSHOT','CLOSEOUT_SNAPSHOT') then
    raise exception 'invalid snapshot time or type';
  end if;
  if exists (select 1 from jsonb_array_elements(s->'added_symbols') x
       where jsonb_typeof(x) <> 'string' or (x #>> '{}') !~ '^[0-9]{4}$')
     or exists (select 1 from jsonb_array_elements(s->'removed_symbols') x
       where jsonb_typeof(x) <> 'string' or (x #>> '{}') !~ '^[0-9]{4}$')
     or (select count(distinct x) from jsonb_array_elements(s->'added_symbols') x) <> jsonb_array_length(s->'added_symbols')
     or (select count(distinct x) from jsonb_array_elements(s->'removed_symbols') x) <> jsonb_array_length(s->'removed_symbols') then
    raise exception 'invalid snapshot delta arrays';
  end if;
  if exists (select 1 from jsonb_array_elements(s->'symbols') x
             where jsonb_typeof(x) <> 'string' or (x #>> '{}') !~ '^[0-9]{4}$')
     or (select count(distinct x) from jsonb_array_elements(s->'symbols') x) <> expected_header.symbol_count
     or exists (select 1 from jsonb_array_elements(s->'symbol_membership') x
       where x->>'mother_pool_run_id' is distinct from rid
          or x->>'trade_date' is distinct from s->>'trade_date'
          or x->'mother_pool_snapshot_sequence' is distinct from s->'snapshot_sequence'
          or x->>'symbol' is null or x->>'symbol' !~ '^[0-9]{4}$'
          or x->>'membership_status' is null
          or x->>'membership_status' not in ('ACTIVE','PENDING_DOWNSTREAM_WARMUP','REMOVED'))
     or (select count(distinct x->>'symbol') from jsonb_array_elements(s->'symbol_membership') x)
        <> jsonb_array_length(s->'symbol_membership') then
    raise exception 'invalid or duplicate snapshot membership';
  end if;
  if exists (select 1 from jsonb_array_elements(s->'symbol_membership') x
       where ((s->'symbols') ? (x->>'symbol')) is distinct from (x->>'membership_status' <> 'REMOVED')
          or ((s->'removed_symbols') ? (x->>'symbol')) is distinct from (x->>'membership_status' = 'REMOVED'))
     or exists (select 1 from jsonb_array_elements_text(s->'symbols') symbol
       where not exists (select 1 from jsonb_array_elements(s->'symbol_membership') x where x->>'symbol'=symbol))
     or exists (select 1 from jsonb_array_elements_text(s->'added_symbols') symbol where not (s->'symbols') ? symbol)
     or exists (select 1 from jsonb_array_elements_text(s->'removed_symbols') symbol
       where not exists (select 1 from jsonb_array_elements(s->'symbol_membership') x
                         where x->>'symbol'=symbol and x->>'membership_status'='REMOVED')) then
    raise exception 'snapshot member set mismatch';
  end if;
  select coalesce(jsonb_agg(to_jsonb(m) order by m.symbol),'[]'::jsonb) into expected_members
  from jsonb_populate_recordset(null::public.fugle_daytrade_mother_pool_snapshot_members_v4_1,
    (select coalesce(jsonb_agg(x || jsonb_build_object('run_id',rid,
      'snapshot_sequence',x->'mother_pool_snapshot_sequence',
      'membership_effective_at',nullif(x->>'membership_effective_at',''),
      'added_at',nullif(x->>'added_at',''), 'removed_at',nullif(x->>'removed_at',''),
      'source_updated_at',nullif(x->>'source_updated_at',''))),'[]'::jsonb)
     from jsonb_array_elements(s->'symbol_membership') x)) m;
  if exists (select 1 from jsonb_populate_recordset(null::public.fugle_daytrade_mother_pool_snapshot_members_v4_1,expected_members) m
       where m.membership_effective_at is null or not isfinite(m.membership_effective_at)
         or m.membership_effective_at > expected_header.effective_at
         or (m.membership_status = 'REMOVED' and (m.removed_at is null or m.removed_at <> expected_header.effective_at))
         or (m.membership_status <> 'REMOVED' and m.removed_at is not null)) then
    raise exception 'invalid membership time';
  end if;
  -- Serialize retries of the same identity; header and members commit together.
  perform pg_advisory_xact_lock(hashtextextended(expected_header.canonical_run_id,0));
  select * into existing_header from public.fugle_daytrade_mother_pool_snapshots_v4_1 where run_id=rid;
  if found then
    select coalesce(jsonb_agg(to_jsonb(m) order by m.symbol),'[]'::jsonb) into existing_members
      from public.fugle_daytrade_mother_pool_snapshot_members_v4_1 m where run_id=rid;
    if (to_jsonb(existing_header)-'created_at') is distinct from (to_jsonb(expected_header)-'created_at')
       or existing_members is distinct from expected_members then
      raise exception 'immutable snapshot conflict: %', rid;
    end if;
    return jsonb_build_object('ok',true,'run_id',rid,'snapshot_sequence',expected_header.snapshot_sequence,'idempotent',true);
  end if;
  select * into prior_header from public.fugle_daytrade_mother_pool_snapshots_v4_1
    where trade_date=expected_header.trade_date and canonical_run_id=expected_header.canonical_run_id
    order by snapshot_sequence desc limit 1;
  if expected_header.snapshot_sequence <> coalesce(prior_header.snapshot_sequence,0)+1
     or expected_header.previous_run_id is distinct from prior_header.run_id
     or expected_header.effective_at < prior_header.effective_at then
    raise exception 'snapshot predecessor mismatch';
  end if;
  select coalesce(jsonb_agg(x order by x),'[]'::jsonb) into expected_added
    from jsonb_array_elements_text(s->'symbols') x where not coalesce(prior_header.symbols,'[]'::jsonb) ? x;
  select coalesce(jsonb_agg(x order by x),'[]'::jsonb) into expected_removed
    from jsonb_array_elements_text(coalesce(prior_header.symbols,'[]'::jsonb)) x where not (s->'symbols') ? x;
  if expected_added is distinct from (select coalesce(jsonb_agg(x order by x),'[]'::jsonb) from jsonb_array_elements_text(s->'added_symbols') x)
     or expected_removed is distinct from (select coalesce(jsonb_agg(x order by x),'[]'::jsonb) from jsonb_array_elements_text(s->'removed_symbols') x) then
    raise exception 'snapshot predecessor delta mismatch';
  end if;
  insert into public.fugle_daytrade_mother_pool_snapshots_v4_1(run_id,generation,trade_date,canonical_run_id,snapshot_sequence,snapshot_type,generated_at,effective_at,status,complete,symbol_count,symbols,added_symbols,removed_symbols,previous_run_id,source_max_updated_at,first_blocker,exit_code,contract,contract_version)
  values(rid,s->>'generation',(s->>'trade_date')::date,s->>'canonical_run_id',(s->>'snapshot_sequence')::integer,s->>'snapshot_type',(s->>'generated_at')::timestamptz,(s->>'effective_at')::timestamptz,s->>'status',(s->>'complete')::boolean,(s->>'symbol_count')::integer,coalesce(s->'symbols','[]'::jsonb),coalesce(s->'added_symbols','[]'::jsonb),coalesce(s->'removed_symbols','[]'::jsonb),nullif(s->>'previous_run_id',''),nullif(s->>'source_max_updated_at','')::timestamptz,nullif(s->>'first_blocker',''),(s->>'exit_code')::integer,s->>'contract',s->>'contract_version')
  ;
  insert into public.fugle_daytrade_mother_pool_snapshot_members_v4_1(run_id,symbol,trade_date,snapshot_sequence,membership_status,membership_effective_at,added_at,removed_at,source_reason,source_updated_at)
  select rid, x->>'symbol',(x->>'trade_date')::date,(x->>'mother_pool_snapshot_sequence')::integer,x->>'membership_status',nullif(x->>'membership_effective_at','')::timestamptz,nullif(x->>'added_at','')::timestamptz,nullif(x->>'removed_at','')::timestamptz,x->>'source_reason',nullif(x->>'source_updated_at','')::timestamptz from jsonb_array_elements(s->'symbol_membership') x;
  return jsonb_build_object('ok',true,'run_id',rid,'snapshot_sequence',(s->>'snapshot_sequence')::integer);
end $$;
revoke all on function public.publish_fugle_daytrade_mother_pool_snapshot_v4_1(jsonb) from public, anon, authenticated;
grant execute on function public.publish_fugle_daytrade_mother_pool_snapshot_v4_1(jsonb) to service_role;
create or replace view public.v_fugle_daytrade_mother_pool_snapshot_v4_1 as
select s.contract,s.contract_version,s.trade_date,s.canonical_run_id,s.run_id as mother_pool_run_id,s.snapshot_sequence,s.snapshot_type,s.generated_at,s.effective_at,s.status,s.complete,s.symbol_count,s.symbols,s.added_symbols,s.removed_symbols,s.previous_run_id,s.source_max_updated_at,s.first_blocker,s.exit_code,m.symbol,m.membership_status,m.membership_effective_at,m.added_at,m.removed_at,m.source_reason,m.source_updated_at
from public.fugle_daytrade_mother_pool_snapshots_v4_1 s left join public.fugle_daytrade_mother_pool_snapshot_members_v4_1 m on m.run_id=s.run_id;
grant select on public.v_fugle_daytrade_mother_pool_snapshot_v4_1 to anon, authenticated;
