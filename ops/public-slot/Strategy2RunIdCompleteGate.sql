-- Strategy2 run_id complete gate, 2026-06-16.
--
-- Goal:
--   Give Strategy2 the same stability pattern as Strategy4:
--   1. Supabase ready cache/RPC is the input contract.
--   2. A scan writes one run_id batch.
--   3. Readers trust only the latest complete run.
--   4. Existing strategy2_latest JSON remains compatible during migration.

create table if not exists public.strategy2_scan_runs (
  run_id text primary key,
  strategy text not null default 'strategy2',
  scan_date date not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',
  complete boolean not null default false,
  result_count integer not null default 0,
  record_count integer not null default 0,
  event_count integer not null default 0,
  entry_count integer not null default 0,
  quality_status text,
  schema_version text,
  data_contract_source text,
  quote_age_seconds integer,
  latest_candle_time timestamptz,
  today_candle_count integer,
  source_status jsonb not null default '{}'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.strategy2_scan_results (
  id bigserial primary key,
  run_id text not null references public.strategy2_scan_runs(run_id) on delete cascade,
  strategy text not null default 'strategy2',
  row_kind text not null default 'event',
  code text not null,
  name text,
  scan_date date not null,
  scan_time timestamptz not null default now(),
  state_id text,
  score numeric,
  price numeric,
  change_percent numeric,
  volume numeric,
  trade_value numeric,
  signal_id text not null,
  first_a_at text,
  latest_a_at text,
  latest_seen_at text,
  ma35_source text,
  source_coverage numeric,
  quote_age_seconds integer,
  latest_candle_time timestamptz,
  today_candle_count integer,
  complete boolean not null default false,
  quality_status text,
  schema_version text,
  data_contract_source text,
  generated_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb
);

create unique index if not exists strategy2_scan_results_run_kind_code_signal_uidx
  on public.strategy2_scan_results (run_id, row_kind, code, signal_id);

create index if not exists idx_strategy2_scan_runs_latest_complete
  on public.strategy2_scan_runs (strategy, complete, finished_at desc);

create index if not exists idx_strategy2_scan_results_run_id
  on public.strategy2_scan_results (run_id);

create index if not exists idx_strategy2_scan_results_code
  on public.strategy2_scan_results (code);

alter table public.strategy2_scan_runs enable row level security;
alter table public.strategy2_scan_results enable row level security;

drop policy if exists "read strategy2 scan runs" on public.strategy2_scan_runs;
create policy "read strategy2 scan runs"
on public.strategy2_scan_runs
for select
to anon
using (true);

drop policy if exists "read strategy2 scan results" on public.strategy2_scan_results;
create policy "read strategy2 scan results"
on public.strategy2_scan_results
for select
to anon
using (true);

grant select on public.strategy2_scan_runs to anon;
grant select on public.strategy2_scan_results to anon;
grant select, insert, update, delete on public.strategy2_scan_runs to service_role;
grant select, insert, update, delete on public.strategy2_scan_results to service_role;
grant usage, select on sequence public.strategy2_scan_results_id_seq to service_role;

create table if not exists public.strategy2_latest (
  id text primary key,
  date date,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  entry_count integer not null default 0,
  record_count integer not null default 0,
  event_count integer not null default 0
);

alter table public.strategy2_latest add column if not exists run_id text;
alter table public.strategy2_latest add column if not exists complete boolean not null default false;
alter table public.strategy2_latest add column if not exists quality_status text;
alter table public.strategy2_latest add column if not exists schema_version text;
alter table public.strategy2_latest add column if not exists data_contract_source text;

grant select on public.strategy2_latest to anon;
grant select, insert, update, delete on public.strategy2_latest to service_role;

create or replace function public.publish_strategy2_complete_run(
  p_run_id text,
  p_scan_date date,
  p_payload jsonb
)
returns text
language plpgsql
security definer
as $$
declare
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_event_count integer := jsonb_array_length(coalesce(v_payload->'events', '[]'::jsonb));
  v_record_count integer := jsonb_array_length(coalesce(v_payload->'records', '[]'::jsonb));
  v_entry_count integer := coalesce(nullif(v_payload->>'entryCount', '')::integer, 0);
  v_quality_status text := coalesce(v_payload->>'qualityStatus', v_payload->>'quality_status', 'ok');
  v_schema_version text := coalesce(v_payload->>'schemaVersion', v_payload->>'schema_version', 'strategy2-run-id-complete-v1');
  v_data_contract_source text := coalesce(v_payload->>'dataContractSource', v_payload->>'data_contract_source', 'supabase:strategy2_intraday_ready_cache');
  v_quote_age_seconds integer := nullif(v_payload #>> '{sourceHealth,quote_age_seconds}', '')::integer;
  v_latest_candle_time timestamptz := nullif(v_payload #>> '{sourceHealth,latest_candle_time}', '')::timestamptz;
  v_today_candle_count integer := nullif(v_payload #>> '{sourceHealth,today_candle_count}', '')::integer;
  v_now timestamptz := now();
  v_final_payload jsonb;
begin
  if p_run_id is null or trim(p_run_id) = '' then
    raise exception 'p_run_id is required';
  end if;

  v_final_payload :=
    v_payload
    || jsonb_build_object(
      'runId', p_run_id,
      'gate', 'run_id',
      'complete', true,
      'qualityStatus', v_quality_status,
      'schemaVersion', v_schema_version,
      'dataContractSource', v_data_contract_source,
      'updatedAt', v_now
    );

  insert into public.strategy2_scan_runs (
    run_id,
    strategy,
    scan_date,
    started_at,
    finished_at,
    status,
    complete,
    result_count,
    record_count,
    event_count,
    entry_count,
    quality_status,
    schema_version,
    data_contract_source,
    quote_age_seconds,
    latest_candle_time,
    today_candle_count,
    source_status,
    payload,
    updated_at
  ) values (
    p_run_id,
    'strategy2',
    p_scan_date,
    coalesce(nullif(v_payload->>'startedAt', '')::timestamptz, v_now),
    v_now,
    'complete',
    true,
    v_event_count,
    v_record_count,
    v_event_count,
    v_entry_count,
    v_quality_status,
    v_schema_version,
    v_data_contract_source,
    v_quote_age_seconds,
    v_latest_candle_time,
    v_today_candle_count,
    coalesce(v_payload->'sourceHealth', '{}'::jsonb),
    v_final_payload,
    v_now
  )
  on conflict (run_id) do update set
    finished_at = excluded.finished_at,
    status = excluded.status,
    complete = excluded.complete,
    result_count = excluded.result_count,
    record_count = excluded.record_count,
    event_count = excluded.event_count,
    entry_count = excluded.entry_count,
    quality_status = excluded.quality_status,
    schema_version = excluded.schema_version,
    data_contract_source = excluded.data_contract_source,
    quote_age_seconds = excluded.quote_age_seconds,
    latest_candle_time = excluded.latest_candle_time,
    today_candle_count = excluded.today_candle_count,
    source_status = excluded.source_status,
    payload = excluded.payload,
    updated_at = excluded.updated_at;

  insert into public.strategy2_scan_results (
    run_id,
    strategy,
    row_kind,
    code,
    name,
    scan_date,
    scan_time,
    state_id,
    score,
    price,
    change_percent,
    volume,
    trade_value,
    signal_id,
    first_a_at,
    latest_a_at,
    latest_seen_at,
    ma35_source,
    source_coverage,
    quote_age_seconds,
    latest_candle_time,
    today_candle_count,
    complete,
    quality_status,
    schema_version,
    data_contract_source,
    generated_at,
    updated_at,
    payload
  )
  select
    p_run_id,
    'strategy2',
    'event',
    coalesce(e->>'code', e->>'symbol'),
    e->>'name',
    p_scan_date,
    coalesce(nullif(e->>'timestamp', '')::timestamptz, v_now),
    e->>'stateId',
    nullif(e->>'maxScore', '')::numeric,
    nullif(coalesce(e->>'latestAPrice', e->>'latestSeenPrice', e->>'price'), '')::numeric,
    nullif(coalesce(e->>'changePercent', e->>'change_percent'), '')::numeric,
    nullif(coalesce(e->>'volume', e->>'totalVolume'), '')::numeric,
    nullif(coalesce(e->>'tradeValue', e->>'trade_value'), '')::numeric,
    coalesce(nullif(e->>'signalId', ''), nullif(e->>'id', ''), coalesce(e->>'code', e->>'symbol')),
    e->>'firstAAt',
    e->>'latestAAt',
    e->>'latestSeenAt',
    coalesce(e #>> '{latestRecord,ma35Source}', e->>'ma35Source'),
    nullif(coalesce(e #>> '{latestRecord,sourceCoverage}', e->>'sourceCoverage'), '')::numeric,
    v_quote_age_seconds,
    v_latest_candle_time,
    v_today_candle_count,
    true,
    v_quality_status,
    v_schema_version,
    v_data_contract_source,
    v_now,
    v_now,
    e
  from jsonb_array_elements(coalesce(v_payload->'events', '[]'::jsonb)) e
  where coalesce(e->>'code', e->>'symbol', '') ~ '^[0-9]{4}$'
  on conflict (run_id, row_kind, code, signal_id) do update set
    name = excluded.name,
    scan_time = excluded.scan_time,
    state_id = excluded.state_id,
    score = excluded.score,
    price = excluded.price,
    change_percent = excluded.change_percent,
    volume = excluded.volume,
    trade_value = excluded.trade_value,
    first_a_at = excluded.first_a_at,
    latest_a_at = excluded.latest_a_at,
    latest_seen_at = excluded.latest_seen_at,
    ma35_source = excluded.ma35_source,
    source_coverage = excluded.source_coverage,
    quote_age_seconds = excluded.quote_age_seconds,
    latest_candle_time = excluded.latest_candle_time,
    today_candle_count = excluded.today_candle_count,
    complete = excluded.complete,
    quality_status = excluded.quality_status,
    schema_version = excluded.schema_version,
    data_contract_source = excluded.data_contract_source,
    updated_at = excluded.updated_at,
    payload = excluded.payload;

  insert into public.strategy2_scan_results (
    run_id,
    strategy,
    row_kind,
    code,
    name,
    scan_date,
    scan_time,
    state_id,
    score,
    price,
    change_percent,
    volume,
    trade_value,
    signal_id,
    ma35_source,
    source_coverage,
    quote_age_seconds,
    latest_candle_time,
    today_candle_count,
    complete,
    quality_status,
    schema_version,
    data_contract_source,
    generated_at,
    updated_at,
    payload
  )
  select
    p_run_id,
    'strategy2',
    'record',
    coalesce(r->>'code', r->>'symbol'),
    r->>'name',
    p_scan_date,
    coalesce(nullif(coalesce(r->>'timestamp', r->>'entryAt'), '')::timestamptz, v_now),
    r->>'stateId',
    nullif(coalesce(r->>'score', r->>'maxScore'), '')::numeric,
    nullif(coalesce(r->>'entryPrice', r->>'observedPrice', r->>'price'), '')::numeric,
    nullif(coalesce(r->>'changePercent', r->>'change_percent'), '')::numeric,
    nullif(coalesce(r->>'volume', r->>'totalVolume'), '')::numeric,
    nullif(coalesce(r->>'tradeValue', r->>'trade_value'), '')::numeric,
    coalesce(nullif(r->>'signalId', ''), nullif(r->>'timestamp', ''), coalesce(r->>'code', r->>'symbol')),
    r->>'ma35Source',
    nullif(r->>'sourceCoverage', '')::numeric,
    v_quote_age_seconds,
    v_latest_candle_time,
    v_today_candle_count,
    true,
    v_quality_status,
    v_schema_version,
    v_data_contract_source,
    v_now,
    v_now,
    r
  from jsonb_array_elements(coalesce(v_payload->'records', '[]'::jsonb)) r
  where coalesce(r->>'code', r->>'symbol', '') ~ '^[0-9]{4}$'
  on conflict (run_id, row_kind, code, signal_id) do update set
    name = excluded.name,
    scan_time = excluded.scan_time,
    state_id = excluded.state_id,
    score = excluded.score,
    price = excluded.price,
    change_percent = excluded.change_percent,
    volume = excluded.volume,
    trade_value = excluded.trade_value,
    ma35_source = excluded.ma35_source,
    source_coverage = excluded.source_coverage,
    quote_age_seconds = excluded.quote_age_seconds,
    latest_candle_time = excluded.latest_candle_time,
    today_candle_count = excluded.today_candle_count,
    complete = excluded.complete,
    quality_status = excluded.quality_status,
    schema_version = excluded.schema_version,
    data_contract_source = excluded.data_contract_source,
    updated_at = excluded.updated_at,
    payload = excluded.payload;

  insert into public.strategy2_latest (
    id,
    date,
    payload,
    updated_at,
    entry_count,
    record_count,
    event_count,
    run_id,
    complete,
    quality_status,
    schema_version,
    data_contract_source
  ) values (
    'latest',
    p_scan_date,
    v_final_payload,
    v_now,
    v_entry_count,
    v_record_count,
    v_event_count,
    p_run_id,
    true,
    v_quality_status,
    v_schema_version,
    v_data_contract_source
  )
  on conflict (id) do update set
    date = excluded.date,
    payload = excluded.payload,
    updated_at = excluded.updated_at,
    entry_count = excluded.entry_count,
    record_count = excluded.record_count,
    event_count = excluded.event_count,
    run_id = excluded.run_id,
    complete = excluded.complete,
    quality_status = excluded.quality_status,
    schema_version = excluded.schema_version,
    data_contract_source = excluded.data_contract_source;

  return p_run_id;
end;
$$;

grant execute on function public.publish_strategy2_complete_run(text, date, jsonb) to service_role;

create or replace view public.v_strategy2_latest_complete_run as
select
  run_id,
  strategy,
  scan_date,
  finished_at,
  status,
  complete,
  result_count,
  record_count,
  event_count,
  entry_count,
  quality_status,
  schema_version,
  data_contract_source,
  quote_age_seconds,
  latest_candle_time,
  today_candle_count,
  payload,
  updated_at
from public.strategy2_scan_runs
where strategy = 'strategy2'
  and status = 'complete'
  and complete = true
order by finished_at desc
limit 1;

grant select on public.v_strategy2_latest_complete_run to anon;
grant select on public.v_strategy2_latest_complete_run to service_role;

notify pgrst, 'reload schema';
