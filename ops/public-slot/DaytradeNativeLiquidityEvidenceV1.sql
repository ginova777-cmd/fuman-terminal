BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
CREATE OR REPLACE FUNCTION public.fuman_native_liquidity_v1(p jsonb,d date)
RETURNS TABLE(total_volume numeric,total_volume_unit text,total_volume_source_event_at timestamptz,total_volume_available boolean,is_synthetic boolean,total_volume_source text,trade_value numeric,trade_value_unit text,trade_value_source_event_at timestamptz,trade_value_available boolean)
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $fn$
DECLARE v jsonb := p->'turnoverVolumeEvidence'; a jsonb := p->'tradeValueEvidence';
BEGIN
 total_volume_unit:=v->>'unit'; total_volume_source:=v->>'source';
 is_synthetic:=CASE WHEN jsonb_typeof(v->'is_synthetic')='boolean' THEN (v->>'is_synthetic')::boolean ELSE NULL END;
 BEGIN total_volume_source_event_at:=(v->>'event_at')::timestamptz; EXCEPTION WHEN OTHERS THEN total_volume_source_event_at:=NULL; END;
 BEGIN trade_value_source_event_at:=(a->>'event_at')::timestamptz; EXCEPTION WHEN OTHERS THEN trade_value_source_event_at:=NULL; END;
 total_volume_available:=COALESCE(jsonb_typeof(v->'value')='number' AND CASE WHEN jsonb_typeof(v->'value')='number' THEN (v->>'value')::numeric>=0 ELSE false END AND total_volume_unit IN ('lots','shares') AND is_synthetic IS FALSE AND total_volume_source IN ('fugle.websocket.aggregates.total.tradeVolume','fugle.intraday.quote.total.tradeVolume') AND (total_volume_source_event_at AT TIME ZONE 'Asia/Taipei')::date=d,false);
 trade_value_available:=COALESCE(jsonb_typeof(a->'value')='number' AND CASE WHEN jsonb_typeof(a->'value')='number' THEN (a->>'value')::numeric>=0 ELSE false END AND a->>'unit'='TWD' AND a->'is_synthetic'='false'::jsonb AND a->>'source' IN ('fugle.websocket.aggregates.total.tradeValue','fugle.intraday.quote.total.tradeValue') AND (trade_value_source_event_at AT TIME ZONE 'Asia/Taipei')::date=d,false);
 total_volume:=CASE WHEN total_volume_available THEN (v->>'value')::numeric ELSE NULL END;
 trade_value:=CASE WHEN trade_value_available THEN (a->>'value')::numeric ELSE NULL END;
 trade_value_unit:=CASE WHEN trade_value_available THEN 'TWD' ELSE NULL END;
 RETURN NEXT;
END $fn$;
CREATE OR REPLACE VIEW public.v_fugle_daytrade_mother_pool_v4_1 AS SELECT NULLIF(p.payload ->> 'trade_date'::text, ''::text)::date AS trade_date,
    p.symbol,
    COALESCE(q.name, p.name) AS name,
    COALESCE(q.market, p.market) AS market,
    p.priority_rank AS mother_pool_rank,
    p.priority_reason,
    p.source AS pool_source,
    COALESCE(NULLIF(p.payload ->> 'pool_layer'::text, ''::text), NULLIF(p.payload ->> 'canonical_pool_layer'::text, ''::text)) AS pool_layer,
    COALESCE(NULLIF(p.payload ->> 'entry_score'::text, ''::text)::numeric, 0::numeric) AS entry_score,
    COALESCE(NULLIF(p.payload ->> 'upgrade_score'::text, ''::text)::numeric, 0::numeric) AS upgrade_score,
    COALESCE(p.payload -> 'source_flags'::text, '[]'::jsonb) AS source_flags,
    COALESCE(p.payload -> 'source_run_ids'::text, '[]'::jsonb) AS source_run_ids,
    COALESCE(p.payload -> 'priority_reasons'::text, p.payload -> 'pool_reasons'::text, '[]'::jsonb) AS priority_reasons,
    NULLIF(p.payload ->> 'source_updated_at'::text, ''::text)::timestamp with time zone AS source_updated_at,
    p.payload ->> 'source_freshness'::text AS source_freshness,
    q.price,
    q.open_price,
    q.previous_close,
    q.change_percent,
    evidence.total_volume AS total_volume,
    evidence.trade_value AS trade_value,
    q.quote_seen_at,
    EXTRACT(epoch FROM now() - q.quote_seen_at)::integer AS quote_age_seconds,
    b01_live_candle.candle_time AS latest_candle_time,
    COALESCE(EXTRACT(epoch FROM now() - b01_live_candle.candle_time)::integer, 999999) AS intraday_1m_stale_seconds,
    NULLIF(p.payload #>> '{motherPoolMetrics,ma5}'::text[], ''::text)::numeric AS ma5,
    NULLIF(p.payload #>> '{motherPoolMetrics,ma10}'::text[], ''::text)::numeric AS ma10,
    NULLIF(p.payload #>> '{motherPoolMetrics,ma20}'::text[], ''::text)::numeric AS ma20,
    NULLIF(p.payload #>> '{motherPoolMetrics,ma5}'::text[], ''::text)::numeric > NULLIF(p.payload #>> '{motherPoolMetrics,ma10}'::text[], ''::text)::numeric AND NULLIF(p.payload #>> '{motherPoolMetrics,ma10}'::text[], ''::text)::numeric > NULLIF(p.payload #>> '{motherPoolMetrics,ma20}'::text[], ''::text)::numeric AND NULLIF(p.payload #>> '{motherPoolMetrics,ma20}'::text[], ''::text)::numeric > 0::numeric AS ma5_ma10_ma20_bullish,
    '4.1.0'::text AS contract_version,
    p.payload ->> 'canonical_run_id'::text AS canonical_run_id,
    GREATEST(p.updated_at, COALESCE(q.updated_at, p.updated_at)) AS updated_at,
    q.last_trade_time,
    EXTRACT(epoch FROM now() - q.last_trade_time)::integer AS last_trade_age_seconds,
    evidence.total_volume_unit AS total_volume_unit,
    COALESCE(NULLIF(lower(q.payload ->> 'total_volume_raw_unit'::text), ''::text), NULLIF(lower(q.payload ->> 'total_volume_unit'::text), ''::text), NULLIF(lower(q.payload ->> 'volume_unit'::text), ''::text),
        CASE
            WHEN upper(COALESCE(q.market, ''::text)) = 'ESB'::text THEN 'shares'::text
            WHEN upper(COALESCE(q.market, ''::text)) = ANY (ARRAY['TSE'::text, 'OTC'::text, 'TIB'::text]) THEN 'lots'::text
            ELSE NULL::text
        END) AS total_volume_raw_unit,
    evidence.total_volume_source_event_at AS total_volume_source_event_at,
    evidence.total_volume_available AS total_volume_available,
    evidence.is_synthetic AS is_synthetic,
    evidence.total_volume_source AS total_volume_source,
        CASE
            WHEN COALESCE(NULLIF(lower(q.payload ->> 'total_volume_unit'::text), ''::text), NULLIF(lower(q.payload ->> 'volume_unit'::text), ''::text),
            CASE
                WHEN upper(COALESCE(q.market, ''::text)) = 'ESB'::text THEN 'shares'::text
                WHEN upper(COALESCE(q.market, ''::text)) = ANY (ARRAY['TSE'::text, 'OTC'::text, 'TIB'::text]) THEN 'lots'::text
                ELSE NULL::text
            END) = 'shares'::text THEN 'shares_divide_1000_to_lots'::text
            WHEN COALESCE(NULLIF(lower(q.payload ->> 'total_volume_unit'::text), ''::text), NULLIF(lower(q.payload ->> 'volume_unit'::text), ''::text),
            CASE
                WHEN upper(COALESCE(q.market, ''::text)) = 'ESB'::text THEN 'shares'::text
                WHEN upper(COALESCE(q.market, ''::text)) = ANY (ARRAY['TSE'::text, 'OTC'::text, 'TIB'::text]) THEN 'lots'::text
                ELSE NULL::text
            END) = 'lots'::text THEN 'lots_identity'::text
            ELSE NULL::text
        END AS total_volume_conversion_rule,
    p.priority_rank,
    COALESCE(NULLIF(p.payload ->> 'score'::text, ''::text)::numeric, NULLIF(p.payload ->> 'entry_score'::text, ''::text)::numeric, 0::numeric) AS mother_pool_score,
    COALESCE(NULLIF(p.payload ->> 'score'::text, ''::text)::numeric, NULLIF(p.payload ->> 'entry_score'::text, ''::text)::numeric, 0::numeric) AS priority_score,
    p.priority_reason AS mother_reason,
    p.source AS mother_source,
    COALESCE(NULLIF(p.payload ->> 'data_gap_reason'::text, ''::text), NULLIF(p.payload ->> 'avg3_volume_gate_status'::text, ''::text), 'unknown'::text) AS mother_readiness_status,
    COALESCE((p.payload ->> 'formal_pool_eligible'::text)::boolean, p.is_formal_entry_eligible, false) AS is_formal_entry_eligible,
    q.high_price,
    q.low_price,
    COALESCE(NULLIF(p.payload #>> '{motherPoolMetrics,avgVolume5}'::text[], ''::text)::numeric, 0::numeric) AS avg_volume5,
    q.trade_date AS quote_trade_date,
    p.updated_at AS mother_updated_at,
    NULLIF(p.payload ->> 'trade_date'::text, ''::text)::date AS pool_updated_trade_date,
    COALESCE(NULLIF(p.payload #>> '{motherPoolMetrics,stockGroupContract,sector}'::text[], ''::text), NULLIF(p.payload #>> '{motherPoolMetrics,stockGroupContract,industry}'::text[], ''::text)) AS sector_name,
    COALESCE(NULLIF(p.payload #>> '{motherPoolMetrics,sectorStrengthScore}'::text[], ''::text)::numeric, 0::numeric) AS sector_strength_score,
    COALESCE(NULLIF(p.payload #>> '{motherPoolMetrics,sectorMemberActiveCount}'::text[], ''::text)::integer, 0) AS sector_member_active_count,
    COALESCE((p.payload ->> 'industry_signal_fast_injected'::text)::boolean, false) AS industry_signal_fast_injected,
    COALESCE(p.payload -> 'industry_signal_fast_inject_industries'::text, '[]'::jsonb) AS industry_signal_fast_inject_industries,
    p.payload ->> 'writer_run_id'::text AS writer_run_id,
    p.payload ->> 'generation_id'::text AS generation_id,
    COALESCE(NULLIF(p.payload ->> 'source_name'::text, ''::text), NULLIF(p.source_name, ''::text), 'fugle_daytrade_source'::text) AS source_name,
    COALESCE(NULLIF(p.payload ->> 'source_trade_date'::text, ''::text)::date, NULLIF(p.payload ->> 'trade_date'::text, ''::text)::date) AS source_trade_date
  ,
    evidence.trade_value_unit AS trade_value_unit,
    evidence.trade_value_source_event_at AS trade_value_source_event_at,
    evidence.trade_value_available AS trade_value_available FROM fugle_daytrade_priority_pool p
     LEFT JOIN LATERAL ( SELECT c.candle_time
           FROM fugle_daytrade_intraday_1m c
          WHERE c.symbol = p.symbol AND c.trade_date = NULLIF(p.payload ->> 'trade_date'::text, ''::text)::date AND (c.candle_time AT TIME ZONE 'Asia/Taipei'::text)::date = c.trade_date AND (c.candle_time + '00:01:00'::interval) <= now() AND c.synthetic IS FALSE AND c.volume_strategy_usable IS TRUE AND (c.source = ANY (ARRAY['fugle_daytrade_writer:websocket_candles'::text, 'fugle_daytrade_writer:fugle_rest_candle_seed'::text, 'fugle_daytrade_writer:websocket_candle_0901'::text, 'fugle_daytrade_fast_sync:websocket_candles'::text])) AND c.intraday_odd_lot IS FALSE AND c.open > 0::numeric AND c.high > 0::numeric AND c.low > 0::numeric AND c.close > 0::numeric AND c.high >= GREATEST(c.open, c.close, c.low) AND c.low <= LEAST(c.open, c.close, c.high) AND c.volume >= 0::numeric AND (c.open::text <> ALL (ARRAY['NaN'::text, 'Infinity'::text, '-Infinity'::text])) AND (c.high::text <> ALL (ARRAY['NaN'::text, 'Infinity'::text, '-Infinity'::text])) AND (c.low::text <> ALL (ARRAY['NaN'::text, 'Infinity'::text, '-Infinity'::text])) AND (c.close::text <> ALL (ARRAY['NaN'::text, 'Infinity'::text, '-Infinity'::text])) AND (c.volume::text <> ALL (ARRAY['NaN'::text, 'Infinity'::text, '-Infinity'::text]))
          ORDER BY c.candle_time DESC
         LIMIT 1) b01_live_candle ON true
     LEFT JOIN fugle_daytrade_quotes_live q ON q.symbol = p.symbol AND q.trade_date = NULLIF(p.payload ->> 'trade_date'::text, ''::text)::date LEFT JOIN LATERAL public.fuman_native_liquidity_v1(q.payload,q.trade_date) evidence ON true
  WHERE COALESCE((p.payload ->> 'selected'::text)::boolean, false) AND (p.payload ->> 'contract_version'::text) = '4.1.0'::text;
CREATE OR REPLACE VIEW public.v_fugle_daytrade_quotes_live_v2 AS SELECT symbol,
    name,
    market,
    updated_at,
    quote_seen_at,
    price,
    open_price,
    high_price,
    low_price,
    previous_close,
    change_percent,
    evidence.total_volume AS total_volume,
    evidence.trade_value AS trade_value,
    bid_price,
    bid_volume,
    ask_price,
    ask_volume,
    cumulative_bid_volume,
    cumulative_ask_volume,
    cumulative_bid_ask_volume,
    stock_type,
    session,
    last_trade_time,
    source,
    payload,
    source_name,
    source_kind,
    is_realtime,
    is_fallback,
    is_formal_entry_eligible,
    ask_bid_ratio,
    is_halted,
    is_trial,
    ask_ratio,
    limit_up_price,
    limit_down_price,
    trade_date,
    'daytrade-quotes-live-trade-date-v1'::text AS contract_version,
    COALESCE(last_trade_time, quote_seen_at, updated_at) AS quote_event_at,
    ('fugle_daytrade_source:'::text || to_char(trade_date::timestamp with time zone, 'YYYYMMDD'::text)) || ':canonical'::text AS canonical_run_id,
    trade_date = (COALESCE(last_trade_time, quote_seen_at, updated_at) AT TIME ZONE 'Asia/Taipei'::text)::date AS quote_trade_date_match
  ,
    evidence.trade_value_unit AS trade_value_unit,
    evidence.trade_value_source_event_at AS trade_value_source_event_at,
    evidence.trade_value_available AS trade_value_available,
    evidence.total_volume_unit AS total_volume_unit,
    evidence.total_volume_source_event_at AS total_volume_source_event_at,
    evidence.total_volume_available AS total_volume_available,
    evidence.is_synthetic AS is_synthetic,
    evidence.total_volume_source AS total_volume_source,
    evidence.total_volume_available AS volume_strategy_usable FROM fugle_daytrade_quotes_live q LEFT JOIN LATERAL public.fuman_native_liquidity_v1(q.payload,q.trade_date) evidence ON true ;
CREATE OR REPLACE VIEW public.v_fugle_daytrade_mother_pool_v4_1_complete AS SELECT trade_date,
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
    price AS last_price
  ,
    base.trade_value_unit,
    base.trade_value_source_event_at,
    base.trade_value_available FROM v_fugle_daytrade_mother_pool_v4_1 base;
NOTIFY pgrst, 'reload schema';
COMMIT;
