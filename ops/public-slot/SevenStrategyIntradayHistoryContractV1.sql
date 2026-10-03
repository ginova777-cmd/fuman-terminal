-- Keep the existing public history entry; expose raw quality flags explicitly.
-- This does not fill missing bars or infer missing provenance.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
CREATE OR REPLACE VIEW public.v_fugle_daytrade_intraday_1m_volume_usable AS
SELECT symbol,market,candle_time,trade_date,open,high,low,close,volume,
       source,source_channel,candle_origin,updated_at,payload,
       synthetic,volume_strategy_usable,
       NULLIF(payload->>'volume_unit','') AS volume_unit,
       NULLIF(payload->>'volume_source','') AS volume_source,
       candle_time + interval '1 minute' AS bar_end_at,
       candle_time + interval '1 minute' <= now() AS bar_closed,
       NULLIF(payload->>'sourceCandleSeenAt','') AS source_received_at,
       NULL::timestamptz AS db_written_at,
       CASE WHEN NULLIF(payload->>'volume_unit','') IS NULL THEN 'VOLUME_UNIT_NOT_RECORDED' ELSE NULL END AS provenance_gap_reason
FROM public.fugle_daytrade_intraday_1m
WHERE volume_strategy_usable IS TRUE AND synthetic IS FALSE
  AND COALESCE(source,'') NOT ILIKE '%quote_derived%';
NOTIFY pgrst,'reload schema';
COMMIT;
