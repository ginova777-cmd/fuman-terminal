BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
ALTER TABLE public.fugle_daytrade_intraday_1m
 ADD COLUMN IF NOT EXISTS db_written_at timestamptz,
 ADD COLUMN IF NOT EXISTS version_first_written_at timestamptz,
 ADD COLUMN IF NOT EXISTS publication_revision integer;
-- Record server write time, not commit/first-reader visibility. Never backfill history.
CREATE OR REPLACE FUNCTION public.fuman_candle_publication_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $fn$
DECLARE changed boolean; stamp timestamptz:=clock_timestamp();
BEGIN
 IF TG_OP='INSERT' THEN changed:=true;
 ELSE changed:=ROW(NEW.open,NEW.high,NEW.low,NEW.close,NEW.volume,NEW.market,NEW.source,NEW.synthetic,NEW.volume_strategy_usable,
 NEW.payload->'volume_unit',NEW.payload->'raw_sha256',NEW.payload->'raw_row_sha256',NEW.payload->'sourceCandleSeenAt',NEW.payload->'source_received_at')
 IS DISTINCT FROM ROW(OLD.open,OLD.high,OLD.low,OLD.close,OLD.volume,OLD.market,OLD.source,OLD.synthetic,OLD.volume_strategy_usable,
 OLD.payload->'volume_unit',OLD.payload->'raw_sha256',OLD.payload->'raw_row_sha256',OLD.payload->'sourceCandleSeenAt',OLD.payload->'source_received_at'); END IF;
 IF changed THEN
 NEW.db_written_at:=stamp; NEW.version_first_written_at:=stamp;
 NEW.publication_revision:=CASE WHEN TG_OP='INSERT' THEN 1 ELSE coalesce(OLD.publication_revision,0)+1 END;
 ELSIF TG_OP='UPDATE' THEN
 NEW.db_written_at:=OLD.db_written_at;NEW.version_first_written_at:=OLD.version_first_written_at;NEW.publication_revision:=OLD.publication_revision;
 END IF;
 -- Preserve writer payload and make evidence visible through the existing RPC payload.
 NEW.payload:=coalesce(NEW.payload,'{}'::jsonb)||jsonb_build_object('db_written_at',NEW.db_written_at,
 'version_first_written_at',NEW.version_first_written_at,'publication_revision',NEW.publication_revision,
 'publication_time_contract','server-row-write-v1','commit_visibility_verified',false);
 RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.fuman_candle_publication_v1() FROM PUBLIC;
DROP TRIGGER IF EXISTS fuman_candle_publication_v1 ON public.fugle_daytrade_intraday_1m;
CREATE TRIGGER fuman_candle_publication_v1 BEFORE INSERT OR UPDATE ON public.fugle_daytrade_intraday_1m FOR EACH ROW EXECUTE FUNCTION public.fuman_candle_publication_v1();
CREATE OR REPLACE VIEW public.v_fugle_daytrade_intraday_1m_volume_usable AS
SELECT symbol,market,candle_time,trade_date,open,high,low,close,volume,
 source,source_channel,candle_origin,updated_at,payload,synthetic,volume_strategy_usable,
 NULLIF(payload->>'volume_unit','') AS volume_unit,
 NULLIF(payload->>'volume_source','') AS volume_source,
 candle_time+interval '1 minute' AS bar_end_at,
 candle_time+interval '1 minute'<=now() AS bar_closed,
 COALESCE(NULLIF(payload->>'sourceCandleSeenAt',''),NULLIF(payload->>'source_received_at','')) AS source_received_at,
 db_written_at,
 CASE WHEN NULLIF(payload->>'volume_unit','') IS NULL THEN 'VOLUME_UNIT_NOT_RECORDED'
 WHEN db_written_at IS NULL THEN 'PUBLICATION_TIME_NOT_RECORDED' ELSE NULL END AS provenance_gap_reason,
 version_first_written_at,publication_revision,
 CASE WHEN to_char(candle_time AT TIME ZONE 'Asia/Taipei','HH24:MI')='13:30' THEN 'CLOSING_AUCTION' ELSE 'REGULAR' END AS session_kind
FROM public.fugle_daytrade_intraday_1m
WHERE volume_strategy_usable IS TRUE AND synthetic IS FALSE AND COALESCE(source,'') NOT ILIKE '%quote_derived%';
NOTIFY pgrst,'reload schema';
COMMIT;
