-- Existing receipt evidence only; no market data collection or write permission.
create or replace function public.get_fugle_daytrade_receipt_evidence_chunk(
 p_verification_run_id text, p_part text, p_offset integer default 0, p_length integer default 262144
) returns jsonb language plpgsql stable security invoker
set search_path = public, pg_temp
as $$
declare evidence jsonb; piece jsonb; encoded text; total integer;
begin
 if p_verification_run_id is null or length(p_verification_run_id)>200
    or p_part is null or p_part not in ('symbols','snapshot','snapshot_readback')
    or p_offset is null or p_offset<0 or p_length is null or p_length<1 or p_length>262144 then
  raise exception 'INVALID_EVIDENCE_RANGE' using errcode='22023';
 end if;
 select hash_evidence into evidence from public.v_fugle_daytrade_mother_pool_receipt_v4_1
 where verification_run_id=p_verification_run_id;
 if not found then raise exception 'RECEIPT_NOT_FOUND' using errcode='P0002'; end if;
 piece:=evidence->p_part; encoded:=piece->>'base64';
 if encoded is null then raise exception 'EVIDENCE_NOT_AVAILABLE' using errcode='P0002'; end if;
 total:=length(encoded);
 if p_offset>total then raise exception 'OFFSET_OUT_OF_RANGE' using errcode='22023'; end if;
 return jsonb_build_object('contract','mother-pool-receipt-evidence-chunk-v1',
  'evidence_contract',evidence->>'contract','verification_run_id',p_verification_run_id,
  'part',p_part,'offset',p_offset,'returned_chars',least(p_length,total-p_offset),
  'total_chars',total,'byte_length',piece->'byte_length','encoding',piece->>'encoding',
  'sha256',piece->>'sha256','base64_chunk',substring(encoded from p_offset+1 for p_length),
  'next_offset',case when p_offset+p_length<total then p_offset+p_length else null end);
end $$;
revoke all on function public.get_fugle_daytrade_receipt_evidence_chunk(text,text,integer,integer) from public;
grant execute on function public.get_fugle_daytrade_receipt_evidence_chunk(text,text,integer,integer) to anon, authenticated;
