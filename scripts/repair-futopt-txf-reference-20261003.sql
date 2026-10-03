-- Exact evidence-backed TXF benchmark; preserve existing strategy thresholds.
CREATE OR REPLACE VIEW public.v_stock_future_live_contract AS
 WITH raw AS (
         SELECT q.future_symbol,
            q.future_symbol AS source_symbol,
            NULLIF(q.underlying_symbol, ''::text) AS raw_underlying_symbol,
            NULLIF(q.underlying_name, ''::text) AS raw_underlying_name,
            COALESCE(NULLIF(q.product, ''::text), NULLIF(q.payload ->> 'product'::text, ''::text)) AS raw_product,
            q.last_price,
            q.change_percent,
            q.total_volume,
            q.updated_at,
            q.payload
           FROM fugle_daytrade_futopt_quotes_live q
          WHERE q.future_symbol IS NOT NULL
        ), txf AS (
         SELECT raw.future_symbol AS txf_future_symbol,
            raw.last_price AS txf_last_price,
            raw.change_percent AS txf_change_percent,
            raw.total_volume AS txf_total_volume,
            raw.updated_at AS txf_updated_at, raw.payload
           FROM raw
          WHERE upper(COALESCE(raw.raw_product, ''::text)) = 'TXF'::text OR upper(COALESCE(raw.raw_underlying_symbol, ''::text)) = 'TXF'::text OR upper(COALESCE(raw.future_symbol, ''::text)) ~~ 'TXF%'::text

        ), stock_future AS (
         SELECT COALESCE(raw.raw_underlying_symbol, NULLIF(raw.payload ->> 'underlying_symbol'::text, ''::text)) AS symbol,
            COALESCE(raw.raw_underlying_name, NULLIF(raw.payload ->> 'underlying_name'::text, ''::text), NULLIF(raw.payload ->> 'name'::text, ''::text)) AS stock_name,
            raw.future_symbol,
            raw.source_symbol,
            raw.last_price AS futopt_last_price,
            raw.change_percent AS futopt_change_percent,
            raw.total_volume AS futopt_total_volume,
            raw.updated_at AS futopt_updated_at,
            raw.payload,
            COALESCE(raw.raw_product, 'STOCK_FUTURE'::text) AS product
           FROM raw
          WHERE (upper(COALESCE(raw.raw_product, 'STOCK_FUTURE'::text)) = ANY (ARRAY['S'::text, 'STOCK_FUTURE'::text])) AND COALESCE(raw.raw_underlying_symbol, raw.payload ->> 'underlying_symbol'::text, ''::text) ~ '^[0-9]{4}$'::text
        )
 SELECT (sf.futopt_updated_at AT TIME ZONE 'Asia/Taipei'::text)::date AS trade_date,
    sf.symbol,
    COALESCE(NULLIF(sf.stock_name, ''::text), st.name, sf.symbol) AS stock_name,
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
    sf.futopt_change_percent -
        CASE
            WHEN txf.txf_updated_at IS NOT NULL AND (txf.txf_updated_at AT TIME ZONE 'Asia/Taipei'::text)::date = (sf.futopt_updated_at AT TIME ZONE 'Asia/Taipei'::text)::date AND txf.txf_updated_at <= now() THEN txf.txf_change_percent
            ELSE NULL::numeric
        END AS relative_to_txf_percent,
    EXTRACT(epoch FROM now() - sf.futopt_updated_at) BETWEEN 0 AND 60::numeric AS futopt_fresh_60s,
    EXTRACT(epoch FROM now() - txf.txf_updated_at) BETWEEN 0 AND 60::numeric AS txf_fresh_60s,
        CASE
            WHEN sf.futopt_updated_at IS NULL THEN 'missing'::text
            WHEN sf.futopt_updated_at > now() THEN 'invalid'::text
            WHEN sf.futopt_last_price IS NULL OR sf.futopt_last_price <= 0 THEN 'missing'::text
            WHEN (sf.futopt_updated_at AT TIME ZONE 'Asia/Taipei'::text)::date <> (now() AT TIME ZONE 'Asia/Taipei'::text)::date THEN 'stale'::text
            WHEN EXTRACT(epoch FROM now() - sf.futopt_updated_at) BETWEEN 0 AND 180::numeric THEN 'ready'::text
            ELSE 'stale'::text
        END AS source_status,
        CASE
            WHEN sf.futopt_updated_at IS NULL THEN 'stock future quote missing'::text
            WHEN sf.futopt_updated_at > now() THEN 'stock future event is in the future'::text
            WHEN sf.futopt_last_price IS NULL OR sf.futopt_last_price <= 0 THEN 'native stock future price missing'::text
            WHEN (sf.futopt_updated_at AT TIME ZONE 'Asia/Taipei'::text)::date <> (now() AT TIME ZONE 'Asia/Taipei'::text)::date THEN 'stock future quote not today'::text
            WHEN EXTRACT(epoch FROM now() - sf.futopt_updated_at) BETWEEN 0 AND 180::numeric THEN 'stock future quote ready'::text
            ELSE 'stock future quote stale'::text
        END AS reason,
    sf.futopt_change_percent >= 2::numeric AND (sf.futopt_change_percent -
        CASE
            WHEN txf.txf_updated_at IS NOT NULL AND (txf.txf_updated_at AT TIME ZONE 'Asia/Taipei'::text)::date = (sf.futopt_updated_at AT TIME ZONE 'Asia/Taipei'::text)::date AND txf.txf_updated_at <= now() THEN txf.txf_change_percent
            ELSE NULL::numeric
        END) >= 1::numeric AND sf.futopt_total_volume >= 50::numeric AS star_precheck_ok,
    sf.futopt_change_percent >= 2::numeric AND (sf.futopt_change_percent -
        CASE
            WHEN txf.txf_updated_at IS NOT NULL AND (txf.txf_updated_at AT TIME ZONE 'Asia/Taipei'::text)::date = (sf.futopt_updated_at AT TIME ZONE 'Asia/Taipei'::text)::date AND txf.txf_updated_at <= now() THEN txf.txf_change_percent
            ELSE NULL::numeric
        END) >= 1::numeric AND sf.futopt_total_volume >= 50::numeric AND EXTRACT(epoch FROM now() - sf.futopt_updated_at) BETWEEN 0 AND 180::numeric AS strategy2_futopt_gate_ok,
    sf.futopt_updated_at AS updated_at,
    sf.product,
    "substring"(sf.future_symbol, '[0-9]{3}$'::text) AS near_month,
    sf.symbol AS underlying_symbol,
    sf.futopt_last_price AS last_price,
    sf.futopt_change_percent AS change_percent,
    sf.futopt_total_volume AS total_volume,
    'fugle_daytrade_futopt_quotes_live'::text AS contract_source,
    sf.payload ->> 'source'::text AS formal_quote_source
   FROM stock_future sf
     LEFT JOIN txf ON 
       txf.txf_future_symbol = sf.payload #>> '{txf_reference,future_symbol}'
       AND sf.payload ->> 'txf_reference_status' = 'VERIFIED_CATALOGUE'
       AND txf.payload ->> 'txf_reference_status' = 'VERIFIED_CATALOGUE'
       AND sf.payload -> 'txf_reference' = txf.payload -> 'txf_reference'
       AND sf.payload #>> '{txf_reference,contract}' = 'fugle-txf-reference-v1'
       AND sf.payload #>> '{txf_reference,selection_rule}' = 'earliest_unexpired_verified_expiry'
       AND sf.payload #>> '{txf_reference,catalogue_source_hash}' ~ '^[a-f0-9]{64}$'
       AND length(sf.payload #>> '{txf_reference,catalogue_run_id}') > 0
       AND sf.payload #>> '{txf_reference,trade_date}' = ((sf.futopt_updated_at AT TIME ZONE 'Asia/Taipei')::date)::text
       AND sf.payload #>> '{txf_reference,expiry_date}' >= ((sf.futopt_updated_at AT TIME ZONE 'Asia/Taipei')::date)::text
       AND (txf.txf_updated_at AT TIME ZONE 'Asia/Taipei')::date = (sf.futopt_updated_at AT TIME ZONE 'Asia/Taipei')::date
       AND txf.txf_updated_at <= now()
       AND txf.txf_last_price > 0
     LEFT JOIN stock_tickers st ON st.symbol = sf.symbol
  ORDER BY sf.futopt_updated_at DESC, sf.symbol;

CREATE OR REPLACE VIEW public.v_fugle_daytrade_stock_future_near_one_contract AS
 WITH clock AS (
         SELECT (now() AT TIME ZONE 'Asia/Taipei'::text)::date AS trade_date
        ), ticker_meta AS (
         SELECT DISTINCT ON (t.future_symbol) t.future_symbol,
            t.name AS future_name,
            t.contract_type,
            t.product AS ticker_product,
                CASE
                    WHEN NULLIF(t.end_date::text, ''::text) ~ '^\d{4}-\d{2}-\d{2}$'::text THEN t.end_date
                    WHEN NULLIF(t.end_date::text, ''::text) ~ '^\d{8}$'::text THEN to_date(t.end_date::text, 'YYYYMMDD'::text)
                    WHEN NULLIF(t.payload ->> 'CDate'::text, ''::text) ~ '^\d{8}$'::text THEN to_date(t.payload ->> 'CDate'::text, 'YYYYMMDD'::text)
                    ELSE NULL::date
                END AS contract_end_date,
            t.exchange,
            t.underlying_name AS ticker_underlying_name,
            t.underlying_symbol AS ticker_underlying_symbol,
            t.session AS ticker_session,
            t.updated_at AS ticker_updated_at
           FROM futopt_tickers t
          WHERE t.future_symbol IS NOT NULL
          ORDER BY t.future_symbol, t.updated_at DESC NULLS LAST
        ), raw AS (
         SELECT q.future_symbol,
            c_1.trade_date,
            COALESCE(NULLIF(q.underlying_symbol, ''::text), NULLIF(q.payload ->> 'underlying_symbol'::text, ''::text)) AS underlying_symbol,
            COALESCE(NULLIF(q.underlying_name, ''::text), NULLIF(q.payload ->> 'underlying_name'::text, ''::text), NULLIF(q.payload ->> 'name'::text, ''::text)) AS underlying_name,
            COALESCE(NULLIF(q.product, ''::text), NULLIF(q.payload ->> 'product'::text, ''::text)) AS quote_product,
            q.last_price,
            q.change_percent,
            q.total_volume,
            q.updated_at,
            q.source,
            q.payload,
            tm.future_name,
            tm.contract_type,
            tm.ticker_product,
            tm.contract_end_date,
            tm.exchange,
            tm.ticker_underlying_name,
            tm.ticker_underlying_symbol,
            tm.ticker_session,
            tm.ticker_updated_at
           FROM fugle_daytrade_futopt_quotes_live q
             LEFT JOIN ticker_meta tm ON tm.future_symbol = q.future_symbol
             CROSS JOIN clock c_1
          WHERE q.future_symbol IS NOT NULL AND COALESCE(NULLIF(q.underlying_symbol, ''::text), NULLIF(q.payload ->> 'underlying_symbol'::text, ''::text)) ~ '^\d{4}$'::text AND (upper(COALESCE(NULLIF(q.product, ''::text), NULLIF(q.payload ->> 'product'::text, ''::text), 'STOCK_FUTURE'::text)) = ANY (ARRAY['S'::text, 'STOCK_FUTURE'::text])) AND (q.updated_at AT TIME ZONE 'Asia/Taipei'::text)::date = c_1.trade_date AND (tm.contract_end_date IS NULL OR tm.contract_end_date >= c_1.trade_date)
        ), ranked AS (
         SELECT r.future_symbol,
            r.trade_date,
            r.underlying_symbol,
            r.underlying_name,
            r.quote_product,
            r.last_price,
            r.change_percent,
            r.total_volume,
            r.updated_at,
            r.source,
            r.payload,
            r.future_name,
            r.contract_type,
            r.ticker_product,
            r.contract_end_date,
            r.exchange,
            r.ticker_underlying_name,
            r.ticker_underlying_symbol,
            r.ticker_session,
            r.ticker_updated_at,
            row_number() OVER (PARTITION BY r.underlying_symbol ORDER BY (
                CASE
                    WHEN r.contract_end_date IS NULL THEN 1
                    ELSE 0
                END), r.contract_end_date, r.updated_at DESC NULLS LAST, r.future_symbol) AS rn
           FROM raw r
        ), txf AS (
         SELECT q.future_symbol AS txf_future_symbol,
            q.last_price AS txf_last_price,
            q.change_percent AS txf_change_percent,
            q.total_volume AS txf_total_volume,
            q.updated_at AS txf_updated_at, q.payload
           FROM fugle_daytrade_futopt_quotes_live q
             CROSS JOIN clock c_1
          WHERE upper(COALESCE(NULLIF(q.product, ''::text), NULLIF(q.payload ->> 'product'::text, ''::text), ''::text)) = 'TXF'::text AND (q.updated_at AT TIME ZONE 'Asia/Taipei'::text)::date = c_1.trade_date

        ), chosen AS (
         SELECT r.future_symbol,
            r.trade_date,
            r.underlying_symbol,
            r.underlying_name,
            r.quote_product,
            r.last_price,
            r.change_percent,
            r.total_volume,
            r.updated_at,
            r.source,
            r.payload,
            r.future_name,
            r.contract_type,
            r.ticker_product,
            r.contract_end_date,
            r.exchange,
            r.ticker_underlying_name,
            r.ticker_underlying_symbol,
            r.ticker_session,
            r.ticker_updated_at,
            r.rn
           FROM ranked r
          WHERE r.rn = 1
        )
 SELECT c.trade_date,
    c.underlying_symbol,
    COALESCE(NULLIF(c.underlying_name, ''::text), NULLIF(c.ticker_underlying_name, ''::text), c.ticker_underlying_symbol, c.underlying_symbol) AS underlying_name,
    c.future_symbol,
    c.future_name,
    c.contract_type,
    c.contract_end_date,
    c.exchange,
    c.ticker_session,
    c.last_price,
    c.change_percent,
    c.total_volume,
    c.updated_at,
    c.source AS contract_source,
    'fugle_daytrade_futopt_quotes_live'::text AS formal_quote_source,
        CASE
            WHEN c.contract_end_date IS NULL THEN 'current_live_expiry_unknown'::text
            WHEN c.contract_end_date >= c.trade_date THEN 'current_live_valid'::text
            ELSE 'expired'::text
        END AS near_contract_status,
    EXTRACT(epoch FROM now() - c.updated_at)::integer AS quote_age_seconds,
    tx.txf_future_symbol,
    tx.txf_last_price,
    tx.txf_change_percent,
    tx.txf_total_volume,
    tx.txf_updated_at,
    c.change_percent - tx.txf_change_percent AS relative_to_txf_percent,
        CASE
            WHEN tx.txf_updated_at IS NULL THEN 'txf_missing'::text
            WHEN EXTRACT(epoch FROM now() - tx.txf_updated_at) > 180::numeric THEN 'txf_stale'::text
            ELSE 'ready'::text
        END AS txf_status
   FROM chosen c
     LEFT JOIN txf tx ON 
       tx.txf_future_symbol = c.payload #>> '{txf_reference,future_symbol}'
       AND c.payload ->> 'txf_reference_status' = 'VERIFIED_CATALOGUE'
       AND tx.payload ->> 'txf_reference_status' = 'VERIFIED_CATALOGUE'
       AND c.payload -> 'txf_reference' = tx.payload -> 'txf_reference'
       AND c.payload #>> '{txf_reference,contract}' = 'fugle-txf-reference-v1'
       AND c.payload #>> '{txf_reference,selection_rule}' = 'earliest_unexpired_verified_expiry'
       AND c.payload #>> '{txf_reference,catalogue_source_hash}' ~ '^[a-f0-9]{64}$'
       AND length(c.payload #>> '{txf_reference,catalogue_run_id}') > 0
       AND c.payload #>> '{txf_reference,trade_date}' = (c.trade_date)::text
       AND c.payload #>> '{txf_reference,expiry_date}' >= (c.trade_date)::text
       AND (tx.txf_updated_at AT TIME ZONE 'Asia/Taipei')::date = c.trade_date
       AND tx.txf_updated_at <= now()
       AND tx.txf_last_price > 0;
