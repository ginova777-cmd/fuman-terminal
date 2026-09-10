-- Strategy3 v2 / Mother Pool 4.1 formal consumer contract repair.
-- Existing view columns remain in their original order. New consumer fields are
-- appended so CREATE OR REPLACE is safe for dependent readers.

create or replace view public.v_fugle_daytrade_mother_pool_v4_1 as
select
  nullif(p.payload ->> 'trade_date', '')::date as trade_date,
  p.symbol,
  coalesce(q.name, p.name) as name,
  coalesce(q.market, p.market) as market,
  p.priority_rank as mother_pool_rank,
  p.priority_reason,
  p.source as pool_source,
  coalesce(nullif(p.payload ->> 'pool_layer', ''), nullif(p.payload ->> 'canonical_pool_layer', '')) as pool_layer,
  coalesce(nullif(p.payload ->> 'entry_score', '')::numeric, 0) as entry_score,
  coalesce(nullif(p.payload ->> 'upgrade_score', '')::numeric, 0) as upgrade_score,
  coalesce(p.payload -> 'source_flags', '[]'::jsonb) as source_flags,
  coalesce(p.payload -> 'source_run_ids', '[]'::jsonb) as source_run_ids,
  coalesce(p.payload -> 'priority_reasons', p.payload -> 'pool_reasons', '[]'::jsonb) as priority_reasons,
  nullif(p.payload ->> 'source_updated_at', '')::timestamptz as source_updated_at,
  p.payload ->> 'source_freshness' as source_freshness,
  q.price,
  q.open_price,
  q.previous_close,
  q.change_percent,
  q.total_volume,
  q.trade_value,
  q.quote_seen_at,
  extract(epoch from (now() - q.quote_seen_at))::integer as quote_age_seconds,
  nullif(coalesce(p.payload ->> 'latest_1m_time', p.payload #>> '{motherPoolMetrics,latestCandleTime}'), '')::timestamptz as latest_candle_time,
  coalesce(nullif(p.payload ->> 'intraday_1m_stale_seconds', '')::integer, 999999) as intraday_1m_stale_seconds,
  nullif(p.payload #>> '{motherPoolMetrics,ma5}', '')::numeric as ma5,
  nullif(p.payload #>> '{motherPoolMetrics,ma10}', '')::numeric as ma10,
  nullif(p.payload #>> '{motherPoolMetrics,ma20}', '')::numeric as ma20,
  (nullif(p.payload #>> '{motherPoolMetrics,ma5}', '')::numeric > nullif(p.payload #>> '{motherPoolMetrics,ma10}', '')::numeric
    and nullif(p.payload #>> '{motherPoolMetrics,ma10}', '')::numeric > nullif(p.payload #>> '{motherPoolMetrics,ma20}', '')::numeric
    and nullif(p.payload #>> '{motherPoolMetrics,ma20}', '')::numeric > 0) as ma5_ma10_ma20_bullish,
  '4.1.0'::text as contract_version,
  p.payload ->> 'canonical_run_id' as canonical_run_id,
  greatest(p.updated_at, coalesce(q.updated_at, p.updated_at)) as updated_at,
  q.last_trade_time,
  extract(epoch from (now() - q.last_trade_time))::integer as last_trade_age_seconds,
  coalesce(nullif(lower(q.payload ->> 'total_volume_unit'), ''), nullif(lower(q.payload ->> 'volume_unit'), ''),
    case when upper(coalesce(q.market, '')) = 'ESB' then 'shares'
         when upper(coalesce(q.market, '')) in ('TSE', 'OTC', 'TIB') then 'lots' end) as total_volume_unit,
  coalesce(nullif(lower(q.payload ->> 'total_volume_raw_unit'), ''), nullif(lower(q.payload ->> 'total_volume_unit'), ''), nullif(lower(q.payload ->> 'volume_unit'), ''),
    case when upper(coalesce(q.market, '')) = 'ESB' then 'shares'
         when upper(coalesce(q.market, '')) in ('TSE', 'OTC', 'TIB') then 'lots' end) as total_volume_raw_unit,
  coalesce(nullif(q.payload ->> 'total_volume_source_event_at', '')::timestamptz,
           nullif(q.payload ->> 'aggregate_last_updated', '')::timestamptz,
           q.quote_seen_at) as total_volume_source_event_at,
  (q.total_volume is not null and q.total_volume >= 0
    and coalesce(nullif(lower(q.payload ->> 'total_volume_unit'), ''), nullif(lower(q.payload ->> 'volume_unit'), ''),
      case when upper(coalesce(q.market, '')) = 'ESB' then 'shares'
           when upper(coalesce(q.market, '')) in ('TSE', 'OTC', 'TIB') then 'lots' end) in ('lots', 'shares')
    and coalesce(nullif(q.payload ->> 'total_volume_source_event_at', '')::timestamptz,
                 nullif(q.payload ->> 'aggregate_last_updated', '')::timestamptz,
                 q.quote_seen_at) is not null
    and not case when jsonb_typeof(q.payload -> 'is_synthetic') = 'boolean'
                 then (q.payload ->> 'is_synthetic')::boolean else false end) as total_volume_available,
  case when jsonb_typeof(q.payload -> 'is_synthetic') = 'boolean'
       then (q.payload ->> 'is_synthetic')::boolean else false end as is_synthetic,
  coalesce(nullif(q.payload ->> 'quoteSource', ''), nullif(q.source, '')) as total_volume_source,
  case
    when coalesce(nullif(lower(q.payload ->> 'total_volume_unit'), ''), nullif(lower(q.payload ->> 'volume_unit'), ''),
      case when upper(coalesce(q.market, '')) = 'ESB' then 'shares'
           when upper(coalesce(q.market, '')) in ('TSE', 'OTC', 'TIB') then 'lots' end) = 'shares'
      then 'shares_divide_1000_to_lots'
    when coalesce(nullif(lower(q.payload ->> 'total_volume_unit'), ''), nullif(lower(q.payload ->> 'volume_unit'), ''),
      case when upper(coalesce(q.market, '')) = 'ESB' then 'shares'
           when upper(coalesce(q.market, '')) in ('TSE', 'OTC', 'TIB') then 'lots' end) = 'lots'
      then 'lots_identity'
    else null
  end as total_volume_conversion_rule,
  p.priority_rank,
  coalesce(nullif(p.payload ->> 'score', '')::numeric, nullif(p.payload ->> 'entry_score', '')::numeric, 0) as mother_pool_score,
  coalesce(nullif(p.payload ->> 'score', '')::numeric, nullif(p.payload ->> 'entry_score', '')::numeric, 0) as priority_score,
  p.priority_reason as mother_reason,
  p.source as mother_source,
  coalesce(nullif(p.payload ->> 'data_gap_reason', ''), nullif(p.payload ->> 'avg3_volume_gate_status', ''), 'unknown') as mother_readiness_status,
  coalesce((p.payload ->> 'formal_pool_eligible')::boolean, p.is_formal_entry_eligible, false) as is_formal_entry_eligible,
  q.high_price,
  q.low_price,
  coalesce(nullif(p.payload #>> '{motherPoolMetrics,avgVolume5}', '')::numeric, 0) as avg_volume5,
  q.trade_date as quote_trade_date,
  p.updated_at as mother_updated_at,
  nullif(p.payload ->> 'trade_date', '')::date as pool_updated_trade_date,
  coalesce(nullif(p.payload #>> '{motherPoolMetrics,stockGroupContract,sector}', ''), nullif(p.payload #>> '{motherPoolMetrics,stockGroupContract,industry}', '')) as sector_name,
  coalesce(nullif(p.payload #>> '{motherPoolMetrics,sectorStrengthScore}', '')::numeric, 0) as sector_strength_score,
  coalesce(nullif(p.payload #>> '{motherPoolMetrics,sectorMemberActiveCount}', '')::integer, 0) as sector_member_active_count,
  coalesce((p.payload ->> 'industry_signal_fast_injected')::boolean, false) as industry_signal_fast_injected,
  coalesce(p.payload -> 'industry_signal_fast_inject_industries', '[]'::jsonb) as industry_signal_fast_inject_industries,
  p.payload ->> 'writer_run_id' as writer_run_id,
  p.payload ->> 'generation_id' as generation_id,
  coalesce(nullif(p.payload ->> 'source_name', ''), nullif(p.source_name, ''), 'fugle_daytrade_source') as source_name,
  coalesce(nullif(p.payload ->> 'source_trade_date', '')::date, nullif(p.payload ->> 'trade_date', '')::date) as source_trade_date
from public.fugle_daytrade_priority_pool p
left join public.fugle_daytrade_quotes_live q
  on q.symbol = p.symbol
 and q.trade_date = nullif(p.payload ->> 'trade_date', '')::date
where coalesce((p.payload ->> 'selected')::boolean, false)
  and p.payload ->> 'contract_version' = '4.1.0';

comment on view public.v_fugle_daytrade_mother_pool_v4_1 is
  'Read-only Mother Pool 4.1.0 contract for Strategy3 and other consumers. Same-day quote/1m joins only; MA5>MA10>MA20 only.';
grant select on public.v_fugle_daytrade_mother_pool_v4_1 to anon, authenticated, service_role;

with identity as (
  select trade_date, payload ->> 'canonical_run_id' as canonical_run_id,
    coalesce(payload #>> '{mother_pool_round_summary,writer_run_id}', payload #>> '{mother_pool_delta,round_summary,writer_run_id}', payload ->> 'writer_run_id') as writer_run_id
  from public.source_status where source_name = 'fugle_daytrade_source' limit 1
)
update public.fugle_daytrade_priority_pool p
set payload = p.payload || jsonb_build_object(
      'writer_run_id', i.writer_run_id,
      'generation_id', i.writer_run_id,
      'source_name', 'fugle_daytrade_source',
      'source_trade_date', i.trade_date::text)
from identity i
where nullif(p.payload ->> 'trade_date', '')::date = i.trade_date
  and p.payload ->> 'canonical_run_id' = i.canonical_run_id
  and p.payload ->> 'source_freshness' = 'same_trade_date_current'
  and coalesce((p.payload ->> 'selected')::boolean, false)
  and nullif(i.writer_run_id, '') is not null;
