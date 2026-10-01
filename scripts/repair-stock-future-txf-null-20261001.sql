-- Preserve absent or wrong-date TXF as NULL; existing strategy thresholds unchanged.
CREATE OR REPLACE VIEW public.v_stock_future_live_contract AS
WITH raw AS (
         SELECT q.future_symbol,
            q.future_symbol AS source_symbol,
            NULLIF(q.underlying_symbol, ''::text) AS raw_underlying_symbol,
            NULLIF(q.underlying_name, ''::text) AS raw_underlying_name,
            COALESCE(NULLIF(q.product, ''::text), NULLIF((q.payload ->> 'product'::text), ''::text)) AS raw_product,
            q.last_price,
            q.change_percent,
            q.total_volume,
            q.updated_at,
            q.payload
           FROM fugle_daytrade_futopt_quotes_live q
          WHERE (q.future_symbol IS NOT NULL)
        ), txf AS (
         SELECT raw.future_symbol AS txf_future_symbol,
            raw.last_price AS txf_last_price,
            raw.change_percent AS txf_change_percent,
            raw.total_volume AS txf_total_volume,
            raw.updated_at AS txf_updated_at
           FROM raw
          WHERE ((upper(COALESCE(raw.raw_product, ''::text)) = 'TXF'::text) OR (upper(COALESCE(raw.raw_underlying_symbol, ''::text)) = 'TXF'::text) OR (upper(COALESCE(raw.future_symbol, ''::text)) ~~ 'TXF%'::text))
          ORDER BY raw.updated_at DESC
         LIMIT 1
        ), stock_future AS (
         SELECT COALESCE(raw.raw_underlying_symbol, NULLIF((raw.payload ->> 'underlying_symbol'::text), ''::text)) AS symbol,
            COALESCE(raw.raw_underlying_name, NULLIF((raw.payload ->> 'underlying_name'::text), ''::text), NULLIF((raw.payload ->> 'name'::text), ''::text)) AS stock_name,
            raw.future_symbol,
            raw.source_symbol,
            raw.last_price AS futopt_last_price,
            raw.change_percent AS futopt_change_percent,
            raw.total_volume AS futopt_total_volume,
            raw.updated_at AS futopt_updated_at,
            raw.payload,
            COALESCE(raw.raw_product, 'STOCK_FUTURE'::text) AS product
           FROM raw
          WHERE ((upper(COALESCE(raw.raw_product, 'STOCK_FUTURE'::text)) = ANY (ARRAY['S'::text, 'STOCK_FUTURE'::text])) AND (COALESCE(raw.raw_underlying_symbol, (raw.payload ->> 'underlying_symbol'::text), ''::text) ~ '^[0-9]{4}$'::text))
        )
 SELECT ((sf.futopt_updated_at AT TIME ZONE 'Asia/Taipei'::text))::date AS trade_date,
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
    (sf.futopt_change_percent - (CASE WHEN txf.txf_updated_at IS NOT NULL AND ((txf.txf_updated_at AT TIME ZONE 'Asia/Taipei')::date = (sf.futopt_updated_at AT TIME ZONE 'Asia/Taipei')::date) AND txf.txf_updated_at <= now() THEN txf.txf_change_percent ELSE NULL::numeric END)) AS relative_to_txf_percent,
    (EXTRACT(epoch FROM (now() - sf.futopt_updated_at)) <= (60)::numeric) AS futopt_fresh_60s,
    (EXTRACT(epoch FROM (now() - txf.txf_updated_at)) <= (60)::numeric) AS txf_fresh_60s,
        CASE
            WHEN (sf.futopt_updated_at IS NULL) THEN 'missing'::text
            WHEN (((sf.futopt_updated_at AT TIME ZONE 'Asia/Taipei'::text))::date <> ((now() AT TIME ZONE 'Asia/Taipei'::text))::date) THEN 'stale'::text
            WHEN (EXTRACT(epoch FROM (now() - sf.futopt_updated_at)) <= (180)::numeric) THEN 'ready'::text
            ELSE 'stale'::text
        END AS source_status,
        CASE
            WHEN (sf.futopt_updated_at IS NULL) THEN 'stock future quote missing'::text
            WHEN (((sf.futopt_updated_at AT TIME ZONE 'Asia/Taipei'::text))::date <> ((now() AT TIME ZONE 'Asia/Taipei'::text))::date) THEN 'stock future quote not today'::text
            WHEN (EXTRACT(epoch FROM (now() - sf.futopt_updated_at)) <= (180)::numeric) THEN 'stock future quote ready'::text
            ELSE 'stock future quote stale'::text
        END AS reason,
    ((sf.futopt_change_percent >= (2)::numeric) AND ((sf.futopt_change_percent - (CASE WHEN txf.txf_updated_at IS NOT NULL AND ((txf.txf_updated_at AT TIME ZONE 'Asia/Taipei')::date = (sf.futopt_updated_at AT TIME ZONE 'Asia/Taipei')::date) AND txf.txf_updated_at <= now() THEN txf.txf_change_percent ELSE NULL::numeric END)) >= (1)::numeric) AND (sf.futopt_total_volume >= (50)::numeric)) AS star_precheck_ok,
    ((sf.futopt_change_percent >= (2)::numeric) AND ((sf.futopt_change_percent - (CASE WHEN txf.txf_updated_at IS NOT NULL AND ((txf.txf_updated_at AT TIME ZONE 'Asia/Taipei')::date = (sf.futopt_updated_at AT TIME ZONE 'Asia/Taipei')::date) AND txf.txf_updated_at <= now() THEN txf.txf_change_percent ELSE NULL::numeric END)) >= (1)::numeric) AND (sf.futopt_total_volume >= (50)::numeric) AND (EXTRACT(epoch FROM (now() - sf.futopt_updated_at)) <= (180)::numeric)) AS strategy2_futopt_gate_ok,
    sf.futopt_updated_at AS updated_at,
    sf.product,
    "substring"(sf.future_symbol, '[0-9]{3}$'::text) AS near_month,
    sf.symbol AS underlying_symbol,
    sf.futopt_last_price AS last_price,
    sf.futopt_change_percent AS change_percent,
    sf.futopt_total_volume AS total_volume,
    'fugle_daytrade_futopt_quotes_live'::text AS contract_source,
    (sf.payload ->> 'source'::text) AS formal_quote_source
   FROM ((stock_future sf
     LEFT JOIN txf ON (true))
     LEFT JOIN stock_tickers st ON ((st.symbol = sf.symbol)))
  ORDER BY sf.futopt_updated_at DESC, sf.symbol;
