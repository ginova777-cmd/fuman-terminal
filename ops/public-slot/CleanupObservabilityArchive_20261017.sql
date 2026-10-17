-- ISOLATED CANDIDATE ONLY; original cutoff and batches retained, archive multiset enforced under table lock.
CREATE OR REPLACE FUNCTION public.fuman_cleanup_source_observability_15d_once(p_apply boolean, p_batch_size integer, p_max_batches_per_table integer, p_archive jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO pg_catalog,public
 SET statement_timeout TO '45s'
 SET lock_timeout TO '2s'
AS $function$
declare
  v_keep_from_date date := current_date - 15; v_batch_size integer := greatest(1,least(coalesce(p_batch_size,5000),5000)); v_max_batches integer := greatest(1,least(coalesce(p_max_batches_per_table,10),20));
  v_table text; v_loop integer; v_batch_deleted integer; v_deleted integer; v_total integer := 0; v_rows jsonb := '[]'::jsonb; v_locked boolean := false; v_archive_before jsonb; v_tids tid[]; v_planned jsonb; v_archived_deleted jsonb := '{}'::jsonb;
begin
  if p_apply and jsonb_typeof(p_archive) is distinct from 'object' then raise exception 'cleanup_archive_required'; end if;
  if p_apply and (now() at time zone 'Asia/Taipei')::time < time '16:15' then return jsonb_build_object('ok',false,'reasonCode','source_observability_retention_before_window','allowedAction','wait_until_1615_taipei'); end if;
  v_locked := pg_try_advisory_xact_lock(2026081425);
  if not v_locked then return jsonb_build_object('ok',false,'reasonCode','source_observability_retention_lock_contended','allowedAction','wait_then_retry_once'); end if;
  foreach v_table in array array['fugle_daytrade_source_scorecard','fugle_daytrade_source_speed_scorecard','fugle_daytrade_gate_scorecard','fugle_source_coverage'] loop
    v_deleted := 0; v_archived_deleted := jsonb_set(v_archived_deleted,ARRAY[v_table],'[]'::jsonb,true);
    if p_apply then execute format('LOCK TABLE public.%I IN SHARE ROW EXCLUSIVE MODE',v_table);perform public.fuman_cleanup_assert_delete_effects_v1(v_table,ARRAY[]::text[]);end if;
    if p_apply then for v_loop in 1..v_max_batches loop
      execute format('select coalesce(array_agg(ctid),ARRAY[]::tid[]) from (select ctid from public.%I where trade_date<$1 order by trade_date,ctid limit $2) doomed',v_table) into v_tids using v_keep_from_date,v_batch_size;
      execute format('select coalesce(jsonb_agg(to_jsonb(t)),''[]''::jsonb) from public.%I t where ctid=ANY($1)',v_table) into v_planned using v_tids;
      v_archive_before:=p_archive;p_archive:=public.fuman_cleanup_consume_archive_v1(p_archive,v_table,v_planned);
      v_archived_deleted:=jsonb_set(v_archived_deleted,ARRAY[v_table],(v_archived_deleted->v_table)||public.fuman_cleanup_archive_used_v1(v_archive_before,p_archive,v_table),false);
      execute format('delete from public.%I where ctid=ANY($1)',v_table) using v_tids;get diagnostics v_batch_deleted=ROW_COUNT;
      v_deleted := v_deleted + v_batch_deleted; exit when v_batch_deleted < v_batch_size;
    end loop; end if;
    v_total := v_total + v_deleted;
    insert into public.fuman_retention_cleanup_log(table_name,keep_from_date,deleted_rows,mode,note,keep_policy,audit_payload) values(v_table,v_keep_from_date,v_deleted,case when p_apply then 'apply' else 'dry_run' end,'source observability retention; formal readers use newest records','keep 15 calendar days',jsonb_build_object('contract','source-observability-retention-15d-v1','batchSize',v_batch_size,'maxBatches',v_max_batches));
    v_rows := v_rows || jsonb_build_array(jsonb_build_object('table',v_table,'deletedRows',v_deleted));
  end loop;
  return jsonb_build_object('ok',true,'contract','source-observability-retention-15d-v1','archiveBudgetContract','cleanup-archive-multiset-v1','archivedDeleted',v_archived_deleted,'applied',p_apply,'keepDays',15,'keepFromDate',v_keep_from_date,'deletedRows',v_total,'tables',v_rows,'checkedAt',now());
end;
$function$
;
CREATE OR REPLACE FUNCTION public.fuman_cleanup_source_observability_15d_once(p_apply boolean DEFAULT false,p_batch_size integer DEFAULT 5000,p_max_batches_per_table integer DEFAULT 10) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $function$ BEGIN IF p_apply THEN RAISE EXCEPTION 'cleanup_archive_required'; END IF; RETURN public.fuman_cleanup_source_observability_15d_once(false,p_batch_size,p_max_batches_per_table,NULL::jsonb); END $function$;
REVOKE ALL ON FUNCTION public.fuman_cleanup_source_observability_15d_once(boolean,integer,integer,jsonb) FROM PUBLIC;
DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN EXECUTE 'GRANT EXECUTE ON FUNCTION public.fuman_cleanup_source_observability_15d_once(boolean,integer,integer,jsonb) TO service_role'; END IF; END $grant$;
