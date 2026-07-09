-- Daytrade mother-pool formal source contract patch, 2026-07-09.
-- Purpose:
--   1. Give the daytrade source writer a formal stock group contract for
--      "strong sector / limit-up leader pulls related stocks into mother pool".
--   2. Rebuild the stock-future live contract from Fugle daytrade futopt raw quotes
--      plus futopt_tickers, so Strategy1/2/7 can read the 08:46 stock-future
--      observation list from a stable view.

create or replace view public.v_daytrade_stock_group_contract as
with heatmap_snapshot as (
  select payload, updated_at
  from public.market_snapshots
  where symbol = '__fuman_heatmap_latest'
  order by updated_at desc
  limit 1
),
heatmap_master as (
  select
    nullif(item ->> 'code', '') as symbol,
    nullif(item ->> 'name', '') as name,
    nullif(item ->> 'officialIndustry', '') as official_industry,
    coalesce(nullif(item ->> 'primaryIndustry', ''), nullif(item ->> 'heatmapSector', '')) as primary_industry,
    nullif(item ->> 'heatmapSector', '') as heatmap_sector,
    case
      when jsonb_typeof(item -> 'themes') = 'array' then item -> 'themes'
      else '[]'::jsonb
    end as themes,
    nullif(item ->> 'source', '') as source,
    nullif(item ->> 'confidence', '') as confidence,
    hs.updated_at
  from heatmap_snapshot hs
  cross join lateral jsonb_array_elements(coalesce(hs.payload -> 'industryMaster', '[]'::jsonb)) item
),
tickers as (
  select
    symbol,
    name,
    market,
    nullif(industry, '') as industry,
    nullif(payload ->> 'industry', '') as payload_industry,
    nullif(payload ->> 'sector', '') as payload_sector,
    nullif(payload ->> 'group', '') as payload_group,
    nullif(payload ->> 'category', '') as payload_category,
    nullif(payload ->> 'primaryIndustry', '') as payload_primary_industry,
    nullif(payload ->> 'officialIndustry', '') as payload_official_industry,
    updated_at
  from public.stock_tickers
  where symbol ~ '^[0-9]{4}$'
    and coalesce(is_etf, false) = false
    and coalesce(is_suspended, false) = false
)
select
  t.symbol,
  coalesce(h.name, t.name, t.symbol) as name,
  t.market,
  coalesce(t.industry, h.official_industry, h.primary_industry, h.heatmap_sector, t.payload_industry, t.payload_official_industry, '') as industry,
  coalesce(h.heatmap_sector, h.primary_industry, t.payload_sector, t.payload_group, t.payload_category, t.industry, 'code_cluster_' || left(t.symbol, 3)) as sector,
  coalesce(h.heatmap_sector, h.primary_industry, t.payload_sector, t.payload_group, t.payload_category, t.industry, 'code_cluster_' || left(t.symbol, 3)) as heatmap_sector,
  coalesce(h.primary_industry, t.payload_primary_industry, h.heatmap_sector, t.industry, '') as primary_industry,
  coalesce(h.official_industry, t.payload_official_industry, t.industry, '') as official_industry,
  coalesce(h.themes, '[]'::jsonb) as themes,
  coalesce(h.source, case when h.symbol is not null then 'heatmap_latest.industryMaster' else 'stock_tickers_or_code_cluster' end) as source,
  coalesce(h.confidence, case when h.symbol is not null then 'medium' else 'low' end) as confidence,
  greatest(coalesce(h.updated_at, 'epoch'::timestamptz), coalesce(t.updated_at, 'epoch'::timestamptz)) as updated_at
from tickers t
left join heatmap_master h on h.symbol = t.symbol;

create or replace view public.v_stock_future_live_contract as
with raw as (
  select
    q.future_symbol,
    q.future_symbol as source_symbol,
    nullif(q.underlying_symbol, '') as raw_underlying_symbol,
    q.last_price,
    q.change_percent,
    q.total_volume,
    q.updated_at,
    q.payload
  from public.fugle_daytrade_futopt_quotes_live q
  where q.future_symbol is not null
),
stock_future as (
  select
    coalesce(nullif(t.underlying_symbol, ''), r.raw_underlying_symbol) as symbol,
    coalesce(nullif(t.underlying_name, ''), nullif(t.name, '')) as stock_name,
    coalesce(nullif(t.future_symbol, ''), r.future_symbol) as future_symbol,
    r.source_symbol,
    r.last_price as futopt_last_price,
    r.change_percent as futopt_change_percent,
    r.total_volume as futopt_total_volume,
    r.updated_at as futopt_updated_at,
    r.payload
  from raw r
  left join public.futopt_tickers t
    on upper(t.future_symbol) = upper(r.future_symbol)
    or upper(t.future_symbol) = upper(r.source_symbol)
  where upper(coalesce(nullif(t.contract_type, ''), nullif(t.product, ''), 'STOCK_FUTURE')) in ('S', 'STOCK_FUTURE')
    and coalesce(nullif(t.underlying_symbol, ''), r.raw_underlying_symbol) ~ '^[0-9]{4}$'
),
txf as (
  select
    future_symbol as txf_future_symbol,
    last_price as txf_last_price,
    change_percent as txf_change_percent,
    total_volume as txf_total_volume,
    updated_at as txf_updated_at
  from raw
  where upper(future_symbol) like 'TXF%'
     or upper(source_symbol) like 'TXF%'
     or upper(coalesce(payload ->> 'product', '')) = 'TXF'
  order by updated_at desc
  limit 1
)
select
  (sf.futopt_updated_at at time zone 'Asia/Taipei')::date as trade_date,
  sf.symbol,
  coalesce(nullif(sf.stock_name, ''), st.name, sf.symbol) as stock_name,
  sf.future_symbol,
  sf.source_symbol,
  sf.futopt_last_price,
  sf.futopt_change_percent,
  sf.futopt_total_volume,
  sf.futopt_updated_at,
  txf.txf_future_symbol,
  txf.txf_last_price,
  txf.txf_change_percent,
  txf.txf_total_volume,
  txf.txf_updated_at,
  sf.futopt_change_percent - coalesce(txf.txf_change_percent, 0) as relative_to_txf_percent,
  extract(epoch from (now() - sf.futopt_updated_at)) <= 60 as futopt_fresh_60s,
  extract(epoch from (now() - txf.txf_updated_at)) <= 60 as txf_fresh_60s,
  case
    when sf.futopt_updated_at is null then 'missing'
    when (sf.futopt_updated_at at time zone 'Asia/Taipei')::date <> (now() at time zone 'Asia/Taipei')::date then 'stale'
    when extract(epoch from (now() - sf.futopt_updated_at)) <= 120 then 'ready'
    else 'stale'
  end as source_status,
  case
    when sf.futopt_updated_at is null then 'stock future quote missing'
    when (sf.futopt_updated_at at time zone 'Asia/Taipei')::date <> (now() at time zone 'Asia/Taipei')::date then 'stock future quote not today'
    when extract(epoch from (now() - sf.futopt_updated_at)) <= 120 then 'stock future quote ready'
    else 'stock future quote stale'
  end as reason,
  (
    sf.futopt_change_percent >= 2
    and (sf.futopt_change_percent - coalesce(txf.txf_change_percent, 0)) >= 1
    and sf.futopt_total_volume >= 50
  ) as star_precheck_ok,
  (
    sf.futopt_change_percent >= 2
    and (sf.futopt_change_percent - coalesce(txf.txf_change_percent, 0)) >= 1
    and sf.futopt_total_volume >= 50
    and extract(epoch from (now() - sf.futopt_updated_at)) <= 120
  ) as strategy2_futopt_gate_ok,
  sf.futopt_updated_at as updated_at
from stock_future sf
left join txf on true
left join public.stock_tickers st on st.symbol = sf.symbol;

create or replace view public.v_strategy12_stock_future_contract_health as
select
  max(trade_date) as trade_date,
  count(*) as contract_rows,
  count(distinct symbol) as symbol_rows,
  count(distinct future_symbol) as future_symbol_rows,
  count(*) filter (where futopt_last_price > 0) as last_price_rows,
  count(*) filter (where futopt_change_percent is not null) as change_percent_rows,
  count(*) filter (where futopt_total_volume > 0) as total_volume_rows,
  count(*) filter (where source_status = 'ready') as ready_rows,
  count(*) filter (where source_status = 'stale') as stale_rows,
  count(*) filter (where source_status <> 'ready') as not_ready_rows,
  count(*) filter (where star_precheck_ok) as star_precheck_rows,
  count(*) filter (where strategy2_futopt_gate_ok) as strategy2_futopt_gate_rows,
  max(futopt_updated_at) as latest_futopt_updated_at,
  max(txf_updated_at) as latest_txf_updated_at,
  max(updated_at) as latest_updated_at,
  case
    when count(*) = 0 then 'missing'
    when count(*) filter (where source_status = 'ready') > 0 then 'ready'
    else 'not_ready'
  end as source_status,
  case
    when count(*) = 0 then 'stock future contract rows missing'
    when count(*) filter (where source_status = 'ready') > 0 then 'stock future contract ready'
    else 'ready_rows_zero'
  end as reason,
  now() as checked_at
from public.v_stock_future_live_contract;

grant select on public.v_daytrade_stock_group_contract to anon, authenticated, service_role;
grant select on public.v_stock_future_live_contract to anon, authenticated, service_role;
grant select on public.v_strategy12_stock_future_contract_health to anon, authenticated, service_role;

notify pgrst, 'reload schema';
