-- Atomic minute-side persistence. Source content and accepted round receipts are immutable.
BEGIN;
CREATE OR REPLACE FUNCTION public.reject_minute_side_mutation_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='fugle_daytrade_minute_side_source_v1' THEN
  IF (to_jsonb(NEW)-ARRAY['writer_run_id','generation_id','mother_pool_run_id','snapshot_generation','snapshot_sequence','created_at','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['writer_run_id','generation_id','mother_pool_run_id','snapshot_generation','snapshot_sequence','created_at','updated_at']) THEN RAISE EXCEPTION 'MINUTE_SIDE_SOURCE_CONFLICT'; END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['updated_at','created_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['updated_at','created_at']) THEN RAISE EXCEPTION 'MINUTE_SIDE_ROUND_CONFLICT'; END IF;
 END IF;
 RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS minute_side_immutable ON public.fugle_daytrade_minute_side_source_v1;
CREATE TRIGGER minute_side_immutable BEFORE UPDATE ON public.fugle_daytrade_minute_side_source_v1 FOR EACH ROW EXECUTE FUNCTION public.reject_minute_side_mutation_v1();
DROP TRIGGER IF EXISTS minute_side_immutable ON public.fugle_daytrade_minute_side_round_v1;
CREATE TRIGGER minute_side_immutable BEFORE UPDATE ON public.fugle_daytrade_minute_side_round_v1 FOR EACH ROW EXECUTE FUNCTION public.reject_minute_side_mutation_v1();
CREATE OR REPLACE FUNCTION public.persist_minute_side_round_v1(p_plan jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE j jsonb; v_written jsonb:='[]'; rounds jsonb:='[]'; k text; ack text;
BEGIN
 IF p_plan->>'contract' IS DISTINCT FROM 'minute_side_write_plan_v1' OR jsonb_typeof(p_plan->'requested_symbols') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'INVALID_WRITE_PLAN'; END IF;
 IF jsonb_typeof(p_plan->'source_rows') IS DISTINCT FROM 'array' OR jsonb_typeof(p_plan->'round_rows') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'INVALID_PLAN_ROWS'; END IF;
 FOR j IN SELECT value FROM jsonb_array_elements(p_plan->'source_rows') LOOP
  FOREACH k IN ARRAY ARRAY['trade_date','canonical_run_id','writer_run_id','generation_id','mother_pool_run_id','snapshot_generation','snapshot_sequence'] LOOP
   IF j->k IS DISTINCT FROM p_plan->k THEN RAISE EXCEPTION 'SOURCE_IDENTITY_MISMATCH:%',k; END IF;
  END LOOP;
  IF NOT (p_plan->'requested_symbols' ? (j->>'symbol')) OR j->>'volume_unit' IS DISTINCT FROM 'LOTS' OR j->>'aggregation' IS DISTINCT FROM 'ONE_MINUTE' OR j->'is_synthetic' IS DISTINCT FROM 'false'::jsonb THEN RAISE EXCEPTION 'SOURCE_CONTRACT_INVALID'; END IF;
  INSERT INTO public.fugle_daytrade_minute_side_source_v1 (trade_date,canonical_run_id,symbol,minute_start,source_contract,source_version,inside_1m,outside_1m,unknown_1m,total_1m,volume_unit,aggregation,side_volume_timestamp,source,start_boundary_identity,end_boundary_identity,is_synthetic,source_hash,baseline_method,baseline_sample_count,baseline_value,outside_baseline_value,inside_baseline_value,raw_outside_ratio,outside_strength,raw_inside_ratio,inside_strength,dynamic_ratio,outside_dynamic_ratio,inside_dynamic_ratio,side_state,outside_baseline_sample_count,inside_baseline_sample_count,outside_side_state,inside_side_state,writer_run_id,generation_id,mother_pool_run_id,snapshot_generation,snapshot_sequence) SELECT trade_date,canonical_run_id,symbol,minute_start,source_contract,source_version,inside_1m,outside_1m,unknown_1m,total_1m,volume_unit,aggregation,side_volume_timestamp,source,start_boundary_identity,end_boundary_identity,is_synthetic,source_hash,baseline_method,baseline_sample_count,baseline_value,outside_baseline_value,inside_baseline_value,raw_outside_ratio,outside_strength,raw_inside_ratio,inside_strength,dynamic_ratio,outside_dynamic_ratio,inside_dynamic_ratio,side_state,outside_baseline_sample_count,inside_baseline_sample_count,outside_side_state,inside_side_state,writer_run_id,generation_id,mother_pool_run_id,snapshot_generation,snapshot_sequence FROM jsonb_populate_record(NULL::public.fugle_daytrade_minute_side_source_v1,j)
  ON CONFLICT (trade_date,canonical_run_id,symbol,minute_start,source_contract,source_version) DO UPDATE SET trade_date=EXCLUDED.trade_date,canonical_run_id=EXCLUDED.canonical_run_id,symbol=EXCLUDED.symbol,minute_start=EXCLUDED.minute_start,source_contract=EXCLUDED.source_contract,source_version=EXCLUDED.source_version,inside_1m=EXCLUDED.inside_1m,outside_1m=EXCLUDED.outside_1m,unknown_1m=EXCLUDED.unknown_1m,total_1m=EXCLUDED.total_1m,volume_unit=EXCLUDED.volume_unit,aggregation=EXCLUDED.aggregation,side_volume_timestamp=EXCLUDED.side_volume_timestamp,source=EXCLUDED.source,start_boundary_identity=EXCLUDED.start_boundary_identity,end_boundary_identity=EXCLUDED.end_boundary_identity,is_synthetic=EXCLUDED.is_synthetic,source_hash=EXCLUDED.source_hash,baseline_method=EXCLUDED.baseline_method,baseline_sample_count=EXCLUDED.baseline_sample_count,baseline_value=EXCLUDED.baseline_value,outside_baseline_value=EXCLUDED.outside_baseline_value,inside_baseline_value=EXCLUDED.inside_baseline_value,raw_outside_ratio=EXCLUDED.raw_outside_ratio,outside_strength=EXCLUDED.outside_strength,raw_inside_ratio=EXCLUDED.raw_inside_ratio,inside_strength=EXCLUDED.inside_strength,dynamic_ratio=EXCLUDED.dynamic_ratio,outside_dynamic_ratio=EXCLUDED.outside_dynamic_ratio,inside_dynamic_ratio=EXCLUDED.inside_dynamic_ratio,side_state=EXCLUDED.side_state,outside_baseline_sample_count=EXCLUDED.outside_baseline_sample_count,inside_baseline_sample_count=EXCLUDED.inside_baseline_sample_count,outside_side_state=EXCLUDED.outside_side_state,inside_side_state=EXCLUDED.inside_side_state,writer_run_id=EXCLUDED.writer_run_id,generation_id=EXCLUDED.generation_id,mother_pool_run_id=EXCLUDED.mother_pool_run_id,snapshot_generation=EXCLUDED.snapshot_generation,snapshot_sequence=EXCLUDED.snapshot_sequence RETURNING symbol INTO ack;
  v_written:=v_written||jsonb_build_array(ack);
 END LOOP;
 FOR j IN SELECT value FROM jsonb_array_elements(p_plan->'round_rows') LOOP
  FOREACH k IN ARRAY ARRAY['trade_date','canonical_run_id','writer_run_id','generation_id','mother_pool_run_id','snapshot_generation','snapshot_sequence'] LOOP
   IF j->k IS DISTINCT FROM p_plan->k OR j->k IS NULL OR j->k='null'::jsonb THEN RAISE EXCEPTION 'ROUND_IDENTITY_MISMATCH:%',k; END IF;
  END LOOP;
  IF v_written ? (j->>'symbol') THEN
   IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_plan->'source_rows') s WHERE s->>'symbol'=j->>'symbol' AND s->>'source_hash'=j->>'source_hash' AND (s->>'minute_start')::timestamptz=(j->>'minute_start')::timestamptz) THEN RAISE EXCEPTION 'ROUND_SOURCE_REFERENCE_MISMATCH'; END IF;
  ELSIF j->>'first_blocker' IS NULL THEN RAISE EXCEPTION 'UNEXPLAINED_MISSING_SOURCE'; END IF;
  j:=j||jsonb_build_object('written',v_written ? (j->>'symbol'));
  INSERT INTO public.fugle_daytrade_minute_side_round_v1 (writer_run_id,trade_date,canonical_run_id,generation_id,mother_pool_run_id,snapshot_generation,snapshot_sequence,symbol,requested,written,readback,source_rows,data_gap_count,first_blocker,minute_start,source_hash) SELECT writer_run_id,trade_date,canonical_run_id,generation_id,mother_pool_run_id,snapshot_generation,snapshot_sequence,symbol,requested,written,readback,source_rows,data_gap_count,first_blocker,minute_start,source_hash FROM jsonb_populate_record(NULL::public.fugle_daytrade_minute_side_round_v1,j)
  ON CONFLICT (writer_run_id,symbol) DO UPDATE SET writer_run_id=EXCLUDED.writer_run_id,trade_date=EXCLUDED.trade_date,canonical_run_id=EXCLUDED.canonical_run_id,generation_id=EXCLUDED.generation_id,mother_pool_run_id=EXCLUDED.mother_pool_run_id,snapshot_generation=EXCLUDED.snapshot_generation,snapshot_sequence=EXCLUDED.snapshot_sequence,symbol=EXCLUDED.symbol,requested=EXCLUDED.requested,written=EXCLUDED.written,readback=EXCLUDED.readback,source_rows=EXCLUDED.source_rows,data_gap_count=EXCLUDED.data_gap_count,first_blocker=EXCLUDED.first_blocker,minute_start=EXCLUDED.minute_start,source_hash=EXCLUDED.source_hash RETURNING symbol INTO ack;
  rounds:=rounds||jsonb_build_array(ack);
 END LOOP;
 IF (SELECT array_agg(value ORDER BY value) FROM jsonb_array_elements_text(rounds)) IS DISTINCT FROM (SELECT array_agg(value ORDER BY value) FROM jsonb_array_elements_text(p_plan->'requested_symbols')) THEN RAISE EXCEPTION 'REQUESTED_ROUND_SET_MISMATCH'; END IF;
 RETURN jsonb_build_object('written_symbols',v_written,'round_symbols',rounds);
END $$;
REVOKE ALL ON FUNCTION public.persist_minute_side_round_v1(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.persist_minute_side_round_v1(jsonb) TO service_role;
drop view if exists public.v_daytrade_minute_side_b20_readback_v1;
drop view if exists public.v_daytrade_minute_side_readback_v1;

create view public.v_daytrade_minute_side_readback_v1 as
select 'B14'::text as module_id, r.symbol, r.trade_date, r.canonical_run_id,
 r.mother_pool_run_id, r.snapshot_generation, r.snapshot_sequence,
 s.minute_start as event_time, s.inside_1m, s.outside_1m, s.unknown_1m, s.total_1m,
 s.volume_unit, s.aggregation, s.side_volume_timestamp, s.source,
 s.start_boundary_identity, s.end_boundary_identity, s.is_synthetic, s.source_hash,
 s.baseline_method, s.outside_baseline_sample_count as baseline_sample_count,
 r.writer_run_id, r.generation_id, r.requested, r.written, r.readback,
 r.source_rows, r.data_gap_count, r.first_blocker,
 'daytrade_minute_side_source_v1'::text as contract,
 s.outside_baseline_value as baseline_value, s.raw_outside_ratio,
 s.outside_strength, s.outside_dynamic_ratio as dynamic_ratio,
 s.outside_side_state as side_state,
 s.raw_inside_ratio, s.inside_strength
from public.fugle_daytrade_minute_side_round_v1 r
left join public.fugle_daytrade_minute_side_source_v1 s
 on r.trade_date=s.trade_date and r.canonical_run_id=s.canonical_run_id
 and r.symbol=s.symbol
 and s.source_contract='mother_pool_native_minute_side_source_v1' and s.source_version='1'
 and r.minute_start=s.minute_start
 and r.source_hash=s.source_hash;

create view public.v_daytrade_minute_side_b20_readback_v1 as
select 'B20'::text as module_id, r.symbol, r.trade_date, r.canonical_run_id,
 r.mother_pool_run_id, r.snapshot_generation, r.snapshot_sequence,
 s.minute_start as event_time, s.inside_1m, s.outside_1m, s.unknown_1m, s.total_1m,
 s.volume_unit, s.aggregation, s.side_volume_timestamp, s.source,
 s.start_boundary_identity, s.end_boundary_identity, s.is_synthetic, s.source_hash,
 s.baseline_method, s.inside_baseline_sample_count as baseline_sample_count,
 r.writer_run_id, r.generation_id, r.requested, r.written, r.readback,
 r.source_rows, r.data_gap_count, r.first_blocker,
 'daytrade_minute_side_source_v1'::text as contract,
 s.inside_baseline_value as baseline_value, s.raw_inside_ratio,
 s.inside_strength, s.inside_dynamic_ratio as dynamic_ratio,
 s.inside_side_state as side_state,
 s.raw_outside_ratio, s.outside_strength
from public.fugle_daytrade_minute_side_round_v1 r
left join public.fugle_daytrade_minute_side_source_v1 s
 on r.trade_date=s.trade_date and r.canonical_run_id=s.canonical_run_id
 and r.symbol=s.symbol
 and s.source_contract='mother_pool_native_minute_side_source_v1' and s.source_version='1'
 and r.minute_start=s.minute_start
 and r.source_hash=s.source_hash;

grant select on public.v_daytrade_minute_side_readback_v1,
 public.v_daytrade_minute_side_b20_readback_v1 to anon, authenticated, service_role;

COMMIT;
