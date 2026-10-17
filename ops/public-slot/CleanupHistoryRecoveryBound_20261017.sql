-- ISOLATED RELEASE CANDIDATE: no production execution authorized.
CREATE OR REPLACE FUNCTION public.fuman_cleanup_history_recovery_bound_v1(p_table text,p_cutoff timestamptz,p_archived_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public SET timezone TO 'UTC' SET statement_timeout TO '45s' SET lock_timeout TO '2s' AS $fn$
DECLARE col text; days integer; predicate text; missing boolean; n bigint; selected jsonb; schema_keys jsonb;
BEGIN
 CASE p_table
 WHEN 'mobile_update_events' THEN col='created_at';days=14;
 WHEN 'market_snapshots' THEN col='updated_at';days=60;
 WHEN 'fugle_daytrade_entry_history' THEN col='trade_date';days=37;
 WHEN 'seven_strategy_daily_history' THEN col='trade_date';days=37;
 ELSE RAISE EXCEPTION 'history_table_not_authorized'; END CASE;
 IF p_cutoff IS NULL OR p_cutoff>now()-make_interval(days=>days) THEN RAISE EXCEPTION 'history_retention_shortened'; END IF;
 IF jsonb_typeof(p_archived_rows) IS DISTINCT FROM 'array' OR pg_column_size(p_archived_rows)>268435456 THEN RAISE EXCEPTION 'history_archive_invalid'; END IF;
 SELECT jsonb_agg(attname ORDER BY attname) INTO schema_keys FROM pg_attribute WHERE attrelid=to_regclass('public.'||p_table) AND attnum>0 AND NOT attisdropped;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_archived_rows) a WHERE (SELECT jsonb_agg(k ORDER BY k) FROM jsonb_object_keys(a.value) k) IS DISTINCT FROM schema_keys) THEN RAISE EXCEPTION 'history_archive_schema_mismatch'; END IF;
 EXECUTE format('LOCK TABLE public.%I IN SHARE ROW EXCLUSIVE MODE',p_table);
 IF EXISTS(SELECT 1 FROM pg_constraint WHERE contype='f' AND confrelid=to_regclass('public.'||p_table)) THEN RAISE EXCEPTION 'history_dependents_require_review'; END IF;
 IF EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('public.'||p_table) AND NOT tgisinternal AND (tgtype & 8)<>0) THEN RAISE EXCEPTION 'history_delete_trigger_requires_review'; END IF;
 predicate=CASE WHEN col='trade_date' THEN format('%I < ($1 AT TIME ZONE ''UTC'')::date',col) ELSE format('%I < $1',col) END;
 IF p_table='market_snapshots' THEN predicate=predicate||' AND left(symbol,8)=''__fuman_'''; END IF;
 EXECUTE format('SELECT EXISTS(SELECT to_jsonb(t) FROM public.%I t WHERE %s EXCEPT ALL SELECT to_jsonb(a) FROM jsonb_populate_recordset(null::public.%I,$2) a)',p_table,predicate,p_table) INTO missing USING p_cutoff,p_archived_rows;
 IF missing THEN RAISE EXCEPTION 'history_unarchived_candidate'; END IF;
 EXECUTE format('WITH deleted AS (DELETE FROM public.%I WHERE %s RETURNING *) SELECT count(*),coalesce(jsonb_agg((SELECT a.value FROM jsonb_array_elements($2) a WHERE to_jsonb(jsonb_populate_record(null::public.%I,a.value))=to_jsonb(deleted) LIMIT 1)),''[]''::jsonb) FROM deleted',p_table,predicate,p_table) INTO n,selected USING p_cutoff,p_archived_rows;
 RETURN jsonb_build_object('ok',true,'contract','history-recovery-bound-v1','table',p_table,'deleted',n,'deletedRows',selected);
END $fn$;
REVOKE ALL ON FUNCTION public.fuman_cleanup_history_recovery_bound_v1(text,timestamptz,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fuman_cleanup_history_recovery_bound_v1(text,timestamptz,jsonb) TO service_role;
