-- Mother Pool v4.1 cumulative natural-volume provenance extension.
-- Existing columns stay in the same order; consumer fields are appended.
create or replace view public.v_fugle_daytrade_mother_pool_v4_1 as
select
  coalesce(nullif(p.payload ->> 'trade_date', '')::date, q.trade_date) as trade_date,
  p.symbol,
  coalesce(q.name, p.name) as name,
  coalesce(q.market, p.market) as market,
  p.priority_rank as mother_pool_rank,
  p.priority_reason,
  p.source as pool_source,
  p.payload ->> 'pool_layer' as pool_layer,
  coalesce(nullif(p.payload ->> 'entry_score', '')::numeric, 0) as entry_score,
  coalesce(nullif(p.payload ->> 'upgrade_score', '')::numeric, 0) as upgrade_score,
  coalesce(p.payload -> 'source_flags', '[]'::jsonb) as source_flags,
  coalesce(p.payload -> 'source_run_ids', '[]'::jsonb) as source_run_ids,
  coalesce(p.payload -> 'priority_reasons', '[]'::jsonb) as priority_reasons,
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
  latest_1m.candle_time as latest_candle_time,
  coalesce(extract(epoch from (now() - latest_1m.updated_at))::integer, 999999) as intraday_1m_stale_seconds,
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
  coalesce(
    nullif(lower(q.payload ->> 'total_volume_unit'), ''),
    nullif(lower(q.payload ->> 'volume_unit'), ''),
    case
      when upper(coalesce(q.market, '')) = 'ESB' then 'shares'
      when upper(coalesce(q.market, '')) in ('TSE', 'OTC', 'TIB') then 'lots'
      else null
    end
  ) as total_volume_unit,
  coalesce(
    nullif(lower(q.payload ->> 'total_volume_raw_unit'), ''),
    nullif(lower(q.payload ->> 'total_volume_unit'), ''),
    nullif(lower(q.payload ->> 'volume_unit'), ''),
    case
      when upper(coalesce(q.market, '')) = 'ESB' then 'shares'
      when upper(coalesce(q.market, '')) in ('TSE', 'OTC', 'TIB') then 'lots'
      else null
    end
  ) as total_volume_raw_unit,
  coalesce(
    nullif(q.payload ->> 'total_volume_source_event_at', '')::timestamptz,
    nullif(q.payload ->> 'aggregate_last_updated', '')::timestamptz,
    q.quote_seen_at
  ) as total_volume_source_event_at,
  (
    q.total_volume is not null
    and q.total_volume >= 0
    and coalesce(
      nullif(lower(q.payload ->> 'total_volume_unit'), ''),
      nullif(lower(q.payload ->> 'volume_unit'), ''),
      case
        when upper(coalesce(q.market, '')) = 'ESB' then 'shares'
        when upper(coalesce(q.market, '')) in ('TSE', 'OTC', 'TIB') then 'lots'
        else null
      end
    ) in ('lots', 'shares')
    and coalesce(
      nullif(q.payload ->> 'total_volume_source_event_at', '')::timestamptz,
      nullif(q.payload ->> 'aggregate_last_updated', '')::timestamptz,
      q.quote_seen_at
    ) is not null
    and not case
      when jsonb_typeof(q.payload -> 'is_synthetic') = 'boolean'
        then (q.payload ->> 'is_synthetic')::boolean
      else false
    end
  ) as total_volume_available,
  case
    when jsonb_typeof(q.payload -> 'is_synthetic') = 'boolean'
      then (q.payload ->> 'is_synthetic')::boolean
    else false
  end as is_synthetic,
  coalesce(nullif(q.payload ->> 'quoteSource', ''), nullif(q.source, '')) as total_volume_source,
  case
    when coalesce(nullif(lower(q.payload ->> 'total_volume_unit'), ''), nullif(lower(q.payload ->> 'volume_unit'), ''),
      case when upper(coalesce(q.market, '')) = 'ESB' then 'shares' when upper(coalesce(q.market, '')) in ('TSE', 'OTC', 'TIB') then 'lots' end) = 'shares'
      then 'shares_divide_1000_to_lots'
    when coalesce(nullif(lower(q.payload ->> 'total_volume_unit'), ''), nullif(lower(q.payload ->> 'volume_unit'), ''),
      case when upper(coalesce(q.market, '')) = 'ESB' then 'shares' when upper(coalesce(q.market, '')) in ('TSE', 'OTC', 'TIB') then 'lots' end) = 'lots'
      then 'lots_identity'
    else null
  end as total_volume_conversion_rule
from public.fugle_daytrade_priority_pool p
left join public.fugle_daytrade_quotes_live q
  on q.symbol = p.symbol
 and q.trade_date = nullif(p.payload ->> 'trade_date', '')::date
left join lateral (
  select c.candle_time, c.updated_at
  from public.fugle_daytrade_intraday_1m c
  where c.symbol = p.symbol
    and c.trade_date = coalesce(nullif(p.payload ->> 'trade_date', '')::date, q.trade_date)
  order by c.candle_time desc
  limit 1
) latest_1m on true
where coalesce((p.payload ->> 'selected')::boolean, false)
  and p.payload ->> 'contract_version' = '4.1.0';

comment on view public.v_fugle_daytrade_mother_pool_v4_1 is
  'Read-only Mother Pool 4.1.0 handoff with natural cumulative-volume unit, availability, provenance event time, and synthetic flag. Regular-board volumes are lots; ESB/odd-lot volumes are shares. No magnitude inference.';

grant select on public.v_fugle_daytrade_mother_pool_v4_1 to anon, authenticated, service_role;
