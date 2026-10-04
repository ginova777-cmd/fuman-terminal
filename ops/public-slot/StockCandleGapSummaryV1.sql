BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
-- Bounded source diagnostics only. No raw rows or trading decisions.
CREATE OR REPLACE FUNCTION public.get_fugle_daytrade_1m_gap_summary(p_trade_date date,p_symbol text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public SET statement_timeout='5s' AS $fn$
DECLARE result jsonb;
BEGIN
 IF p_trade_date IS NULL OR p_symbol IS NULL OR p_symbol !~ '^[0-9]{4}$' THEN RAISE EXCEPTION 'READ_ARGUMENT_INVALID'; END IF;
 SELECT jsonb_build_object('contract','stock-1m-gap-summary-v1','trade_date',p_trade_date,'symbol',p_symbol,
 'raw_count',count(*),'usable_count',count(*) FILTER(WHERE synthetic IS FALSE AND volume_strategy_usable IS TRUE AND coalesce(source,'') NOT ILIKE '%quote_derived%'),
 'synthetic_count',count(*) FILTER(WHERE synthetic IS TRUE),'quality_rejected_count',count(*) FILTER(WHERE synthetic IS DISTINCT FROM FALSE OR volume_strategy_usable IS DISTINCT FROM TRUE),
 'missing_unit_count',count(*) FILTER(WHERE coalesce(payload->>'volume_unit','') NOT IN ('lots','shares')),
 'missing_write_time_count',count(*) FILTER(WHERE db_written_at IS NULL),
 'first_candle_time',min(candle_time),'last_candle_time',max(candle_time),
 'minutes',coalesce(jsonb_agg(jsonb_build_object('candle_time',candle_time,'filtered',NOT(synthetic IS FALSE AND volume_strategy_usable IS TRUE AND coalesce(source,'') NOT ILIKE '%quote_derived%'),'volume_unit',payload->>'volume_unit','db_written_at',db_written_at,'publication_revision',publication_revision) ORDER BY candle_time),'[]'::jsonb),
 'missing_minute_default','UNKNOWN_DATA_GAP','no_trade_inference_allowed',false)
 INTO result FROM public.fugle_daytrade_intraday_1m WHERE trade_date=p_trade_date AND symbol=p_symbol;
 RETURN result;
END;
$fn$;
REVOKE ALL ON FUNCTION public.get_fugle_daytrade_1m_gap_summary(date,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_fugle_daytrade_1m_gap_summary(date,text) TO anon,authenticated,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
