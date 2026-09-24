-- Dedicated immutable module evidence. Does not reinterpret legacy rolling60 rows.
BEGIN;
CREATE TABLE IF NOT EXISTS public.fugle_daytrade_module_round_v2 (
  module_id text NOT NULL,
  trade_date date NOT NULL,
  writer_run_id text NOT NULL,
  document jsonb NOT NULL,
  committed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (module_id, trade_date, writer_run_id)
);
CREATE TABLE IF NOT EXISTS public.fugle_daytrade_module_rows_v2 (
  module_id text NOT NULL,
  trade_date date NOT NULL,
  writer_run_id text NOT NULL,
  symbol text NOT NULL,
  evidence jsonb NOT NULL,
  PRIMARY KEY (module_id, trade_date, writer_run_id, symbol),
  FOREIGN KEY (module_id, trade_date, writer_run_id)
    REFERENCES public.fugle_daytrade_module_round_v2
);
ALTER TABLE public.fugle_daytrade_module_round_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fugle_daytrade_module_rows_v2 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fugle_daytrade_module_round_v2, public.fugle_daytrade_module_rows_v2 FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.persist_daytrade_module_round_v2(p_document text, p_plan text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE d jsonb := p_document::jsonb; p jsonb := p_plan::jsonb;
  old_doc jsonb; committed timestamptz; written jsonb; field text;
BEGIN
  IF d->>'contract' IS DISTINCT FROM 'mother_pool_module_write_set_v1'
     OR d->'plan' IS DISTINCT FROM p
     OR d->>'plan_hash' IS DISTINCT FROM encode(sha256(convert_to(p_plan,'UTF8')),'hex')
     OR d->>'module_id' IS NULL OR d->>'module_id' !~ '^(A(0[1-9]|1[0-9])|B(0[1-9]|1[0-9]|2[0-4]))$'
     OR (d->>'snapshot_sequence')::bigint < 1 THEN RAISE EXCEPTION 'INVALID_MODULE_PLAN'; END IF;
  FOREACH field IN ARRAY ARRAY['trade_date','canonical_run_id','writer_run_id','generation_id','mother_pool_run_id','snapshot_generation','snapshot_sequence','module_contract'] LOOP
    IF nullif(d->>field,'') IS NULL THEN RAISE EXCEPTION 'MISSING_IDENTITY:%',field; END IF;
  END LOOP;
  IF jsonb_typeof(p->'rows') IS DISTINCT FROM 'array' OR jsonb_typeof(p->'requested_symbols') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p->'requested_symbols') = 0 THEN RAISE EXCEPTION 'EMPTY_OR_INVALID_PLAN'; END IF;
  IF (SELECT count(*) <> count(DISTINCT value) FROM jsonb_array_elements_text(p->'requested_symbols'))
    OR (SELECT count(*) <> count(DISTINCT value->>'symbol') FROM jsonb_array_elements(p->'rows'))
    OR (SELECT jsonb_agg(value ORDER BY value) FROM jsonb_array_elements_text(p->'requested_symbols')) IS DISTINCT FROM
       (SELECT jsonb_agg(value->>'symbol' ORDER BY value->>'symbol') FROM jsonb_array_elements(p->'rows'))
  THEN RAISE EXCEPTION 'PRODUCER_SET_MISMATCH'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p->'rows') r WHERE
     r->>'status' NOT IN ('READY','DATA_GAP') OR r->>'status' IS NULL
     OR r->'is_synthetic' IS DISTINCT FROM 'false'::jsonb
     OR r->'replay' IS DISTINCT FROM 'false'::jsonb
     OR r->'look_ahead' IS DISTINCT FROM 'false'::jsonb
     OR nullif(r->>'source','') IS NULL OR nullif(r->>'source_contract','') IS NULL
     OR nullif(r->>'source_updated_at','') IS NULL
     OR (r->>'status'='DATA_GAP' AND nullif(r->>'data_gap_reason','') IS NULL))
  THEN RAISE EXCEPTION 'INVALID_SOURCE_EVIDENCE'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended((d->>'module_id')||':'||(d->>'trade_date')||':'||(d->>'writer_run_id'),0));
  SELECT document, committed_at INTO old_doc, committed FROM public.fugle_daytrade_module_round_v2
    WHERE module_id=d->>'module_id' AND trade_date=(d->>'trade_date')::date AND writer_run_id=d->>'writer_run_id';
  IF FOUND THEN
    IF old_doc IS DISTINCT FROM d THEN RAISE EXCEPTION 'IMMUTABLE_MODULE_ROUND_CONFLICT'; END IF;
    SELECT jsonb_agg(symbol ORDER BY symbol) INTO written FROM public.fugle_daytrade_module_rows_v2
      WHERE module_id=d->>'module_id' AND trade_date=(d->>'trade_date')::date AND writer_run_id=d->>'writer_run_id';
  ELSE
    INSERT INTO public.fugle_daytrade_module_round_v2(module_id,trade_date,writer_run_id,document)
      VALUES(d->>'module_id',(d->>'trade_date')::date,d->>'writer_run_id',d) RETURNING committed_at INTO committed;
    WITH inserted AS (
      INSERT INTO public.fugle_daytrade_module_rows_v2(module_id,trade_date,writer_run_id,symbol,evidence)
        SELECT d->>'module_id',(d->>'trade_date')::date,d->>'writer_run_id',r->>'symbol',r FROM jsonb_array_elements(p->'rows') r
        RETURNING symbol
    ) SELECT jsonb_agg(symbol ORDER BY symbol) INTO written FROM inserted;
  END IF;
  RETURN (d - 'plan' - 'contract' - 'module_contract') || jsonb_build_object('committed',true,'committed_at',committed,'written_symbols',written);
END $$;
REVOKE ALL ON FUNCTION public.persist_daytrade_module_round_v2(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.persist_daytrade_module_round_v2(text,text) TO service_role;

CREATE OR REPLACE VIEW public.v_daytrade_module_readback_v2 AS
 SELECT r.module_id,r.trade_date,r.writer_run_id,r.symbol,
   d.document->>'module_contract' AS contract,
   d.document->>'canonical_run_id' AS canonical_run_id,
   d.document->>'generation_id' AS generation_id,
   d.document->>'mother_pool_run_id' AS mother_pool_run_id,
   d.document->>'snapshot_generation' AS snapshot_generation,
   (d.document->>'snapshot_sequence')::bigint AS snapshot_sequence,
   r.evidence, d.document->'plan'->'special_evidence' AS special_evidence
 FROM public.fugle_daytrade_module_rows_v2 r
 JOIN public.fugle_daytrade_module_round_v2 d USING(module_id,trade_date,writer_run_id);
GRANT SELECT ON public.v_daytrade_module_readback_v2 TO anon,authenticated,service_role;
COMMIT;
