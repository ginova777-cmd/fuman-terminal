-- Align dedicated daytrade live REST gates with source_status:fugle_daytrade_source.
-- This prevents source_status, canonical gate, and unattended gate from reporting
-- different priority universes / quote-age semantics for the same source.

begin;

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
    coalesce((payload->>'formal_entry_allowed')::boolean, false) as formal_entry_allowed,
    coalesce((payload->>'scanner_can_run_quote_only')::boolean, false) as scanner_can_run_quote_only,
    coalesce((payload->>'scanner_can_run_opening')::boolean, false) as scanner_can_run_opening,
    coalesce((payload->>'selected_symbols_fresh_ok')::boolean, false) as selected_symbols_fresh_ok,
    coalesce((payload->>'priority_fresh_quote_coverage_120s')::numeric, 0) as priority_fresh_quote_coverage_120s,
    coalesce((payload->>'priority_fresh_quotes_120s')::integer, 0) as priority_fresh_quotes_120s,
    coalesce((payload->>'priority_pool_symbols')::integer, 0) as priority_pool_symbols,
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
    coalesce((payload->>'phase'), '') as phase,
    payload,
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
),
scored as (
  select
    *,
    (
      source_status = 'ok'
      and current_phase not in ('closed_before_0600', 'after_daytrade_window')
      and daytrade_gate_grade = 'A'
      and daytrade_source_speed_ok is true
      and formal_entry_allowed is true
      and scanner_can_run_opening is true
      and priority_fresh_quote_coverage_120s >= 0.95
      and quote_age_seconds <= 90
      and rate_limit_status not in ('rate_limited', 'cooldown')
    ) as canonical_ready,
    (
      (source_status = 'ok')::integer
      + (daytrade_gate_grade = 'A')::integer
      + (daytrade_source_speed_ok is true)::integer
      + (formal_entry_allowed is true)::integer
      + (scanner_can_run_opening is true)::integer
      + (priority_fresh_quote_coverage_120s >= 0.95)::integer
      + (quote_age_seconds <= 90)::integer
      + (rate_limit_status not in ('rate_limited', 'cooldown'))::integer
      + (priority_pool_symbols >= 300)::integer
      + (daily_volume_status = 'ready')::integer
      + (scanner_can_run_quote_only is true)::integer
      + (selected_symbols_fresh_ok is true)::integer
      + (fresh_quotes_120s > 0)::integer
      + (active_symbols > 0)::integer
      + (updated_at is not null)::integer
    ) as scorecard_required_ok_count
  from normalized
)
select
  source_name,
  updated_at as checked_at,
  source_status,
  message,
  case when canonical_ready then 'A' else daytrade_gate_grade end as canonical_gate_grade,
  case when canonical_ready then 'ready' else 'not_ready' end as canonical_gate_status,
  case
    when canonical_ready then ''
    when current_phase in ('closed_before_0600', 'after_daytrade_window') then 'off_session_not_formal_entry'
    when source_status <> 'ok' then 'source_status_not_ok'
    when daytrade_gate_grade <> 'A' then 'daytrade_gate_not_a'
    when formal_entry_allowed is not true then 'formal_entry_not_allowed'
    when scanner_can_run_opening is not true then 'scanner_can_run_opening_false'
    when priority_fresh_quote_coverage_120s < 0.95 then 'priority_quote_coverage_low'
    when quote_age_seconds > 90 then 'quote_age_too_old'
    when rate_limit_status in ('rate_limited', 'cooldown') then 'rate_limited'
    else 'source_contract_not_ready'
  end as reason,
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
  current_phase,
  scorecard_required_ok_count,
  15 as scorecard_required_count,
  case when canonical_ready then 'YES' else 'NO' end as formal_entry_speed_verdict,
  formal_entry_allowed,
  daytrade_source_speed_ok,
  payload
from scored;

create or replace view public.v_fugle_daytrade_unattended_gate_status as
select
  source_name,
  checked_at,
  source_status,
  message,
  canonical_gate_grade,
  canonical_gate_status,
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
  current_phase,
  scorecard_required_ok_count,
  scorecard_required_count,
  formal_entry_speed_verdict,
  formal_entry_allowed,
  daytrade_source_speed_ok,
  case when canonical_gate_grade = 'A' then 'YES' else 'NO' end as unattended_status,
  case when canonical_gate_grade = 'A' then 'complete' else 'insufficient' end as evidence_status,
  payload
from public.v_fugle_daytrade_canonical_gate;

grant select on public.v_fugle_daytrade_canonical_gate to anon, authenticated, service_role;
grant select on public.v_fugle_daytrade_unattended_gate_status to anon, authenticated, service_role;

commit;
