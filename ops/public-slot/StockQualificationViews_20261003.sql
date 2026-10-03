begin;

do $guard$ begin if md5(pg_get_viewdef('public.v_fugle_daytrade_mother_pool_snapshot_v4_1'::regclass,true)) <> 'a4c3fb4cbc2a3de4eb52ce05df1a0371' then raise exception 'QUALIFICATION_VIEW_DRIFT:v_fugle_daytrade_mother_pool_snapshot_v4_1'; end if; end $guard$;

create or replace view public.v_fugle_daytrade_mother_pool_snapshot_v4_1 as
select base.*,qualification.is_common_stock,qualification.is_tradable,qualification.daytrade_allowed,qualification.is_suspended,qualification.is_disposition,qualification.is_attention,qualification.qualification_stock_type,qualification.qualification_source_date,qualification.qualification_received_at,qualification.qualification_recorded_at,qualification.qualification_raw_sha256
from (SELECT s.contract,
    s.contract_version,
    s.trade_date,
    s.canonical_run_id,
    s.run_id AS mother_pool_run_id,
    s.snapshot_sequence,
    s.generation,
    s.snapshot_type,
    s.generated_at,
    s.effective_at,
    s.status,
    s.complete,
    s.symbol_count,
    s.symbols,
    s.added_symbols,
    s.removed_symbols,
    s.previous_run_id,
    s.source_max_updated_at,
    s.first_blocker,
    s.exit_code,
    m.symbol,
    m.membership_status,
    m.membership_effective_at,
    m.added_at,
    m.removed_at,
    m.source_reason,
    m.source_updated_at
   FROM fugle_daytrade_mother_pool_snapshots_v4_1 s
     LEFT JOIN fugle_daytrade_mother_pool_snapshot_members_v4_1 m ON m.run_id = s.run_id AND m.snapshot_sequence = s.snapshot_sequence AND m.trade_date = s.trade_date) base
left join public.stock_tickers qualification_master on qualification_master.symbol=base.symbol
left join lateral public.fuman_stock_qualification_v1(qualification_master.payload,base.symbol,base.trade_date) qualification on true;

do $guard$ begin if md5(pg_get_viewdef('public.v_fugle_daytrade_mother_pool_v4_1_complete'::regclass,true)) <> '5a1888c8ce6a42944333d4f3aa43f5ae' then raise exception 'QUALIFICATION_VIEW_DRIFT:v_fugle_daytrade_mother_pool_v4_1_complete'; end if; end $guard$;

create or replace view public.v_fugle_daytrade_mother_pool_v4_1_complete as
select base.*,qualification.is_common_stock,qualification.is_tradable,qualification.daytrade_allowed,qualification.is_suspended,qualification.is_disposition,qualification.is_attention,qualification.qualification_stock_type,qualification.qualification_source_date,qualification.qualification_received_at,qualification.qualification_recorded_at,qualification.qualification_raw_sha256
from (SELECT trade_date,
    symbol,
    name,
    market,
    mother_pool_rank,
    priority_reason,
    pool_source,
    pool_layer,
    entry_score,
    upgrade_score,
    source_flags,
    source_run_ids,
    priority_reasons,
    source_updated_at,
    source_freshness,
    price,
    open_price,
    previous_close,
    change_percent,
    total_volume,
    trade_value,
    quote_seen_at,
    quote_age_seconds,
    latest_candle_time,
    intraday_1m_stale_seconds,
    ma5,
    ma10,
    ma20,
    ma5_ma10_ma20_bullish,
    contract_version,
    canonical_run_id,
    updated_at,
    last_trade_time,
    last_trade_age_seconds,
    total_volume_unit,
    total_volume_raw_unit,
    total_volume_source_event_at,
    total_volume_available,
    is_synthetic,
    total_volume_source,
    total_volume_conversion_rule,
    priority_rank,
    mother_pool_score,
    priority_score,
    mother_reason,
    mother_source,
    mother_readiness_status,
    is_formal_entry_eligible,
    high_price,
    low_price,
    avg_volume5,
    quote_trade_date,
    mother_updated_at,
    pool_updated_trade_date,
    sector_name,
    sector_strength_score,
    sector_member_active_count,
    industry_signal_fast_injected,
    industry_signal_fast_inject_industries,
    writer_run_id,
    generation_id,
    source_name,
    source_trade_date,
        CASE
            WHEN source_trade_date IS NULL THEN 'missing'::text
            WHEN source_trade_date <> trade_date THEN 'stale'::text
            WHEN contract_version <> '4.1.0'::text THEN 'contract_mismatch'::text
            ELSE 'ok'::text
        END AS source_status,
    COALESCE(total_volume_available, false) AND COALESCE(is_synthetic, false) = false AND total_volume IS NOT NULL AND total_volume >= 0::numeric AND (lower(COALESCE(total_volume_unit, ''::text)) = ANY (ARRAY['lots'::text, 'shares'::text])) AS volume_strategy_usable,
        CASE
            WHEN source_trade_date IS NULL THEN 'DATA_GAP_SOURCE_TRADE_DATE'::text
            WHEN source_trade_date <> trade_date THEN 'DATA_GAP_CROSS_TRADE_DATE'::text
            WHEN price IS NULL OR price <= 0::numeric THEN 'MOTHER_PRICE_INVALID'::text
            WHEN COALESCE(total_volume_available, false) = false OR total_volume IS NULL OR total_volume < 0::numeric OR (lower(COALESCE(total_volume_unit, ''::text)) <> ALL (ARRAY['lots'::text, 'shares'::text])) THEN 'TOTAL_VOLUME_UNIT_MISSING_OR_INVALID'::text
            WHEN COALESCE(is_synthetic, false) THEN 'DATA_GAP_SYNTHETIC_VOLUME'::text
            WHEN latest_candle_time IS NULL THEN 'DATA_GAP_LATEST_CANDLE_TIME'::text
            ELSE NULL::text
        END AS data_gap_reason,
    price AS last_price,
    trade_value_unit,
    trade_value_source_event_at,
    trade_value_available
   FROM v_fugle_daytrade_mother_pool_v4_1 base) base
left join public.stock_tickers qualification_master on qualification_master.symbol=base.symbol
left join lateral public.fuman_stock_qualification_v1(qualification_master.payload,base.symbol,base.trade_date) qualification on true;

do $guard$ begin if md5(pg_get_viewdef('public.v_fugle_daytrade_quotes_live_v2'::regclass,true)) <> '95861ca947f9764837dca71ed2c1a32f' then raise exception 'QUALIFICATION_VIEW_DRIFT:v_fugle_daytrade_quotes_live_v2'; end if; end $guard$;

create or replace view public.v_fugle_daytrade_quotes_live_v2 as
select base.*,qualification.is_common_stock,qualification.is_tradable,qualification.daytrade_allowed,qualification.is_suspended,qualification.is_disposition,qualification.is_attention,qualification.qualification_stock_type,qualification.qualification_source_date,qualification.qualification_received_at,qualification.qualification_recorded_at,qualification.qualification_raw_sha256
from (SELECT q.symbol,
    q.name,
    q.market,
    q.updated_at,
    q.quote_seen_at,
    q.price,
    q.open_price,
    q.high_price,
    q.low_price,
    q.previous_close,
    q.change_percent,
    evidence.total_volume,
    evidence.trade_value,
    q.bid_price,
    q.bid_volume,
    q.ask_price,
    q.ask_volume,
    q.cumulative_bid_volume,
    q.cumulative_ask_volume,
    q.cumulative_bid_ask_volume,
    q.stock_type,
    q.session,
    q.last_trade_time,
    q.source,
    q.payload,
    q.source_name,
    q.source_kind,
    q.is_realtime,
    q.is_fallback,
    q.is_formal_entry_eligible,
    q.ask_bid_ratio,
    q.is_halted,
    q.is_trial,
    q.ask_ratio,
    q.limit_up_price,
    q.limit_down_price,
    q.trade_date,
    'daytrade-quotes-live-trade-date-v1'::text AS contract_version,
    COALESCE(q.last_trade_time, q.quote_seen_at, q.updated_at) AS quote_event_at,
    ('fugle_daytrade_source:'::text || to_char(q.trade_date::timestamp with time zone, 'YYYYMMDD'::text)) || ':canonical'::text AS canonical_run_id,
    q.trade_date = (COALESCE(q.last_trade_time, q.quote_seen_at, q.updated_at) AT TIME ZONE 'Asia/Taipei'::text)::date AS quote_trade_date_match,
    evidence.trade_value_unit,
    evidence.trade_value_source_event_at,
    evidence.trade_value_available,
    evidence.total_volume_unit,
    evidence.total_volume_source_event_at,
    evidence.total_volume_available,
    evidence.is_synthetic,
    evidence.total_volume_source,
    evidence.total_volume_available AS volume_strategy_usable
   FROM fugle_daytrade_quotes_live q
     LEFT JOIN LATERAL fuman_native_liquidity_v1(q.payload, q.trade_date) evidence(total_volume, total_volume_unit, total_volume_source_event_at, total_volume_available, is_synthetic, total_volume_source, trade_value, trade_value_unit, trade_value_source_event_at, trade_value_available) ON true) base
left join public.stock_tickers qualification_master on qualification_master.symbol=base.symbol
left join lateral public.fuman_stock_qualification_v1(qualification_master.payload,base.symbol,base.trade_date) qualification on true;

commit;
