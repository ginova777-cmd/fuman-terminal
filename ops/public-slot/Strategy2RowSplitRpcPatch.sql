-- Strategy2 row-split publish RPC patch, 2026-06-16.
-- Replaces the basic publish RPC with a full run_id complete publisher:
--   - writes public.strategy2_scan_runs
--   - splits payload.events into public.strategy2_scan_results row_kind='event'
--   - splits payload.records into public.strategy2_scan_results row_kind='record'
--   - keeps public.strategy2_latest compatible for the existing page

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
  v_entry_count integer := case when coalesce(v_payload->>'entryCount', '') ~ '^-?[0-9]+$' then (v_payload->>'entryCount')::integer else 0 end;
  v_quality_status text := coalesce(v_payload->>'qualityStatus', v_payload->>'quality_status', 'ok');
  v_schema_version text := coalesce(v_payload->>'schemaVersion', v_payload->>'schema_version', 'strategy2-run-id-complete-v1');
  v_data_contract_source text := coalesce(v_payload->>'dataContractSource', v_payload->>'data_contract_source', 'supabase:strategy2_intraday_ready_cache');
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
    source_status,
    payload,
    updated_at
  ) values (
    p_run_id,
    'strategy2',
    p_scan_date,
    v_now,
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
    coalesce(v_payload->'sourceHealth', v_payload->'realtime', '{}'::jsonb),
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
    v_now,
    e->>'stateId',
    case when coalesce(e->>'maxScore', e->>'score', '') ~ '^-?[0-9]+(\.[0-9]+)?$' then coalesce(e->>'maxScore', e->>'score')::numeric end,
    case when coalesce(e->>'latestAPrice', e->>'latestSeenPrice', e->>'price', '') ~ '^-?[0-9]+(\.[0-9]+)?$' then coalesce(e->>'latestAPrice', e->>'latestSeenPrice', e->>'price')::numeric end,
    case when coalesce(e->>'changePercent', e->>'change_percent', '') ~ '^-?[0-9]+(\.[0-9]+)?$' then coalesce(e->>'changePercent', e->>'change_percent')::numeric end,
    case when coalesce(e->>'volume', e->>'totalVolume', '') ~ '^-?[0-9]+(\.[0-9]+)?$' then coalesce(e->>'volume', e->>'totalVolume')::numeric end,
    case when coalesce(e->>'tradeValue', e->>'trade_value', '') ~ '^-?[0-9]+(\.[0-9]+)?$' then coalesce(e->>'tradeValue', e->>'trade_value')::numeric end,
    coalesce(nullif(e->>'signalId', ''), nullif(e->>'id', ''), coalesce(e->>'code', e->>'symbol')),
    e->>'firstAAt',
    e->>'latestAAt',
    e->>'latestSeenAt',
    coalesce(e #>> '{latestRecord,ma35Source}', e->>'ma35Source'),
    case when coalesce(e #>> '{latestRecord,sourceCoverage}', e->>'sourceCoverage', '') ~ '^-?[0-9]+(\.[0-9]+)?$' then coalesce(e #>> '{latestRecord,sourceCoverage}', e->>'sourceCoverage')::numeric end,
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
    v_now,
    r->>'stateId',
    case when coalesce(r->>'score', r->>'maxScore', '') ~ '^-?[0-9]+(\.[0-9]+)?$' then coalesce(r->>'score', r->>'maxScore')::numeric end,
    case when coalesce(r->>'entryPrice', r->>'observedPrice', r->>'price', '') ~ '^-?[0-9]+(\.[0-9]+)?$' then coalesce(r->>'entryPrice', r->>'observedPrice', r->>'price')::numeric end,
    case when coalesce(r->>'changePercent', r->>'change_percent', '') ~ '^-?[0-9]+(\.[0-9]+)?$' then coalesce(r->>'changePercent', r->>'change_percent')::numeric end,
    case when coalesce(r->>'volume', r->>'totalVolume', '') ~ '^-?[0-9]+(\.[0-9]+)?$' then coalesce(r->>'volume', r->>'totalVolume')::numeric end,
    case when coalesce(r->>'tradeValue', r->>'trade_value', '') ~ '^-?[0-9]+(\.[0-9]+)?$' then coalesce(r->>'tradeValue', r->>'trade_value')::numeric end,
    coalesce(nullif(r->>'signalId', ''), nullif(r->>'timestamp', ''), coalesce(r->>'code', r->>'symbol')),
    r->>'ma35Source',
    case when coalesce(r->>'sourceCoverage', '') ~ '^-?[0-9]+(\.[0-9]+)?$' then (r->>'sourceCoverage')::numeric end,
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

notify pgrst, 'reload schema';
