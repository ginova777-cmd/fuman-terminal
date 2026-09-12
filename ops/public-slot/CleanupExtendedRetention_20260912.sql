-- Extended cleanup is separate from source retention. No daily/1m/5m source deletion.
CREATE OR REPLACE FUNCTION public.fuman_cleanup_run_referenced_v1(p_run text, p_protected text[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT p_run IS NULL OR p_run='' OR p_run=ANY(p_protected)
 OR EXISTS(SELECT 1 FROM public.trade_records WHERE run_id=p_run OR evidence_run_id=p_run)
 OR EXISTS(SELECT 1 FROM public.market_snapshots WHERE strpos(coalesce(payload::text,''),p_run)>0)
 OR EXISTS(SELECT 1 FROM public.fuman_scorecard_ledger WHERE strpos(coalesce(payload::text,''),p_run)>0)
$$;
REVOKE ALL ON FUNCTION public.fuman_cleanup_run_referenced_v1(text,text[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fuman_cleanup_run_referenced_v1(text,text[]) TO service_role;

CREATE OR REPLACE FUNCTION public.fuman_extended_cleanup_v1(p_apply boolean DEFAULT false,p_protected_run_ids text[] DEFAULT ARRAY[]::text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET statement_timeout='45s' SET lock_timeout='2s' AS $$
DECLARE prefix text; rt text; dt text; ids text[]; tids tid[]; n bigint; dn bigint; dr bigint; sections jsonb='[]'; before_hash text; after_hash text; latest text; latest_rows_hash text; after_rows_hash text; keep_n int; cutoff timestamptz=now()-interval '15 days'; query_sql text;
BEGIN
 IF p_apply AND (now() AT TIME ZONE 'Asia/Taipei')::time < time '16:15' THEN RAISE EXCEPTION 'extended_cleanup_before_1615'; END IF;
 IF NOT pg_try_advisory_xact_lock(hashtext('fuman_extended_cleanup_v1')) THEN RAISE EXCEPTION 'extended_cleanup_already_running'; END IF;
 IF coalesce(cardinality(p_protected_run_ids),0)>100000 THEN RAISE EXCEPTION 'protected_ids_bound'; END IF;
 FOREACH prefix IN ARRAY ARRAY['strategy1_open_buy','strategy2_scan','strategy3_v2_scan','strategy4_scan','strategy5_scan','institution_scan','cb_detect_scan','warrant_flow_scan'] LOOP
  rt=prefix||'_runs';dt=prefix||'_results';keep_n=CASE WHEN prefix='strategy2_scan' THEN 60 ELSE 20 END;
  IF EXISTS(SELECT 1 FROM pg_constraint WHERE contype='f' AND (confrelid=to_regclass('public.'||dt) OR (confrelid=to_regclass('public.'||rt) AND conrelid<>to_regclass('public.'||dt)))) THEN RAISE EXCEPTION 'new_dependent_table_requires_cleanup_contract:%',rt; END IF;
  IF p_apply THEN EXECUTE format('LOCK TABLE public.%I,public.%I IN SHARE ROW EXCLUSIVE MODE',rt,dt); END IF;
  -- Protect latest complete results, all recent batches and runtime/DB publication references.
  EXECUTE format('SELECT run_id FROM public.%I r WHERE complete AND status=''complete'' ORDER BY coalesce(to_jsonb(r)->>''finished_at'',to_jsonb(r)->>''updated_at'',to_jsonb(r)->>''created_at'') DESC NULLS LAST,run_id DESC LIMIT 1',rt) INTO latest;
  EXECUTE format('SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.run_id)::text,''[]'')) FROM public.%I r WHERE r.run_id=$1',rt) INTO before_hash USING latest;
  EXECUTE format('SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text)::text,''[]'')) FROM public.%I r WHERE r.run_id=$1',dt) INTO latest_rows_hash USING latest;
  query_sql=format($q$SELECT coalesce(array_agg(run_id),ARRAY[]::text[]) FROM (
    SELECT r.run_id FROM public.%I r WHERE NOT r.complete AND r.status IN ('failed','error','aborted','cancelled')
    AND coalesce(to_jsonb(r)->>'updated_at',to_jsonb(r)->>'finished_at',to_jsonb(r)->>'created_at',to_jsonb(r)->>'started_at')::timestamptz < $1
    AND coalesce(to_jsonb(r)->'payload','{}'::jsonb)::text !~* 'recovery|repair|pending|retry'
    AND NOT public.fuman_cleanup_run_referenced_v1(r.run_id,$2)
    AND r.run_id NOT IN (SELECT run_id FROM public.%I s ORDER BY coalesce(to_jsonb(s)->>'finished_at',to_jsonb(s)->>'updated_at',to_jsonb(s)->>'created_at') DESC NULLS LAST,run_id DESC LIMIT %s)
    ORDER BY r.run_id LIMIT 5000)s$q$,rt,rt,keep_n);
  EXECUTE query_sql INTO ids USING cutoff,p_protected_run_ids;n=cardinality(ids);dn=0;dr=0;
  IF p_apply AND n>0 THEN
   EXECUTE format('DELETE FROM public.%I WHERE run_id=ANY($1)',dt) USING ids;GET DIAGNOSTICS dn=ROW_COUNT;
   EXECUTE format('DELETE FROM public.%I WHERE run_id=ANY($1)',rt) USING ids;GET DIAGNOSTICS dr=ROW_COUNT;
  END IF;
  sections=sections||jsonb_build_object('category','failed_runs','table',rt,'candidateCount',n,'deletedRows',dn,'deletedRuns',dr,'keepDays',15,'protectedRecentRuns',keep_n);
  query_sql=format($q$SELECT coalesce(array_agg(ctid),ARRAY[]::tid[]) FROM (
   SELECT r.ctid FROM public.%I r WHERE r.run_id IS NOT NULL AND r.run_id<>''
   AND coalesce(to_jsonb(r)->>'updated_at',to_jsonb(r)->>'created_at',to_jsonb(r)->>'scan_time',to_jsonb(r)->>'scan_date',to_jsonb(r)->>'trade_date')::timestamptz < now()-interval '45 days'
   AND NOT EXISTS(SELECT 1 FROM public.%I s WHERE s.run_id=r.run_id)
   AND NOT public.fuman_cleanup_run_referenced_v1(r.run_id,$1) ORDER BY r.ctid LIMIT 5000)s$q$,dt,rt);
  EXECUTE query_sql INTO tids USING p_protected_run_ids;n=cardinality(tids);dn=0;
  IF p_apply AND n>0 THEN EXECUTE format('DELETE FROM public.%I WHERE ctid=ANY($1)',dt) USING tids;GET DIAGNOSTICS dn=ROW_COUNT; END IF;
  EXECUTE format('SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.run_id)::text,''[]'')) FROM public.%I r WHERE r.run_id=$1',rt) INTO after_hash USING latest;
  EXECUTE format('SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text)::text,''[]'')) FROM public.%I r WHERE r.run_id=$1',dt) INTO after_rows_hash USING latest;
  IF before_hash IS DISTINCT FROM after_hash OR latest_rows_hash IS DISTINCT FROM after_rows_hash THEN RAISE EXCEPTION 'latest_complete_changed:%',rt; END IF;
  sections=sections||jsonb_build_object('category','orphan_results','table',dt,'candidateCount',n,'deletedRows',dn,'keepDays',45,'latestCompleteRunId',latest,'protectedHashBefore',latest_rows_hash,'protectedHashAfter',after_rows_hash);
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_constraint WHERE contype='f' AND confrelid='public.fugle_daytrade_quote_snapshots'::regclass) THEN RAISE EXCEPTION 'quote_snapshot_dependencies_require_cleanup_contract'; END IF;
 IF p_apply THEN LOCK TABLE public.fugle_daytrade_quote_snapshots IN SHARE ROW EXCLUSIVE MODE; END IF;
 -- Equality includes source, run, symbol, all timestamps and payload; similar quotes are NOT duplicates.
 SELECT coalesce(array_agg(id),ARRAY[]::text[]) INTO ids FROM (
  SELECT id::text FROM (SELECT id,run_id,row_number() OVER (PARTITION BY to_jsonb(q)-'id' ORDER BY id) AS rn
   FROM public.fugle_daytrade_quote_snapshots q WHERE snapshot_at<cutoff) d
  WHERE rn>1 AND NOT public.fuman_cleanup_run_referenced_v1(run_id,p_protected_run_ids) ORDER BY id LIMIT 5000)s;
 n=cardinality(ids);dn=0;
 IF p_apply AND n>0 THEN DELETE FROM public.fugle_daytrade_quote_snapshots WHERE id::text=ANY(ids);GET DIAGNOSTICS dn=ROW_COUNT; END IF;
 sections=sections||jsonb_build_object('category','exact_duplicate_snapshots','table','fugle_daytrade_quote_snapshots','candidateCount',n,'deletedRows',dn,'keepDays',15);
 RETURN jsonb_build_object('ok',true,'applied',p_apply,'contract','extended-cleanup-db-v1','checkedAt',clock_timestamp(),'sections',sections,'protectedRunIds',cardinality(p_protected_run_ids),'maxCandidatesPerSection',5000);
END $$;
REVOKE ALL ON FUNCTION public.fuman_extended_cleanup_v1(boolean,text[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fuman_extended_cleanup_v1(boolean,text[]) TO service_role;

CREATE OR REPLACE FUNCTION public.fuman_cleanup_space_readback_v1()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT jsonb_build_object('checkedAt',now(),'databaseBytes',pg_database_size(current_database()),'autovacuum',current_setting('autovacuum'),
 'tables',(SELECT jsonb_agg(to_jsonb(s)) FROM (SELECT relname,n_live_tup,n_dead_tup,last_autovacuum,last_autoanalyze,pg_total_relation_size(relid) AS bytes FROM pg_stat_user_tables WHERE schemaname='public' ORDER BY pg_total_relation_size(relid) DESC LIMIT 40)s))
$$;
REVOKE ALL ON FUNCTION public.fuman_cleanup_space_readback_v1() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fuman_cleanup_space_readback_v1() TO service_role;
NOTIFY pgrst,'reload schema';

