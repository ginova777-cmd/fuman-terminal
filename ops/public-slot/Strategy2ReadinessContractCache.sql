-- Strategy2 battle-readiness contract cache.
-- Purpose:
--   - Keep hot API/terminal reads fast.
--   - Preserve latest complete run unless 08:45 futopt, 08:55 preopen hot,
--     09:00-12:00 intraday 1m, and latest execution are all 100%.

create table if not exists public.strategy2_readiness_status_cache (
  id text primary key default 'latest',
  checked_at timestamptz not null default now(),
  status text not null default 'not_ready',
  reason text not null default '',
  strategy2_ready_100 boolean not null default false,

  futopt_expected_count integer not null default 0,
  futopt_ready_count integer not null default 0,
  futopt_coverage numeric not null default 0,
  futopt_ready boolean not null default false,

  preopen_snapshot_count integer not null default 0,
  preopen_hot_candidate_count integer not null default 0,
  preopen_hot_ready_count integer not null default 0,
  preopen_hot_coverage numeric not null default 0,
  preopen_hot_ready boolean not null default false,

  detection_expected_count integer not null default 0,
  intraday_1m_ready_count integer not null default 0,
  intraday_1m_coverage numeric not null default 0,
  intraday_1m_ready boolean not null default false,

  latest_run_id text,
  latest_scan_date date,
  latest_finished_at timestamptz,
  latest_status text,
  latest_complete boolean,
  latest_result_count integer,
  latest_record_count integer,
  latest_event_count integer,
  latest_entry_count integer,
  latest_execution_expected numeric not null default 0,
  latest_execution_scanned numeric not null default 0,
  latest_execution_rate numeric not null default 0,
  execution_ready boolean not null default false,

  missing_summary jsonb not null default '[]'::jsonb
);

create table if not exists public.strategy2_readiness_missing_cache (
  id bigserial primary key,
  checked_at timestamptz not null default now(),
  gate text not null,
  symbol text,
  name text,
  future_symbol text,
  missing_reason text not null,
  details jsonb not null default '{}'::jsonb
);

create index if not exists idx_strategy2_readiness_missing_gate
  on public.strategy2_readiness_missing_cache (gate, missing_reason);

create index if not exists idx_strategy2_readiness_missing_symbol
  on public.strategy2_readiness_missing_cache (symbol);

create or replace function public.strategy2_numeric_payload_value(p_payload jsonb, variadic p_keys text[])
returns numeric
language plpgsql
stable
as $$
declare
  k text;
  v text;
begin
  foreach k in array p_keys loop
    v := nullif(p_payload ->> k, '');
    if v is not null and v ~ '^-?[0-9]+(\.[0-9]+)?$' then
      return v::numeric;
    end if;
  end loop;
  return null;
end;
$$;

create or replace function public.refresh_strategy2_readiness_cache()
returns jsonb
language plpgsql
security definer
as $$
declare
  v_checked_at timestamptz := now();
  v_futopt_expected integer := 0;
  v_futopt_ready integer := 0;
  v_preopen_snapshot integer := 0;
  v_preopen_hot_expected integer := 0;
  v_preopen_hot_ready integer := 0;
  v_intraday_expected integer := 0;
  v_intraday_ready integer := 0;
  v_latest record;
  v_execution_expected numeric := 0;
  v_execution_scanned numeric := 0;
  v_missing_summary jsonb := '[]'::jsonb;
  v_reasons text[] := array[]::text[];
  v_status text := 'ready';
  v_ready_100 boolean := false;
begin
  truncate table public.strategy2_readiness_missing_cache;

  insert into public.strategy2_readiness_missing_cache (
    checked_at, gate, symbol, name, future_symbol, missing_reason, details
  )
  select
    v_checked_at,
    '08:45_futopt',
    stock_symbol,
    stock_name,
    future_symbol,
    case
      when coalesce(has_mapping, false) = false then 'missing_mapping'
      when coalesce(has_quote, false) = false then 'missing_quote'
      when coalesce(quote_fresh_180s, false) = false then 'stale_quote'
      when coalesce(futopt_ready, false) = false then 'futopt_not_ready'
      else 'unknown'
    end,
    jsonb_build_object(
      'source', 'v_futopt_stock_mapping_ready',
      'has_mapping', has_mapping,
      'has_quote', has_quote,
      'quote_fresh_180s', quote_fresh_180s,
      'futopt_ready', futopt_ready,
      'quote_age_seconds', quote_age_seconds,
      'quote_updated_at', quote_updated_at,
      'fut_change_percent', fut_change_percent,
      'txf_change_percent', txf_change_percent,
      'rel_to_txf', rel_to_txf,
      'total_volume', total_volume
    )
  from public.v_futopt_stock_mapping_ready
  where coalesce(has_mapping, false) = true
    and not (
      coalesce(has_quote, false) = true
      and coalesce(quote_fresh_180s, false) = true
      and coalesce(futopt_ready, false) = true
    );

  insert into public.strategy2_readiness_missing_cache (
    checked_at, gate, symbol, name, future_symbol, missing_reason, details
  )
  select
    v_checked_at,
    '08:55_preopen_hot',
    symbol,
    name,
    null,
    case
      when coalesce(has_3_snapshots_last_1m, false) = false then 'missing_3_snapshots_last_1m'
      when coalesce(final_blind_buy_history_ready, false) = false then 'final_blind_buy_history_not_ready'
      else 'unknown'
    end,
    jsonb_build_object(
      'source', 'v_fugle_preopen_final_blind_buy_ready',
      'reference_price', reference_price,
      'trial_price', trial_price,
      'is_trial', is_trial,
      'is_limit_up_bid', is_limit_up_bid,
      'best_bid_price', best_bid_price,
      'bid_volume', bid_volume,
      'ask_volume', ask_volume,
      'snapshots_last_1m', snapshots_last_1m,
      'has_3_snapshots_last_1m', has_3_snapshots_last_1m,
      'final_blind_buy_history_ready', final_blind_buy_history_ready,
      'latest_observed_at', latest_observed_at
    )
  from public.v_fugle_preopen_final_blind_buy_ready
  where not (
    coalesce(has_3_snapshots_last_1m, false) = true
    and coalesce(final_blind_buy_history_ready, false) = true
  );

  insert into public.strategy2_readiness_missing_cache (
    checked_at, gate, symbol, name, future_symbol, missing_reason, details
  )
  select
    v_checked_at,
    '09:00_12:00_intraday_1m',
    symbol,
    name,
    null,
    'intraday_1m_not_ready_ge_35',
    jsonb_build_object(
      'source', 'v_strategy2_intraday_ready',
      'today_candle_count', today_candle_count,
      'latest_candle_time', latest_candle_time,
      'ready_ge_35', ready_ge_35,
      'quote_age_seconds', quote_age_seconds,
      'quote_updated_at', quote_updated_at,
      'price', price,
      'change_percent', change_percent,
      'total_volume', total_volume
    )
  from public.v_strategy2_intraday_ready
  where not (
    coalesce(ready_ge_35, false) = true
    or coalesce(today_candle_count, 0) >= 35
  );

  select
    count(*) filter (where coalesce(has_mapping, false) = true),
    count(*) filter (
      where coalesce(has_mapping, false) = true
        and coalesce(has_quote, false) = true
        and coalesce(quote_fresh_180s, false) = true
        and coalesce(futopt_ready, false) = true
    )
  into v_futopt_expected, v_futopt_ready
  from public.v_futopt_stock_mapping_ready;

  select count(distinct symbol)
  into v_preopen_snapshot
  from public.fugle_preopen_snapshot
  where symbol is not null;

  select
    count(*),
    count(*) filter (
      where coalesce(has_3_snapshots_last_1m, false) = true
        and coalesce(final_blind_buy_history_ready, false) = true
    )
  into v_preopen_hot_expected, v_preopen_hot_ready
  from public.v_fugle_preopen_final_blind_buy_ready;

  select
    count(*),
    count(*) filter (
      where coalesce(ready_ge_35, false) = true
         or coalesce(today_candle_count, 0) >= 35
    )
  into v_intraday_expected, v_intraday_ready
  from public.v_strategy2_intraday_ready;

  select
    l.run_id,
    l.scan_date,
    l.finished_at,
    l.status,
    l.complete,
    l.result_count,
    l.record_count,
    l.event_count,
    l.entry_count,
    l.payload
  into v_latest
  from (select 1) anchor
  left join lateral (
    select *
    from public.v_strategy2_latest_complete_run
    limit 1
  ) l on true;

  if v_latest.run_id is not null then
    v_execution_expected := coalesce(
      public.strategy2_numeric_payload_value(v_latest.payload, 'total', 'totalCount', 'expected_total', 'expectedTotal', 'sourceCount'),
      v_latest.record_count,
      v_latest.result_count,
      0
    );
    v_execution_scanned := coalesce(
      public.strategy2_numeric_payload_value(v_latest.payload, 'scanned', 'scannedCount', 'scanned_count'),
      case
        when jsonb_typeof(v_latest.payload -> 'scannedCodes') = 'array'
        then jsonb_array_length(v_latest.payload -> 'scannedCodes')::numeric
        else null
      end,
      v_latest.record_count,
      v_latest.result_count,
      0
    );
  end if;

  if v_futopt_expected <= 0 or v_futopt_ready <> v_futopt_expected then
    v_reasons := array_append(v_reasons, format('08:45 futopt %s/%s ready', v_futopt_ready, v_futopt_expected));
  end if;
  if v_preopen_hot_ready <> v_preopen_hot_expected then
    v_reasons := array_append(v_reasons, format('08:55 preopen_hot %s/%s ready', v_preopen_hot_ready, v_preopen_hot_expected));
  end if;
  if v_intraday_expected <= 0 or v_intraday_ready <> v_intraday_expected then
    v_reasons := array_append(v_reasons, format('09:00-12:00 intraday_1m %s/%s ready', v_intraday_ready, v_intraday_expected));
  end if;
  if v_latest.run_id is null
     or v_latest.complete is not true
     or v_latest.status <> 'complete'
     or v_execution_expected <= 0
     or v_execution_scanned <> v_execution_expected then
    v_reasons := array_append(v_reasons, format('execution %s/%s scanned latest=%s', v_execution_scanned, v_execution_expected, coalesce(v_latest.run_id, 'missing')));
  end if;

  v_ready_100 := array_length(v_reasons, 1) is null;
  v_status := case when v_ready_100 then 'ready' else 'not_ready' end;

  select coalesce(
    jsonb_agg(jsonb_build_object('gate', gate, 'missing_reason', missing_reason, 'rows', rows) order by gate, rows desc),
    '[]'::jsonb
  )
  into v_missing_summary
  from (
    select gate, missing_reason, count(*) as rows
    from public.strategy2_readiness_missing_cache
    group by gate, missing_reason
  ) grouped;

  if v_latest.run_id is null
     or v_latest.complete is not true
     or v_latest.status <> 'complete'
     or v_execution_expected <= 0
     or v_execution_scanned <> v_execution_expected then
    insert into public.strategy2_readiness_missing_cache (
      checked_at, gate, symbol, name, future_symbol, missing_reason, details
    ) values (
      v_checked_at,
      '09:00_12:00_execution',
      coalesce(v_latest.run_id, ''),
      'latest_complete_run',
      null,
      case
        when v_latest.run_id is null then 'latest_run_missing'
        when v_latest.complete is not true then 'latest_run_not_complete'
        when v_latest.status <> 'complete' then 'latest_status_not_complete'
        when v_execution_expected <= 0 then 'execution_denominator_missing'
        when v_execution_scanned <> v_execution_expected then 'execution_not_100_percent'
        else 'unknown'
      end,
      jsonb_build_object(
        'source', 'v_strategy2_latest_complete_run',
        'run_id', v_latest.run_id,
        'scan_date', v_latest.scan_date,
        'finished_at', v_latest.finished_at,
        'status', v_latest.status,
        'complete', v_latest.complete,
        'result_count', v_latest.result_count,
        'record_count', v_latest.record_count,
        'event_count', v_latest.event_count,
        'entry_count', v_latest.entry_count,
        'execution_expected', v_execution_expected,
        'execution_scanned', v_execution_scanned
      )
    );
  end if;

  insert into public.strategy2_readiness_status_cache (
    id,
    checked_at,
    status,
    reason,
    strategy2_ready_100,
    futopt_expected_count,
    futopt_ready_count,
    futopt_coverage,
    futopt_ready,
    preopen_snapshot_count,
    preopen_hot_candidate_count,
    preopen_hot_ready_count,
    preopen_hot_coverage,
    preopen_hot_ready,
    detection_expected_count,
    intraday_1m_ready_count,
    intraday_1m_coverage,
    intraday_1m_ready,
    latest_run_id,
    latest_scan_date,
    latest_finished_at,
    latest_status,
    latest_complete,
    latest_result_count,
    latest_record_count,
    latest_event_count,
    latest_entry_count,
    latest_execution_expected,
    latest_execution_scanned,
    latest_execution_rate,
    execution_ready,
    missing_summary
  ) values (
    'latest',
    v_checked_at,
    v_status,
    array_to_string(v_reasons, '; '),
    v_ready_100,
    v_futopt_expected,
    v_futopt_ready,
    case when v_futopt_expected > 0 then v_futopt_ready::numeric / v_futopt_expected else 0 end,
    v_futopt_expected > 0 and v_futopt_ready = v_futopt_expected,
    v_preopen_snapshot,
    v_preopen_hot_expected,
    v_preopen_hot_ready,
    case when v_preopen_hot_expected > 0 then v_preopen_hot_ready::numeric / v_preopen_hot_expected else 0 end,
    v_preopen_hot_ready = v_preopen_hot_expected,
    v_intraday_expected,
    v_intraday_ready,
    case when v_intraday_expected > 0 then v_intraday_ready::numeric / v_intraday_expected else 0 end,
    v_intraday_expected > 0 and v_intraday_ready = v_intraday_expected,
    v_latest.run_id,
    v_latest.scan_date,
    v_latest.finished_at,
    v_latest.status,
    v_latest.complete,
    v_latest.result_count,
    v_latest.record_count,
    v_latest.event_count,
    v_latest.entry_count,
    v_execution_expected,
    v_execution_scanned,
    case when v_execution_expected > 0 then v_execution_scanned / v_execution_expected else 0 end,
    v_latest.complete = true and v_latest.status = 'complete' and v_execution_expected > 0 and v_execution_scanned = v_execution_expected,
    v_missing_summary
  )
  on conflict (id) do update set
    checked_at = excluded.checked_at,
    status = excluded.status,
    reason = excluded.reason,
    strategy2_ready_100 = excluded.strategy2_ready_100,
    futopt_expected_count = excluded.futopt_expected_count,
    futopt_ready_count = excluded.futopt_ready_count,
    futopt_coverage = excluded.futopt_coverage,
    futopt_ready = excluded.futopt_ready,
    preopen_snapshot_count = excluded.preopen_snapshot_count,
    preopen_hot_candidate_count = excluded.preopen_hot_candidate_count,
    preopen_hot_ready_count = excluded.preopen_hot_ready_count,
    preopen_hot_coverage = excluded.preopen_hot_coverage,
    preopen_hot_ready = excluded.preopen_hot_ready,
    detection_expected_count = excluded.detection_expected_count,
    intraday_1m_ready_count = excluded.intraday_1m_ready_count,
    intraday_1m_coverage = excluded.intraday_1m_coverage,
    intraday_1m_ready = excluded.intraday_1m_ready,
    latest_run_id = excluded.latest_run_id,
    latest_scan_date = excluded.latest_scan_date,
    latest_finished_at = excluded.latest_finished_at,
    latest_status = excluded.latest_status,
    latest_complete = excluded.latest_complete,
    latest_result_count = excluded.latest_result_count,
    latest_record_count = excluded.latest_record_count,
    latest_event_count = excluded.latest_event_count,
    latest_entry_count = excluded.latest_entry_count,
    latest_execution_expected = excluded.latest_execution_expected,
    latest_execution_scanned = excluded.latest_execution_scanned,
    latest_execution_rate = excluded.latest_execution_rate,
    execution_ready = excluded.execution_ready,
    missing_summary = excluded.missing_summary;

  return jsonb_build_object(
    'ok', v_ready_100,
    'status', v_status,
    'reason', array_to_string(v_reasons, '; '),
    'missing_summary', v_missing_summary
  );
end;
$$;

drop view if exists public.v_strategy2_readiness_missing;
drop view if exists public.v_strategy2_readiness_status;

create or replace view public.v_strategy2_readiness_status as
select *
from public.strategy2_readiness_status_cache
where id = 'latest';

create or replace view public.v_strategy2_readiness_missing as
select
  checked_at,
  gate,
  symbol,
  name,
  future_symbol,
  missing_reason,
  details
from public.strategy2_readiness_missing_cache;

alter table public.strategy2_readiness_status_cache enable row level security;
alter table public.strategy2_readiness_missing_cache enable row level security;

drop policy if exists "read strategy2 readiness status" on public.strategy2_readiness_status_cache;
create policy "read strategy2 readiness status"
on public.strategy2_readiness_status_cache
for select
using (true);

drop policy if exists "read strategy2 readiness missing" on public.strategy2_readiness_missing_cache;
create policy "read strategy2 readiness missing"
on public.strategy2_readiness_missing_cache
for select
using (true);

grant select on public.strategy2_readiness_status_cache to anon;
grant select on public.strategy2_readiness_missing_cache to anon;
grant select on public.v_strategy2_readiness_status to anon;
grant select on public.v_strategy2_readiness_missing to anon;

grant select, insert, update, delete on public.strategy2_readiness_status_cache to service_role;
grant select, insert, update, delete on public.strategy2_readiness_missing_cache to service_role;
grant usage, select on sequence public.strategy2_readiness_missing_cache_id_seq to service_role;
grant execute on function public.strategy2_numeric_payload_value(jsonb, text[]) to service_role;
grant execute on function public.refresh_strategy2_readiness_cache() to service_role;
grant select on public.v_strategy2_readiness_status to service_role;
grant select on public.v_strategy2_readiness_missing to service_role;

select public.refresh_strategy2_readiness_cache();

notify pgrst, 'reload schema';
