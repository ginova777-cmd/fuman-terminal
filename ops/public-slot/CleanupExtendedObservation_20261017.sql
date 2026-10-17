-- ISOLATED CANDIDATE ONLY. Preserves original predicates; adds bounded pre-delete candidate evidence.
CREATE OR REPLACE FUNCTION public.fuman_extended_cleanup_v1(p_apply boolean, p_protected_run_ids text[], p_archive jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '45s'
 SET lock_timeout TO '2s'
AS $function$
DECLARE prefix text; rt text; dt text; ids text[]; tids tid[]; n bigint; dn bigint; dr bigint; sections jsonb='[]'; before_hash text; after_hash text; latest text; latest_rows_hash text; after_rows_hash text; keep_n int; cutoff timestamptz=now()-interval '15 days'; query_sql text; planned jsonb; children jsonb; archive_before jsonb; archive_planned jsonb; archive_children jsonb;
BEGIN
 IF p_apply AND jsonb_typeof(p_archive) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'cleanup_archive_required'; END IF;
 IF p_apply AND (now() AT TIME ZONE 'Asia/Taipei')::time < time '16:15' THEN RAISE EXCEPTION 'extended_cleanup_before_1615'; END IF;
 IF NOT pg_try_advisory_xact_lock(hashtext('fuman_extended_cleanup_v1')) THEN RAISE EXCEPTION 'extended_cleanup_already_running'; END IF;
 IF coalesce(cardinality(p_protected_run_ids),0)>100000 THEN RAISE EXCEPTION 'protected_ids_bound'; END IF;
 FOREACH prefix IN ARRAY ARRAY['strategy1_open_buy','strategy2_scan','strategy3_v2_scan','strategy4_scan','strategy5_scan','institution_scan','cb_detect_scan','warrant_flow_scan'] LOOP
  rt=prefix||'_runs';dt=prefix||'_results';keep_n=CASE WHEN prefix='strategy2_scan' THEN 60 ELSE 20 END;
  IF EXISTS(SELECT 1 FROM pg_constraint WHERE contype='f' AND (confrelid=to_regclass('public.'||dt) OR (confrelid=to_regclass('public.'||rt) AND conrelid<>to_regclass('public.'||dt)))) THEN RAISE EXCEPTION 'new_dependent_table_requires_cleanup_contract:%',rt; END IF;
  IF p_apply THEN EXECUTE format('LOCK TABLE public.%I,public.%I IN SHARE ROW EXCLUSIVE MODE',rt,dt); PERFORM public.fuman_cleanup_assert_delete_effects_v1(rt,ARRAY[dt]); PERFORM public.fuman_cleanup_assert_delete_effects_v1(dt,ARRAY[]::text[]); END IF;
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
  EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(r)),''[]''::jsonb) FROM public.%I r WHERE run_id=ANY($1)',rt) INTO planned USING ids;
  EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(r)),''[]''::jsonb) FROM public.%I r WHERE run_id=ANY($1)',dt) INTO children USING ids;
  IF pg_column_size(planned)+pg_column_size(children)>16777216 THEN RAISE EXCEPTION 'cleanup_observation_bound'; END IF;
  archive_planned='[]'::jsonb;archive_children='[]'::jsonb;
  IF p_apply THEN archive_before=p_archive;p_archive=public.fuman_cleanup_consume_archive_v1(p_archive,rt,planned);archive_planned=public.fuman_cleanup_archive_used_v1(archive_before,p_archive,rt);archive_before=p_archive;p_archive=public.fuman_cleanup_consume_archive_v1(p_archive,dt,children);archive_children=public.fuman_cleanup_archive_used_v1(archive_before,p_archive,dt); END IF;
  IF p_apply AND n>0 THEN
   EXECUTE format('DELETE FROM public.%I WHERE run_id=ANY($1)',dt) USING ids;GET DIAGNOSTICS dn=ROW_COUNT;
   EXECUTE format('DELETE FROM public.%I WHERE run_id=ANY($1)',rt) USING ids;GET DIAGNOSTICS dr=ROW_COUNT;
  END IF;
  sections=sections||jsonb_build_object('category','failed_runs','table',rt,'candidateCount',n,'deletedRows',dn,'deletedRuns',dr,'keepDays',15,'protectedRecentRuns',keep_n,'candidateRows',planned,'resultTable',dt,'candidateResults',children,'archivedRows',archive_planned,'archivedResults',archive_children);
  query_sql=format($q$WITH eligible AS MATERIALIZED (
   SELECT r.ctid,r.run_id FROM public.%I r WHERE r.run_id IS NOT NULL AND r.run_id<>''
   AND coalesce(to_jsonb(r)->>'updated_at',to_jsonb(r)->>'created_at',to_jsonb(r)->>'scan_time',to_jsonb(r)->>'scan_date',to_jsonb(r)->>'trade_date')::timestamptz < now()-interval '45 days'
   AND NOT EXISTS(SELECT 1 FROM public.%I s WHERE s.run_id=r.run_id)
   ) SELECT coalesce(array_agg(ctid),ARRAY[]::tid[]) FROM (SELECT ctid FROM eligible r WHERE NOT public.fuman_cleanup_run_referenced_v1(r.run_id,$1) ORDER BY r.ctid LIMIT 5000)s$q$,dt,rt);
  EXECUTE query_sql INTO tids USING p_protected_run_ids;n=cardinality(tids);dn=0;
  EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(r)),''[]''::jsonb) FROM public.%I r WHERE ctid=ANY($1)',dt) INTO planned USING tids;
  IF pg_column_size(planned)>16777216 THEN RAISE EXCEPTION 'cleanup_observation_bound'; END IF;
  archive_planned='[]'::jsonb;IF p_apply THEN archive_before=p_archive;p_archive=public.fuman_cleanup_consume_archive_v1(p_archive,dt,planned);archive_planned=public.fuman_cleanup_archive_used_v1(archive_before,p_archive,dt); END IF;
  IF p_apply AND n>0 THEN EXECUTE format('DELETE FROM public.%I WHERE ctid=ANY($1)',dt) USING tids;GET DIAGNOSTICS dn=ROW_COUNT; END IF;
  EXECUTE format('SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.run_id)::text,''[]'')) FROM public.%I r WHERE r.run_id=$1',rt) INTO after_hash USING latest;
  EXECUTE format('SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text)::text,''[]'')) FROM public.%I r WHERE r.run_id=$1',dt) INTO after_rows_hash USING latest;
  IF before_hash IS DISTINCT FROM after_hash OR latest_rows_hash IS DISTINCT FROM after_rows_hash THEN RAISE EXCEPTION 'latest_complete_changed:%',rt; END IF;
  sections=sections||jsonb_build_object('category','orphan_results','table',dt,'candidateCount',n,'deletedRows',dn,'keepDays',45,'latestCompleteRunId',latest,'protectedHashBefore',latest_rows_hash,'protectedHashAfter',after_rows_hash,'candidateRows',planned,'archivedRows',archive_planned);
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_constraint WHERE contype='f' AND confrelid='public.fugle_daytrade_quote_snapshots'::regclass) THEN RAISE EXCEPTION 'quote_snapshot_dependencies_require_cleanup_contract'; END IF;
 IF p_apply THEN LOCK TABLE public.fugle_daytrade_quote_snapshots IN SHARE ROW EXCLUSIVE MODE; PERFORM public.fuman_cleanup_assert_delete_effects_v1('fugle_daytrade_quote_snapshots',ARRAY[]::text[]); END IF;
 -- Equality includes source, run, symbol, all timestamps and payload; similar quotes are NOT duplicates.
 SELECT coalesce(array_agg(id),ARRAY[]::text[]) INTO ids FROM (
  SELECT id::text FROM (SELECT id,run_id,row_number() OVER (PARTITION BY to_jsonb(q)-'id' ORDER BY id) AS rn
   FROM public.fugle_daytrade_quote_snapshots q WHERE snapshot_at<cutoff) d
  WHERE rn>1 AND NOT public.fuman_cleanup_run_referenced_v1(run_id,p_protected_run_ids) ORDER BY id LIMIT 5000)s;
 n=cardinality(ids);dn=0;
 SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) INTO planned FROM public.fugle_daytrade_quote_snapshots q WHERE id::text=ANY(ids);
 IF pg_column_size(planned)>16777216 THEN RAISE EXCEPTION 'cleanup_observation_bound'; END IF;
 archive_planned='[]'::jsonb;IF p_apply THEN archive_before=p_archive;p_archive=public.fuman_cleanup_consume_archive_v1(p_archive,'fugle_daytrade_quote_snapshots',planned);archive_planned=public.fuman_cleanup_archive_used_v1(archive_before,p_archive,'fugle_daytrade_quote_snapshots'); END IF;
 IF p_apply AND n>0 THEN DELETE FROM public.fugle_daytrade_quote_snapshots WHERE id::text=ANY(ids);GET DIAGNOSTICS dn=ROW_COUNT; END IF;
 sections=sections||jsonb_build_object('category','exact_duplicate_snapshots','table','fugle_daytrade_quote_snapshots','candidateCount',n,'deletedRows',dn,'keepDays',15,'candidateRows',planned,'archivedRows',archive_planned);
 IF pg_column_size(sections)>16777216 THEN RAISE EXCEPTION 'cleanup_observation_total_bound'; END IF;
 RETURN jsonb_build_object('ok',true,'applied',p_apply,'contract','extended-cleanup-db-v1','observationContract','extended-cleanup-candidates-v1','archiveBudgetContract','cleanup-archive-multiset-v1','checkedAt',clock_timestamp(),'sections',sections,'protectedRunIds',cardinality(p_protected_run_ids),'maxCandidatesPerSection',5000);
END $function$
;
-- Preserve legacy preview entry; legacy apply is fail-closed without a sealed payload.
CREATE OR REPLACE FUNCTION public.fuman_extended_cleanup_v1(p_apply boolean DEFAULT false,p_protected_run_ids text[] DEFAULT ARRAY[]::text[]) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $function$ BEGIN IF p_apply THEN RAISE EXCEPTION 'cleanup_archive_required'; END IF; RETURN public.fuman_extended_cleanup_v1(false,p_protected_run_ids,NULL::jsonb); END $function$;
REVOKE ALL ON FUNCTION public.fuman_extended_cleanup_v1(boolean,text[],jsonb) FROM PUBLIC;
DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN EXECUTE 'GRANT EXECUTE ON FUNCTION public.fuman_extended_cleanup_v1(boolean,text[],jsonb) TO service_role'; END IF; END $grant$;
