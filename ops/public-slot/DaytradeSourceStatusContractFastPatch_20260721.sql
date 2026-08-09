begin;

-- Fast flat source-status contract for PS1/read-only warmup probes.
-- This view must stay light: no full intraday aggregation, no large table scan.
drop view if exists public.v_fugle_daytrade_source_status_contract;

create view public.v_fugle_daytrade_source_status_contract as
with status_row as (
  select source_name, status, updated_at, message, payload
  from public.source_status
  where source_name = 'fugle_daytrade_source'
  order by updated_at desc
  limit 1
),
canonical as (
  select * from public.v_fugle_daytrade_canonical_gate limit 1
)
select
  s.source_name,
  s.status as source_status,
  s.updated_at,
  s.message,
  s.payload,
  coalesce(
    nullif(s.payload ->> 'intraday_1m_status', ''),
    nullif(s.payload ->> 'today_1m_status', ''),
    case when coalesce(nullif(s.payload ->> 'ready_ma35_continuous', '')::integer, 0) > 0 then 'ready' else 'not_ready' end
  ) as intraday_1m_status,
  coalesce(nullif(s.payload ->> 'build_id', ''), nullif(s.payload ->> 'writer_version', ''), 'daytrade-source-writer') as build_id,
  nullif(s.payload ->> 'writer_pid', '') as writer_pid,
  coalesce(
    nullif(s.payload ->> 'latest_candle_time_taipei', ''),
    nullif(s.payload ->> 'latest_1m_candle_time_taipei', ''),
    nullif(s.payload ->> 'latest_candle_time', ''),
    nullif(s.payload ->> 'latest_1m_candle_time', '')
  ) as latest_candle_time_taipei,
  coalesce(nullif(s.payload ->> 'top_movers_1m_ready_count', '')::integer, nullif(s.payload ->> 'ready_ge_35_symbols', '')::integer, nullif(s.payload ->> 'ready_ma35_continuous', '')::integer, 0) as top_movers_1m_ready_count,
  coalesce(nullif(s.payload ->> 'top_movers_1m_ready80_count', '')::integer, nullif(s.payload ->> 'ready_ge_80_symbols', '')::integer, 0) as top_movers_1m_ready80_count,
  coalesce(nullif(s.payload ->> 'top_movers_1m_universe_count', '')::integer, nullif(s.payload ->> 'active_symbols', '')::integer, 0) as top_movers_1m_universe_count,
  coalesce(c.txf_ok, false) as txf_ok,
  coalesce(c.futopt_txf_ok, false) as futopt_txf_ok,
  coalesce(nullif(s.payload ->> 'mapped_underlying_count', '')::integer, c.futopt_contract_rows, 0) as mapped_underlying_count,
  coalesce(nullif(s.payload ->> 'ready_ge_35_symbols', '')::integer, nullif(s.payload ->> 'ready_ma35_continuous', '')::integer, 0) as ready_ge_35_symbols,
  coalesce(nullif(s.payload ->> 'ready_ge_80_symbols', '')::integer, 0) as ready_ge_80_symbols,
  coalesce(nullif(s.payload ->> 'ready_ge_200_symbols', '')::integer, 0) as ready_ge_200_symbols,
  coalesce(nullif(s.payload ->> 'futopt_stock_this_loop', '')::integer, nullif(s.payload ->> 'futopt_stock_quotes_this_loop', '')::integer, c.futopt_ready_rows, 0) as futopt_stock_this_loop,
  coalesce(c.futopt_gate_status, 'not_ready') as futopt_gate_status,
  coalesce(c.futopt_reason, 'not_ready') as futopt_reason,
  coalesce(c.canonical_gate_grade, 'D') as canonical_gate_grade,
  coalesce(c.canonical_gate_status, 'not_ready') as canonical_gate_status,
  coalesce(c.canonical_gate_reason, 'source_contract_not_ready') as canonical_gate_reason,
  coalesce(c.formal_entry_allowed, false) as formal_entry_allowed,
  'v_fugle_daytrade_source_status_contract'::text as contract_view,
  'daytrade_source_status_flat_fast_v20260721'::text as contract_version
from status_row s
left join canonical c on true;

grant select on public.v_fugle_daytrade_source_status_contract to anon, authenticated, service_role;
notify pgrst, 'reload schema';

commit;
