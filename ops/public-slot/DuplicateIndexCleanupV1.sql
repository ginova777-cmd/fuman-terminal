-- Owner-authorized exact index retirement; no table/data deletion.
CREATE OR REPLACE FUNCTION public.fuman_cleanup_duplicate_indexes_v1(p_apply boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog SET lock_timeout='2s' SET statement_timeout='15s'
AS $fn$
DECLARE policy jsonb := '[{"table":"fugle_daytrade_intraday_1m","keep":"fugle_daytrade_intraday_1m_trade_date_symbol_candle_time_idx","remove":["idx_fugle_daytrade_intraday_1m_trade_date_symbol_candle","fugle_daytrade_intraday_1m_trade_symbol_time_idx","idx_fugle_daytrade_intraday_1m_trade_date"]},{"table":"fugle_daytrade_intraday_1m","keep":"fugle_daytrade_intraday_1m_symbol_candle_time_idx","remove":["idx_fugle_daytrade_intraday_1m_symbol_candle","idx_fugle_daytrade_intraday_1m_symbol_candle_time","idx_fugle_daytrade_intraday_1m_symbol_candle_time_desc","idx_daytrade_intraday_1m_symbol_time"]},{"table":"fugle_intraday_1m","keep":"idx_fugle_intraday_1m_trade_symbol_time","remove":["idx_fugle_intraday_1m_trade_date","idx_fugle_intraday_1m_trade_symbol_time_desc"]},{"table":"fugle_intraday_1m","keep":"idx_fugle_intraday_1m_symbol_trade_date_candle_desc","remove":["idx_fugle_intraday_1m_symbol_trade_time_desc"]},{"table":"fugle_intraday_1m","keep":"idx_fugle_intraday_1m_symbol_candle_desc","remove":["idx_fugle_intraday_1m_symbol_time","idx_fugle_intraday_1m_symbol_candle_time_desc"]},{"table":"fugle_daytrade_quotes_live","keep":"fugle_daytrade_quotes_live_quote_seen_at_idx","remove":["idx_fugle_daytrade_quotes_live_seen_at"]},{"table":"strategy2_intraday_ready_cache","keep":"idx_strategy2_intraday_ready_cache_date_symbol","remove":["idx_strategy2_intraday_ready_cache_quote_updated_symbol"]},{"table":"fugle_daytrade_futopt_quotes_live","keep":"idx_daytrade_futopt_underlying","remove":["idx_fugle_daytrade_futopt_underlying"]},{"table":"fugle_source_coverage","keep":"idx_fugle_source_coverage_trade_date_checked_at","remove":["fugle_source_coverage_trade_date_checked_at_idx"]}]'::jsonb;
g jsonb; target text; keep_oid oid; drop_oid oid; table_oid oid; ki record; di record;
items jsonb := '[]'; released bigint := 0; bytes bigint; ddl text; local_hour integer;
BEGIN
 IF p_apply THEN
  local_hour := extract(hour from current_timestamp AT TIME ZONE 'Asia/Taipei');
  IF local_hour>=6 AND local_hour<14 THEN RAISE EXCEPTION 'MARKET_WINDOW_PROTECTED'; END IF;
  IF NOT pg_try_advisory_xact_lock(734220260930::bigint) THEN RAISE EXCEPTION 'JANITOR_INDEX_CLEANUP_BUSY'; END IF;
 END IF;
 FOR g IN SELECT value FROM jsonb_array_elements(policy) LOOP
  table_oid := to_regclass(format('public.%I',g->>'table'));
  keep_oid := to_regclass(format('public.%I',g->>'keep'));
  IF table_oid IS NULL OR keep_oid IS NULL THEN RAISE EXCEPTION 'KEEP_INDEX_MISSING: %',g->>'keep'; END IF;
  IF p_apply THEN EXECUTE format('LOCK TABLE public.%I IN SHARE UPDATE EXCLUSIVE MODE NOWAIT',g->>'table'); END IF;
  SELECT i.*,c.relam,c.reloptions INTO ki FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indexrelid=keep_oid;
  IF ki.indrelid IS DISTINCT FROM table_oid OR NOT ki.indisvalid OR NOT ki.indisready OR NOT ki.indislive OR ki.indisunique OR ki.indisprimary OR ki.indisreplident OR ki.indisclustered THEN RAISE EXCEPTION 'KEEP_INDEX_UNSAFE'; END IF;
  FOR target IN SELECT jsonb_array_elements_text(g->'remove') LOOP
   drop_oid := to_regclass(format('public.%I',target));
   IF drop_oid IS NULL THEN CONTINUE; END IF;
   SELECT i.*,c.relam,c.reloptions INTO di FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indexrelid=drop_oid;
   IF di.indexrelid IS NULL OR (to_jsonb(di)-'indexrelid') IS DISTINCT FROM (to_jsonb(ki)-'indexrelid') THEN RAISE EXCEPTION 'INDEX_DEFINITION_DRIFT: %',target; END IF;
   IF EXISTS(SELECT 1 FROM pg_constraint WHERE conindid IN (drop_oid,keep_oid)) THEN RAISE EXCEPTION 'CONSTRAINT_INDEX_PROTECTED'; END IF;
   bytes:=pg_relation_size(drop_oid);ddl:=pg_get_indexdef(drop_oid);
   IF p_apply THEN EXECUTE format('DROP INDEX public.%I RESTRICT',target); END IF;
   items:=items||jsonb_build_array(jsonb_build_object('table',g->>'table','removed_index',target,'kept_index',g->>'keep','bytes',bytes,'restore_ddl',ddl,'applied',p_apply));
   released:=released+bytes;
  END LOOP;
 END LOOP;
 RETURN jsonb_build_object('contract','duplicate-index-cleanup-v1','ok',true,'applied',p_apply,'checkedAt',clock_timestamp(),'count',jsonb_array_length(items),'relation_bytes',released,'items',items);
END $fn$;
REVOKE ALL ON FUNCTION public.fuman_cleanup_duplicate_indexes_v1(boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fuman_cleanup_duplicate_indexes_v1(boolean) TO service_role;
NOTIFY pgrst, 'reload schema';
