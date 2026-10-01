-- Stateless wire deduplication; exact original plan and v2 checks remain intact.
BEGIN;
SET LOCAL lock_timeout='2s';
CREATE OR REPLACE FUNCTION public.persist_daytrade_module_round_shared_v1(p_metadata text,p_dictionary text[],p_pieces jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE plan_text text; piece jsonb; kind text; idx integer; item text; parts text[]:=ARRAY[]::text[]; bytes bigint:=0;
BEGIN
 IF p_metadata IS NULL OR p_dictionary IS NULL OR p_pieces IS NULL
  OR cardinality(p_dictionary)>10000 OR jsonb_typeof(p_pieces)<>'array'
  OR jsonb_array_length(p_pieces)>100000 THEN RAISE EXCEPTION 'INVALID_SHARED_WIRE'; END IF;
 FOR piece IN SELECT value FROM jsonb_array_elements(p_pieces) LOOP
  kind:=jsonb_typeof(piece);
  IF kind='string' THEN item:=piece#>>'{}';
  ELSIF kind='number' AND (piece#>>'{}') ~ '^[0-9]{1,5}$' THEN
   idx:=(piece#>>'{}')::integer;
   IF idx>=cardinality(p_dictionary) THEN RAISE EXCEPTION 'INVALID_SHARED_REFERENCE'; END IF;
   item:=p_dictionary[idx+1];
  ELSE RAISE EXCEPTION 'INVALID_SHARED_PIECE'; END IF;
  IF item IS NULL THEN RAISE EXCEPTION 'NULL_SHARED_PIECE'; END IF;
  bytes:=bytes+octet_length(item);
  IF bytes>33554432 THEN RAISE EXCEPTION 'SHARED_PLAN_SIZE_LIMIT'; END IF;
  parts:=array_append(parts,item);
 END LOOP;
 plan_text:=array_to_string(parts,'');
 RETURN public.persist_daytrade_module_round_compact_v1(p_metadata,plan_text);
END $$;
REVOKE ALL ON FUNCTION public.persist_daytrade_module_round_shared_v1(text,text[],jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.persist_daytrade_module_round_shared_v1(text,text[],jsonb) TO service_role;
COMMIT;
