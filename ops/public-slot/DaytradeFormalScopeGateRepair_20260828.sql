begin;

-- 2026-08-28 repair: dynamic formal scope is the only formal freshness gate.
-- Mother Pool size and broad freshness remain diagnostic readback fields.

-- Canonical gates must consume the writer's dynamic formal-scan scope, rather
-- than deriving a legacy fixed 40-symbol subset from rank order.
create or replace view public.v_fugle_daytrade_mother_pool_contract_health as
with source_row as (
  select
    coalesce((
      select s.payload
      from public.source_status s
      where s.source_name = 'fugle_daytrade_source'
      order by s.updated_at desc
      limit 1
    ), '{}'::jsonb) as payload,
    coalesce((
      select s.updated_at
      from public.source_status s
      where s.source_name = 'fugle_daytrade_source'
      order by s.updated_at desc
      limit 1
    ), to_timestamp(0)) as source_updated_at
),
metadata as (
  select
    min(p.priority_rank)::integer as min_mother_rank,
    max(p.priority_rank)::integer as max_mother_rank,
    max(p.updated_at) as mother_updated_at,
    count(*) filter (where d.symbol is not null)::bigint as mother_daily_volume_rows
  from public.fugle_daytrade_priority_pool p
  left join public.fugle_daytrade_daily_volume_avg d on d.symbol = p.symbol
  where p.payload ->> 'basePoolEligible' = 'true'
),
dynamic_scope as (
  select
    coalesce((payload ->> 'mother_pool_symbols')::bigint, 0) as mother_pool_symbols,
    coalesce((payload ->> 'mother_pool_fresh_quotes_120s')::bigint, 0) as mother_fresh_quote_rows,
    coalesce((payload ->> 'mother_pool_fresh_coverage_120s')::numeric, 0) as mother_fresh_quote_coverage_120s,
    coalesce((payload ->> 'formal_scan_pool_symbols')::bigint, 0) as formal_priority_symbols,
    coalesce((payload ->> 'formal_deep_scan_fresh_quotes_120s')::bigint, 0) as formal_fresh_quote_rows,
    coalesce((payload ->> 'formal_deep_scan_fresh_quote_coverage_120s')::numeric, 0) as formal_fresh_quote_coverage_120s,
    coalesce((payload ->> 'formal_scan_max_quote_age_seconds')::integer, 999999) as formal_max_quote_age_seconds,
    coalesce((payload ->> 'daily_volume_rows')::bigint, 0) as daily_volume_rows,
    coalesce((payload ->> 'ready_ma20_continuous')::bigint, 0) as daytrade_ready_ma20_continuous_symbols,
    coalesce((payload ->> 'ready_ma35_continuous')::bigint, 0) as daytrade_ready_ma35_continuous_symbols
  from source_row
),
projected as (
  select
    d.*,
    m.min_mother_rank,
    m.max_mother_rank,
    m.mother_updated_at,
    m.mother_daily_volume_rows,
    case
      when d.formal_priority_symbols > 0
       and d.formal_priority_symbols <= d.mother_pool_symbols
       and d.formal_fresh_quote_coverage_120s >= 0.95
       and d.formal_max_quote_age_seconds <= 120
      then 'ready'
      else 'not_ready'
    end::text as contract_status
  from dynamic_scope d
  cross join metadata m
)
select
  'fugle_daytrade_source'::text as source_name,
  case when contract_status = 'ready' then 'ready' else 'degraded' end::text as source_status,
  source_row.source_updated_at,
  case when contract_status = 'ready'
    then format('dynamic formal scan ready; formal=%s/%s', formal_priority_symbols, mother_pool_symbols)
    else format('dynamic formal scan pending; formal=%s/%s', formal_priority_symbols, mother_pool_symbols)
  end::text as source_message,
  'dynamic_daytrade_mother_pool'::text as mother_pool_source,
  'daytrade_mother_pool_dynamic_discovery_union_20260827'::text as mother_pool_rule_version,
  'priority_hot_deep_scan_pool_only'::text as formal_scope,
  0::integer as formal_priority_limit,
  mother_pool_symbols,
  formal_priority_symbols,
  mother_fresh_quote_rows,
  formal_fresh_quote_rows,
  mother_fresh_quote_coverage_120s,
  formal_fresh_quote_coverage_120s,
  mother_daily_volume_rows,
  daily_volume_rows as formal_daily_volume_rows,
  daytrade_ready_ma20_continuous_symbols,
  daytrade_ready_ma35_continuous_symbols,
  min_mother_rank,
  max_mother_rank,
  mother_updated_at,
  null::integer as formal_max_mother_rank,
  formal_max_quote_age_seconds,
  null::double precision as formal_p95_quote_age_seconds,
  contract_status,
  case when contract_status = 'ready' then '' else 'dynamic_formal_scan_scope_not_ready' end::text as contract_reason,
  50::numeric as mother_pool_min_price,
  true as mother_pool_price_floor_enforced
from projected
cross join source_row;

grant select on public.v_fugle_daytrade_mother_pool_contract_health to anon, authenticated, service_role;
notify pgrst, 'reload schema';

-- Live compatibility: older production tables may lack this formal source disclosure column.
alter table public.fugle_daytrade_intraday_1m
  add column if not exists synthetic boolean not null default false;

-- Daytrade formal WebSocket contract addendum, 2026-07-21.
-- Formal daytrade A requires Fugle WebSocket evidence. REST may seed/backfill only.
alter table public.fugle_daytrade_daily_volume_avg
  add column if not exists avg5_volume numeric;

alter table public.fugle_daytrade_daily_volume_avg
  add column if not exists daily_volume_status text not null default 'ready';

update public.fugle_daytrade_daily_volume_avg
set avg5_volume = avg_volume5
where avg5_volume is null and avg_volume5 is not null;

update public.fugle_daytrade_daily_volume_avg
set daily_volume_status = case when coalesce(avg_volume5, avg5_volume, 0) > 0 then 'ready' else 'missing' end
where daily_volume_status is null
   or daily_volume_status not in ('ready', 'missing');

create or replace function public.sync_fugle_daytrade_daily_volume_avg_aliases()
returns trigger
language plpgsql
as $$
begin
  if new.avg_volume5 is null and new.avg5_volume is not null then
    new.avg_volume5 := new.avg5_volume;
  end if;
  if new.avg5_volume is null and new.avg_volume5 is not null then
    new.avg5_volume := new.avg_volume5;
  end if;
  new.daily_volume_status := case when coalesce(new.avg_volume5, new.avg5_volume, 0) > 0 then 'ready' else 'missing' end;
  return new;
end;
$$;

drop trigger if exists trg_sync_fugle_daytrade_daily_volume_avg_aliases on public.fugle_daytrade_daily_volume_avg;
create trigger trg_sync_fugle_daytrade_daily_volume_avg_aliases
before insert or update on public.fugle_daytrade_daily_volume_avg
for each row execute function public.sync_fugle_daytrade_daily_volume_avg_aliases();

create index if not exists idx_fugle_daytrade_intraday_1m_symbol_candle_time_desc
  on public.fugle_daytrade_intraday_1m(symbol, candle_time desc);

create or replace function public.get_fugle_daytrade_intraday_1m_latest_n(
  symbols text[],
  bars_per_symbol integer default 200
)
returns table (
  symbol text,
  market text,
  trade_date date,
  candle_time timestamptz,
  open numeric,
  high numeric,
  low numeric,
  close numeric,
  volume numeric,
  source text,
  synthetic boolean,
  updated_at timestamptz,
  payload jsonb
)
language sql
stable
as $$
  with requested_symbols as (
    select distinct nullif(regexp_replace(value, '\D', '', 'g'), '') as symbol
    from unnest(coalesce(symbols, array[]::text[])) as input(value)
  ),
  limits as (
    select greatest(1, least(coalesce(bars_per_symbol, 200), 500)) as bars_per_symbol
  )
  select
    m.symbol,
    m.market,
    m.trade_date,
    m.candle_time,
    m.open,
    m.high,
    m.low,
    m.close,
    m.volume,
    m.source,
    m.synthetic,
    m.updated_at,
    m.payload
  from requested_symbols s
  cross join limits l
  cross join lateral (
    select
      i.symbol,
      i.market,
      i.trade_date,
      i.candle_time,
      i.open,
      i.high,
      i.low,
      i.close,
      i.volume,
      i.source,
      i.synthetic,
      i.updated_at,
      i.payload
    from public.fugle_daytrade_intraday_1m i
    where i.symbol = s.symbol
    order by i.candle_time desc
    limit l.bars_per_symbol
  ) m
  where s.symbol is not null
  order by m.symbol asc, m.candle_time desc;
$$;

grant execute on function public.get_fugle_daytrade_intraday_1m_latest_n(text[], integer) to anon, authenticated, service_role;
create or replace view public.v_fugle_daytrade_canonical_gate as
with status_row as (
  select
    s.source_name,
    s.status as source_status,
    s.updated_at,
    s.message,
    s.payload
  from public.source_status s
  where s.source_name = 'fugle_daytrade_source'
  order by s.updated_at desc
  limit 1
),
current_clock as (
  select
    ((extract(hour from now() at time zone 'Asia/Taipei')::integer * 60)
      + extract(minute from now() at time zone 'Asia/Taipei')::integer) as taipei_minutes
),
futopt_snapshot as (
  select
    count(*) filter (
      where coalesce(product, '') = 'STOCK_FUTURE'
        or nullif(underlying_symbol, '') is not null and upper(coalesce(underlying_symbol, '')) <> 'TXF'
    )::integer as futopt_contract_rows,
    count(*) filter (
      where (coalesce(product, '') = 'STOCK_FUTURE'
        or nullif(underlying_symbol, '') is not null and upper(coalesce(underlying_symbol, '')) <> 'TXF')
        and updated_at >= now() - interval '180 seconds'
    )::integer as futopt_ready_rows,
    count(*) filter (
      where (coalesce(product, '') = 'STOCK_FUTURE'
        or nullif(underlying_symbol, '') is not null and upper(coalesce(underlying_symbol, '')) <> 'TXF')
        and (updated_at is null or updated_at < now() - interval '180 seconds')
    )::integer as futopt_stale_rows,
    max(updated_at) filter (
      where coalesce(product, '') = 'STOCK_FUTURE'
        or nullif(underlying_symbol, '') is not null and upper(coalesce(underlying_symbol, '')) <> 'TXF'
    ) as latest_futopt_updated_at,
    max(updated_at) filter (
      where upper(coalesce(product, '')) = 'TXF'
         or upper(coalesce(underlying_symbol, '')) = 'TXF'
         or upper(coalesce(future_symbol, '')) like 'TXF%'
    ) as latest_txf_updated_at,
    coalesce(
      max(updated_at) filter (
        where upper(coalesce(product, '')) = 'TXF'
           or upper(coalesce(underlying_symbol, '')) = 'TXF'
           or upper(coalesce(future_symbol, '')) like 'TXF%'
      ) >= now() - interval '180 seconds',
      false
    ) as futopt_txf_ok,
    case
      when count(*) filter (
        where coalesce(product, '') = 'STOCK_FUTURE'
          or nullif(underlying_symbol, '') is not null and upper(coalesce(underlying_symbol, '')) <> 'TXF'
      ) = 0 then 'not_ready'
      when coalesce(
        max(updated_at) filter (
          where upper(coalesce(product, '')) = 'TXF'
             or upper(coalesce(underlying_symbol, '')) = 'TXF'
             or upper(coalesce(future_symbol, '')) like 'TXF%'
        ) >= now() - interval '180 seconds',
        false
      ) is not true then 'stale'
      when count(*) filter (
        where (coalesce(product, '') = 'STOCK_FUTURE'
          or nullif(underlying_symbol, '') is not null and upper(coalesce(underlying_symbol, '')) <> 'TXF')
          and updated_at >= now() - interval '180 seconds'
      ) > 0 then 'ready'
      else 'stale'
    end as raw_futopt_gate_status,
    case
      when count(*) filter (
        where coalesce(product, '') = 'STOCK_FUTURE'
          or nullif(underlying_symbol, '') is not null and upper(coalesce(underlying_symbol, '')) <> 'TXF'
      ) = 0 then 'no_contract'
      when max(updated_at) filter (
        where coalesce(product, '') = 'STOCK_FUTURE'
          or nullif(underlying_symbol, '') is not null and upper(coalesce(underlying_symbol, '')) <> 'TXF'
      ) is null then 'no_quote'
      when coalesce(
        max(updated_at) filter (
          where upper(coalesce(product, '')) = 'TXF'
             or upper(coalesce(underlying_symbol, '')) = 'TXF'
             or upper(coalesce(future_symbol, '')) like 'TXF%'
        ) >= now() - interval '180 seconds',
        false
      ) is not true then 'txf_stale'
      when count(*) filter (
        where (coalesce(product, '') = 'STOCK_FUTURE'
          or nullif(underlying_symbol, '') is not null and upper(coalesce(underlying_symbol, '')) <> 'TXF')
          and updated_at >= now() - interval '180 seconds'
      ) > 0 then 'ready'
      else 'futopt_stale'
    end as raw_futopt_reason
  from public.fugle_daytrade_futopt_quotes_live
),
mother_pool_health as (
  select
    coalesce(mother_pool_symbols, 0)::integer as mother_pool_symbols,
    coalesce(mother_fresh_quote_coverage_120s, 0)::numeric as mother_fresh_quote_coverage_120s,
    coalesce(formal_priority_symbols, 0)::integer as formal_priority_symbols,
    coalesce(formal_fresh_quote_coverage_120s, 0)::numeric as formal_fresh_quote_coverage_120s,
    coalesce(formal_max_quote_age_seconds, 999999)::integer as formal_max_quote_age_seconds,
    coalesce(formal_scope, 'priority_hot_deep_scan_pool_only')::text as formal_scope
  from public.v_fugle_daytrade_mother_pool_contract_health
  limit 1
),
normalized as (
  select
    coalesce(source_name, 'fugle_daytrade_source') as source_name,
    coalesce(source_status, 'missing') as source_status,
    updated_at,
    coalesce(message, 'dedicated daytrade source missing') as message,
    coalesce((payload->>'daytrade_gate_grade'), 'D') as daytrade_gate_grade,
    coalesce((payload->>'priority_gate_grade'), 'D') as priority_gate_grade,
    coalesce((payload->>'full_market_gate_grade'), 'D') as full_market_gate_grade,
    coalesce((payload->>'daytrade_source_speed_ok')::boolean, false) as daytrade_source_speed_ok,
    coalesce((payload->>'formal_entry_allowed')::boolean, false) as writer_formal_entry_allowed,
    coalesce((payload->>'scanner_can_run_quote_only')::boolean, false) as scanner_can_run_quote_only,
    coalesce((payload->>'scanner_can_run_opening')::boolean, false) as scanner_can_run_opening,
    coalesce((payload->>'selected_symbols_fresh_ok')::boolean, false) as selected_symbols_fresh_ok,
    coalesce((payload->>'priority_fresh_quote_coverage_120s')::numeric, 0) as priority_fresh_quote_coverage_120s,
    coalesce((payload->>'priority_fresh_quotes_120s')::integer, 0) as priority_fresh_quotes_120s,
    coalesce((payload->>'priority_pool_symbols')::integer, 0) as priority_pool_symbols,
    mother_pool_health.mother_pool_symbols,
    mother_pool_health.mother_fresh_quote_coverage_120s,
    mother_pool_health.formal_priority_symbols,
    mother_pool_health.formal_fresh_quote_coverage_120s,
    mother_pool_health.formal_max_quote_age_seconds,
    mother_pool_health.formal_scope,
    coalesce((payload->>'fresh_quote_coverage_120s')::numeric, 0) as fresh_quote_coverage_120s,
    coalesce((payload->>'fresh_quotes_120s')::integer, 0) as fresh_quotes_120s,
    coalesce((payload->>'active_symbols')::integer, 0) as active_symbols,
    coalesce((payload->>'quote_age_seconds')::integer, 999999) as quote_age_seconds,
    coalesce((payload->>'daily_volume_status'), 'unknown') as daily_volume_status,
    coalesce((payload->>'ready_ma20_continuous')::integer, 0) as ready_ma20_continuous_symbols,
    coalesce((payload->>'ready_ma35_continuous')::integer, 0) as ready_ma35_continuous_symbols,
    coalesce((payload->>'intraday_1m_stale_seconds')::integer, 999999) as intraday_1m_stale_seconds,
    coalesce((payload->>'today_1m_symbols')::integer, 0) as today_1m_symbols,
    coalesce((payload->>'today_1m_rows')::integer, 0) as today_1m_rows,
    coalesce((payload->>'futopt_stock_mapped')::integer, 0) as futopt_stock_mapped,
    coalesce((payload->>'rate_limit_status'), 'unknown') as rate_limit_status,
    coalesce(payload->>'quote_transport', '') as quote_transport,
    coalesce(nullif(payload->>'websocket_status_ok', '')::boolean, false) as websocket_status_ok,
    coalesce(payload->>'websocket_mode', '') as websocket_mode,
    coalesce(nullif(payload->>'websocket_connected', '')::boolean, false) as websocket_connected,
    coalesce(nullif(payload->>'websocket_authenticated', '')::boolean, false) as websocket_authenticated,
    coalesce(nullif(payload->>'websocket_subscribed', '')::integer, 0) as websocket_subscribed,
    coalesce(nullif(payload->>'websocket_subscribed_symbols', '')::integer, 0) as websocket_subscribed_symbols,
    coalesce(payload->'websocket_streaming_channels', '[]'::jsonb) as websocket_streaming_channels,
    coalesce(nullif(payload->>'websocket_rest_disabled', '')::boolean, false) as websocket_rest_disabled,
    nullif(payload->>'websocket_status_updated_at', '')::timestamptz as websocket_status_updated_at,
    coalesce(nullif(payload->>'websocket_last_message_age_seconds', '')::integer, 999999) as websocket_last_message_age_seconds,
    coalesce(nullif(payload->>'formal_priority_strategy_chip_complete_latest_run_evidence', '')::boolean, false) as formal_priority_strategy_chip_complete_latest_run_evidence,
    coalesce(payload->>'formal_priority_strategy_chip_status', 'missing') as formal_priority_strategy_chip_status,
    coalesce((payload->>'phase'), '') as phase,
    coalesce(payload->>'formal_quote_source', 'fugle_daytrade_quotes_live') as formal_quote_source,
    coalesce(payload->>'formal_intraday_1m_source', 'fugle_daytrade_intraday_1m') as formal_intraday_1m_source,
    coalesce(payload, '{}'::jsonb) as payload,
    (taipei_minutes >= 525 and taipei_minutes <= 810) as futopt_contract_required,
    case
      when taipei_minutes < 360 then 'closed_before_0600'
      when taipei_minutes < 510 then 'warmup_0600_0829'
      when taipei_minutes < 525 then 'preopen_prepare_0830_0844'
      when taipei_minutes < 540 then 'opening_boost_0845_0859'
      when taipei_minutes < 575 then 'opening_detection_0900_0934'
      when taipei_minutes <= 810 then 'regular_daytrade_0935_1330'
      else 'after_daytrade_window'
    end as current_phase
  from status_row
  cross join current_clock
  cross join mother_pool_health
),
scored as (
  select
    *,
    coalesce(extract(epoch from (now() - greatest(coalesce(websocket_status_updated_at, updated_at), updated_at)))::integer, 999999) as websocket_status_age_seconds,
    (
      websocket_status_ok is true
      and websocket_connected is true
      and websocket_authenticated is true
      and websocket_mode = 'streaming'
      and quote_transport like 'websocket_%'
      and websocket_rest_disabled is true
      and (websocket_streaming_channels ? 'trades')
      and (websocket_streaming_channels ? 'aggregates')
      and (websocket_streaming_channels ? 'candles')
      and (coalesce(extract(epoch from (now() - greatest(coalesce(websocket_status_updated_at, updated_at), updated_at)))::integer, 999999) <= 300 and websocket_last_message_age_seconds <= 300)
    ) as websocket_formal_ready,
    (formal_quote_source in ('fugle_daytrade_quotes_live', 'v_fugle_daytrade_priority_readiness') and quote_transport like 'websocket_%') as quote_source_daytrade_ok,
    (formal_intraday_1m_source in ('fugle_daytrade_intraday_1m', 'v_fugle_daytrade_intraday_1m_status', 'v_strategy2_intraday_ready')
      or formal_intraday_1m_source like 'dedicated_daytrade_intraday_1m%') as intraday_1m_source_daytrade_ok,
    (
      source_status = 'ok'
      and daytrade_gate_grade = 'A'
      and daytrade_source_speed_ok is true
      and websocket_status_ok is true
      and websocket_connected is true
      and websocket_authenticated is true
      and websocket_mode = 'streaming'
      and quote_transport like 'websocket_%'
      and websocket_rest_disabled is true
      and (websocket_streaming_channels ? 'trades')
      and (websocket_streaming_channels ? 'aggregates')
      and (websocket_streaming_channels ? 'candles')
      and (coalesce(extract(epoch from (now() - greatest(coalesce(websocket_status_updated_at, updated_at), updated_at)))::integer, 999999) <= 300 and websocket_last_message_age_seconds <= 300)
      and writer_formal_entry_allowed is true
      and scanner_can_run_opening is true
      and formal_priority_symbols > 0 and formal_priority_symbols <= priority_pool_symbols
      and formal_fresh_quote_coverage_120s >= 0.95
      and formal_max_quote_age_seconds <= 120
      and formal_scope = 'priority_hot_deep_scan_pool_only'
      and formal_priority_strategy_chip_complete_latest_run_evidence is true
      and quote_age_seconds <= 90
      and intraday_1m_stale_seconds <= 120
      and ready_ma20_continuous_symbols > 0
      and ready_ma35_continuous_symbols > 0
      and (formal_quote_source in ('fugle_daytrade_quotes_live', 'v_fugle_daytrade_priority_readiness') and quote_transport like 'websocket_%')
      and (formal_intraday_1m_source in ('fugle_daytrade_intraday_1m', 'v_fugle_daytrade_intraday_1m_status', 'v_strategy2_intraday_ready') or formal_intraday_1m_source like 'dedicated_daytrade_intraday_1m%')
      and rate_limit_status not in ('rate_limited', 'cooldown')
      and (not futopt_contract_required or raw_futopt_gate_status = 'ready')
    ) as canonical_ready,
    (
      (source_status = 'ok')::integer
      + (daytrade_gate_grade = 'A')::integer
      + (daytrade_source_speed_ok is true)::integer
      + (websocket_status_ok is true)::integer
      + (websocket_connected is true)::integer
      + (websocket_authenticated is true)::integer
      + (websocket_mode = 'streaming')::integer
      + (quote_transport like 'websocket_%')::integer
      + (websocket_rest_disabled is true)::integer
      + ((websocket_streaming_channels ? 'trades') and (websocket_streaming_channels ? 'aggregates') and (websocket_streaming_channels ? 'candles'))::integer
      + ((coalesce(extract(epoch from (now() - greatest(coalesce(websocket_status_updated_at, updated_at), updated_at)))::integer, 999999) <= 300 and websocket_last_message_age_seconds <= 300))::integer
      + (writer_formal_entry_allowed is true)::integer
      + (scanner_can_run_opening is true)::integer
      + (formal_priority_symbols > 0 and formal_priority_symbols <= priority_pool_symbols)::integer
      + (formal_fresh_quote_coverage_120s >= 0.95)::integer
      + (formal_max_quote_age_seconds <= 120)::integer
      + (formal_scope = 'priority_hot_deep_scan_pool_only')::integer
      + (formal_priority_strategy_chip_complete_latest_run_evidence is true)::integer
      + (quote_age_seconds <= 90)::integer
      + (intraday_1m_stale_seconds <= 120)::integer
      + (ready_ma20_continuous_symbols > 0)::integer
      + (ready_ma35_continuous_symbols > 0)::integer
      + ((formal_quote_source in ('fugle_daytrade_quotes_live', 'v_fugle_daytrade_priority_readiness') and quote_transport like 'websocket_%') and (formal_intraday_1m_source in ('fugle_daytrade_intraday_1m', 'v_fugle_daytrade_intraday_1m_status', 'v_strategy2_intraday_ready') or formal_intraday_1m_source like 'dedicated_daytrade_intraday_1m%'))::integer
      + (rate_limit_status not in ('rate_limited', 'cooldown'))::integer
      + (daily_volume_status = 'ready')::integer
      + (scanner_can_run_quote_only is true)::integer
      + (selected_symbols_fresh_ok is true)::integer
      + (fresh_quotes_120s > 0)::integer
      + (active_symbols > 0)::integer
      + (updated_at is not null)::integer
      + (not futopt_contract_required or raw_futopt_gate_status = 'ready')::integer
    ) as scorecard_required_ok_count
  from normalized
    cross join futopt_snapshot
),
projected as (
  select
    *,
    (quote_source_daytrade_ok and intraday_1m_source_daytrade_ok) as formal_source_alignment_ok,
    case when canonical_ready then 'A' else 'D' end as final_gate_grade,
    case when canonical_ready then 'ready' else 'not_ready' end as final_gate_status,
    case
      when canonical_ready then ''
      when source_status <> 'ok' then 'source_status_not_ok'
      when daytrade_gate_grade <> 'A' then 'daytrade_gate_not_a'
      when daytrade_source_speed_ok is not true then 'daytrade_source_speed_not_ok'
      when futopt_contract_required and raw_futopt_gate_status <> 'ready' then 'futopt_not_ready'
      when websocket_formal_ready is not true then 'websocket_not_formal_ready'
      when writer_formal_entry_allowed is not true then 'formal_entry_not_allowed'
      when scanner_can_run_opening is not true then 'scanner_can_run_opening_false'
      when formal_priority_symbols <= 0 or formal_priority_symbols > priority_pool_symbols then 'formal_priority_pool_invalid'
      when formal_fresh_quote_coverage_120s < 0.95 then 'formal_priority_quote_coverage_low'
      when formal_max_quote_age_seconds > 120 then 'formal_priority_quote_age_too_old'
      when formal_scope <> 'priority_hot_deep_scan_pool_only' then 'formal_scope_invalid'
      when formal_priority_strategy_chip_complete_latest_run_evidence is not true then 'strategy_chip_complete_latest_run_missing'
      when quote_age_seconds > 90 then 'quote_age_too_old'
      when rate_limit_status in ('rate_limited', 'cooldown') then 'rate_limited'
      else 'source_contract_not_ready'
    end as final_reason
  from scored
)
select
  source_name,
  updated_at as checked_at,
  source_status,
  message,
  final_gate_grade as canonical_gate_grade,
  final_gate_status as canonical_gate_status,
  final_gate_grade as gate,
  final_gate_status as status,
  final_gate_grade as gate_grade,
  final_gate_status as gate_status,
  final_reason as reason,
  daytrade_gate_grade,
  priority_gate_grade,
  full_market_gate_grade,
  priority_fresh_quote_coverage_120s,
  priority_fresh_quotes_120s,
  priority_pool_symbols,
  fresh_quote_coverage_120s,
  fresh_quotes_120s,
  active_symbols,
  quote_age_seconds,
  scanner_can_run_quote_only,
  scanner_can_run_opening,
  selected_symbols_fresh_ok,
  daily_volume_status,
  ready_ma20_continuous_symbols,
  ready_ma35_continuous_symbols,
  intraday_1m_stale_seconds,
  today_1m_symbols,
  today_1m_rows,
  futopt_stock_mapped,
  rate_limit_status,
  phase,
  scorecard_required_ok_count,
  35 as scorecard_required_count,
  case when canonical_ready then 'YES' else 'NO' end as formal_entry_speed_verdict,
  canonical_ready as formal_entry_allowed,
  daytrade_source_speed_ok,
  payload || jsonb_build_object(
    'current_phase', current_phase,
    'writer_formal_entry_allowed', writer_formal_entry_allowed,
    'canonical_formal_entry_allowed', canonical_ready,
    'canonical_gate_source', 'source_status.payload.priority_first',
    'formal_quote_source', formal_quote_source,
    'formal_intraday_1m_source', formal_intraday_1m_source,
    'formal_source_alignment_ok', formal_source_alignment_ok,
    'quote_transport', quote_transport,
    'websocket_formal_ready', websocket_formal_ready,
    'formal_priority_strategy_chip_status', formal_priority_strategy_chip_status,
    'formal_priority_strategy_chip_complete_latest_run_evidence', formal_priority_strategy_chip_complete_latest_run_evidence,
    'daily_volume_ok', (daily_volume_status = 'ready'),
    'source_family', 'daytrade_dedicated',
    'daytrade_source_name', 'fugle_daytrade_source',
    'shared_source_name', 'fuman_shared_source',
    'formal_pool_scope', formal_scope,
    'full_market_coverage_blocking', false
  ) as payload,
  formal_quote_source,
  formal_intraday_1m_source,
  quote_source_daytrade_ok,
  intraday_1m_source_daytrade_ok,
  formal_source_alignment_ok,
  case when final_reason = '' then 'ready' else final_reason end as canonical_gate_reason,
  quote_transport,
  websocket_status_ok,
  websocket_mode,
  websocket_connected,
  websocket_authenticated,
  websocket_subscribed,
  websocket_subscribed_symbols,
  websocket_streaming_channels,
  websocket_rest_disabled,
  websocket_status_updated_at,
  websocket_status_age_seconds,
  websocket_formal_ready,
  (daily_volume_status = 'ready') as daily_volume_ok,
  'daytrade_dedicated'::text as source_family,
  'fugle_daytrade_source'::text as daytrade_source_name,
  'fuman_shared_source'::text as shared_source_name,
  formal_scope as formal_pool_scope,
  false::boolean as full_market_coverage_blocking,
  case when futopt_contract_required then futopt_snapshot.raw_futopt_gate_status else 'not_required' end as futopt_gate_status,
  futopt_snapshot.futopt_txf_ok as futopt_txf_ok,
  futopt_snapshot.futopt_txf_ok as txf_ok,
  futopt_snapshot.futopt_ready_rows,
  futopt_snapshot.futopt_stale_rows,
  futopt_snapshot.futopt_contract_rows,
  futopt_snapshot.latest_futopt_updated_at,
  futopt_snapshot.latest_txf_updated_at,
  case when futopt_contract_required then futopt_snapshot.raw_futopt_reason else 'not_required' end as futopt_reason,
  mother_pool_symbols,
  mother_fresh_quote_coverage_120s,
  formal_priority_symbols,
  formal_fresh_quote_coverage_120s,
  formal_max_quote_age_seconds,
  formal_scope,
  updated_at
from projected
cross join futopt_snapshot;

create or replace view public.v_fugle_daytrade_unattended_gate_status as
select
  source_name,
  checked_at,
  source_status,
  message,
  canonical_gate_grade,
  canonical_gate_status,
  gate,
  status,
  gate_grade,
  gate_status,
  reason,
  daytrade_gate_grade,
  priority_gate_grade,
  full_market_gate_grade,
  priority_fresh_quote_coverage_120s,
  priority_fresh_quotes_120s,
  priority_pool_symbols,
  fresh_quote_coverage_120s,
  fresh_quotes_120s,
  active_symbols,
  quote_age_seconds,
  scanner_can_run_quote_only,
  scanner_can_run_opening,
  selected_symbols_fresh_ok,
  daily_volume_status,
  ready_ma20_continuous_symbols,
  ready_ma35_continuous_symbols,
  intraday_1m_stale_seconds,
  today_1m_symbols,
  today_1m_rows,
  futopt_stock_mapped,
  rate_limit_status,
  phase,
  scorecard_required_ok_count,
  scorecard_required_count,
  formal_entry_speed_verdict,
  formal_entry_allowed,
  daytrade_source_speed_ok,
  case when formal_entry_allowed then 'YES' else 'NO' end as unattended_status,
  case when formal_entry_allowed then 'complete' else 'source_quality_fail' end as evidence_status,
  payload,
  formal_quote_source,
  formal_intraday_1m_source,
  quote_source_daytrade_ok,
  intraday_1m_source_daytrade_ok,
  formal_source_alignment_ok,
  canonical_gate_reason,
  quote_transport,
  websocket_status_ok,
  websocket_mode,
  websocket_connected,
  websocket_authenticated,
  websocket_subscribed,
  websocket_subscribed_symbols,
  websocket_streaming_channels,
  websocket_rest_disabled,
  websocket_status_updated_at,
  websocket_status_age_seconds,
  websocket_formal_ready,
  daily_volume_ok,
  source_family,
  daytrade_source_name,
  shared_source_name,
  formal_pool_scope,
  full_market_coverage_blocking,
  futopt_gate_status,
  futopt_txf_ok,
  txf_ok,
  futopt_ready_rows,
  futopt_stale_rows,
  futopt_contract_rows,
  latest_futopt_updated_at,
  latest_txf_updated_at,
  futopt_reason,
  updated_at,
  mother_pool_symbols,
  mother_fresh_quote_coverage_120s,
  formal_priority_symbols,
  formal_fresh_quote_coverage_120s,
  formal_max_quote_age_seconds,
  formal_scope
from public.v_fugle_daytrade_canonical_gate;

grant select on public.v_fugle_daytrade_canonical_gate to anon, authenticated, service_role;
grant select on public.v_fugle_daytrade_unattended_gate_status to anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;
