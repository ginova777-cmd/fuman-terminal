-- Stable read-only handoff view for daytrade consumers, contract 4.1.0.
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
  s.latest_candle_time,
  s.latest_candle_age_seconds as intraday_1m_stale_seconds,
  s.ma5,
  s.ma10,
  s.ma20,
  (s.ma5 > s.ma10 and s.ma10 > s.ma20 and s.ma20 > 0) as ma5_ma10_ma20_bullish,
  '4.1.0'::text as contract_version,
  p.payload ->> 'canonical_run_id' as canonical_run_id,
  greatest(p.updated_at, coalesce(q.updated_at, p.updated_at), coalesce(s.updated_at, p.updated_at)) as updated_at
from public.fugle_daytrade_priority_pool p
left join public.fugle_daytrade_quotes_live q on q.symbol = p.symbol
left join public.v_fugle_daytrade_intraday_1m_status s on s.symbol = p.symbol
where coalesce((p.payload ->> 'selected')::boolean, false)
  and p.payload ->> 'contract_version' = '4.1.0';

comment on view public.v_fugle_daytrade_mother_pool_v4_1 is
  'Read-only Mother Pool 4.1.0 handoff. Short MA direction is MA5>MA10>MA20. MA30/MA35/MA58 are excluded.';

grant select on public.v_fugle_daytrade_mother_pool_v4_1 to anon, authenticated, service_role;
