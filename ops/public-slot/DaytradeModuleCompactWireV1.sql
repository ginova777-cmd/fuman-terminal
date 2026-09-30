-- Additive transport optimization. Keep v2 immutable persistence and readback.
BEGIN;
CREATE OR REPLACE FUNCTION public.persist_daytrade_module_round_compact_v1(p_metadata text,p_plan text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE d jsonb:=p_metadata::jsonb; p jsonb:=p_plan::jsonb;
BEGIN
 IF jsonb_typeof(d) IS DISTINCT FROM 'object' OR d ? 'plan' THEN
  RAISE EXCEPTION 'INVALID_COMPACT_MODULE_METADATA';
 END IF;
 RETURN public.persist_daytrade_module_round_v2((d||jsonb_build_object('plan',p))::text,p_plan);
END $$;
REVOKE ALL ON FUNCTION public.persist_daytrade_module_round_compact_v1(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.persist_daytrade_module_round_compact_v1(text,text) TO service_role;
COMMIT;
