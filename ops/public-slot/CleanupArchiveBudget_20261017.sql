-- ISOLATED CANDIDATE. Caller must hold a write-conflicting lock on p_table.
-- EXCEPT ALL preserves multiplicity; array containment alone is insufficient.
CREATE OR REPLACE FUNCTION public.fuman_cleanup_consume_archive_v1(p_archive jsonb,p_table text,p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path TO pg_catalog,public AS $function$
DECLARE remaining jsonb; normalized jsonb; item jsonb;
BEGIN
 IF jsonb_typeof(p_archive) IS DISTINCT FROM 'object' OR jsonb_typeof(p_archive->p_table) IS DISTINCT FROM 'array' OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'cleanup_archive_required:%',p_table; END IF;
 EXECUTE format('SELECT coalesce(jsonb_agg(jsonb_build_object(''raw'',x.value,''normalized'',to_jsonb(r),''ordinal'',x.ordinality)),''[]''::jsonb) FROM jsonb_array_elements($1) WITH ORDINALITY x CROSS JOIN LATERAL jsonb_populate_record(NULL::public.%I,x.value) r',p_table) INTO normalized USING p_archive->p_table;
 FOR item IN SELECT value FROM jsonb_array_elements(normalized) LOOP
  IF (SELECT jsonb_agg(k ORDER BY k) FROM jsonb_object_keys(item->'raw') k) IS DISTINCT FROM (SELECT jsonb_agg(k ORDER BY k) FROM jsonb_object_keys(item->'normalized') k) THEN RAISE EXCEPTION 'cleanup_archive_schema_mismatch:%',p_table; END IF;
 END LOOP;
 IF EXISTS(SELECT value FROM jsonb_array_elements(p_rows) EXCEPT ALL SELECT value->'normalized' FROM jsonb_array_elements(normalized)) THEN RAISE EXCEPTION 'cleanup_unarchived_payload:%',p_table; END IF;
 WITH ranked AS (SELECT value->'raw' raw,value->'normalized' normalized,(value->>'ordinal')::bigint ordinal,row_number() OVER(PARTITION BY value->'normalized' ORDER BY (value->>'ordinal')::bigint) occurrence FROM jsonb_array_elements(normalized)),used AS (SELECT value,count(*) n FROM jsonb_array_elements(p_rows) GROUP BY value)
 SELECT coalesce(jsonb_agg(r.raw ORDER BY r.ordinal),'[]'::jsonb) INTO remaining FROM ranked r LEFT JOIN used u ON u.value=r.normalized WHERE r.occurrence>coalesce(u.n,0);
 RETURN jsonb_set(p_archive,ARRAY[p_table],remaining,false);
END $function$;
REVOKE ALL ON FUNCTION public.fuman_cleanup_consume_archive_v1(jsonb,text,jsonb) FROM PUBLIC;
CREATE OR REPLACE FUNCTION public.fuman_cleanup_archive_used_v1(p_before jsonb,p_after jsonb,p_table text) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path TO pg_catalog,public AS $function$
 SELECT coalesce(jsonb_agg(value),'[]'::jsonb) FROM (SELECT value FROM jsonb_array_elements(p_before->p_table) EXCEPT ALL SELECT value FROM jsonb_array_elements(p_after->p_table)) consumed;
$function$;
REVOKE ALL ON FUNCTION public.fuman_cleanup_archive_used_v1(jsonb,jsonb,text) FROM PUBLIC;

-- Caller holds target lock before checking schema effects. No unreviewed user DELETE trigger is permitted.
CREATE OR REPLACE FUNCTION public.fuman_cleanup_assert_delete_effects_v1(p_table text,p_allowed_children text[]) RETURNS void LANGUAGE plpgsql SET search_path TO pg_catalog,public AS $function$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('public.'||quote_ident(p_table)) AND NOT tgisinternal AND (tgtype::int & 8)<>0) THEN RAISE EXCEPTION 'cleanup_unreviewed_delete_trigger:%',p_table; END IF;
 IF EXISTS(SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE c.contype='f' AND c.confrelid=to_regclass('public.'||quote_ident(p_table)) AND NOT(n.nspname='public' AND r.relname=ANY(p_allowed_children))) THEN RAISE EXCEPTION 'cleanup_unreviewed_dependent_table:%',p_table; END IF;
END $function$;
REVOKE ALL ON FUNCTION public.fuman_cleanup_assert_delete_effects_v1(text,text[]) FROM PUBLIC;
