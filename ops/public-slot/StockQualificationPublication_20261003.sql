-- Service Writer updates only its qualification evidence key. No quote writes.
begin;
create or replace function public.publish_fugle_stock_qualification_v1(p_rows jsonb)
returns table(symbol text,trade_date text,raw_json_sha256 text)
language plpgsql security invoker set search_path=pg_catalog,public
as $fn$
declare item jsonb; evidence jsonb; affected integer;
begin
 if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'QUALIFICATION_ROWS_TYPE'; end if;
 if jsonb_array_length(p_rows)>50 or octet_length(p_rows::text)>262144 then raise exception 'QUALIFICATION_BATCH_BOUND'; end if;
 if (select count(*) from jsonb_array_elements(p_rows))<>(select count(distinct x->>'symbol') from jsonb_array_elements(p_rows) x) then raise exception 'QUALIFICATION_DUPLICATE_SYMBOL'; end if;
 for item in select value from jsonb_array_elements(p_rows) loop
  evidence:=item->'evidence';
  if jsonb_typeof(evidence) is distinct from 'object'
   or coalesce(item->>'symbol','') !~ '^\d{4}$'
   or (item->>'symbol') is distinct from (evidence->>'symbol')
   or (evidence->>'contract') is distinct from 'fugle-stock-qualification-v1'
   or (evidence->>'source') is distinct from 'fugle.intraday.ticker'
   or (evidence->'identity_valid') is distinct from 'true'::jsonb
   or (evidence->'raw'->>'symbol') is distinct from (item->>'symbol')
   or (evidence->'raw'->>'date') is distinct from (evidence->>'trade_date')
   or coalesce(evidence->>'trade_date','') !~ '^\d{4}-\d{2}-\d{2}$'
   or coalesce(evidence->>'raw_json_sha256','') !~ '^[0-9a-f]{64}$'
   or coalesce(evidence->>'received_at','') !~ '(Z|[+-]\d{2}:\d{2})$'
   then raise exception 'QUALIFICATION_INVALID_EVIDENCE'; end if;
  if to_char((evidence->>'trade_date')::date,'YYYY-MM-DD')<>evidence->>'trade_date'
   or (evidence->>'received_at')::timestamptz>clock_timestamp() then raise exception 'QUALIFICATION_INVALID_TIME'; end if;
  update public.stock_tickers s
   set payload=jsonb_set(coalesce(s.payload,'{}'::jsonb),'{fugle_qualification}',
     evidence||jsonb_build_object('publication_recorded_at',clock_timestamp(),'commit_visibility_verified',false,'publication_contract','stock-qualification-publication-v1'),true)
   where s.symbol=item->>'symbol'
    and ((s.payload->'fugle_qualification'->>'trade_date') is null
      or s.payload->'fugle_qualification'->>'trade_date'<evidence->>'trade_date'
      or (s.payload->'fugle_qualification'->>'trade_date'=evidence->>'trade_date'
       and coalesce(s.payload->'fugle_qualification'->>'received_at','')<=evidence->>'received_at'));
  get diagnostics affected=row_count;
  if affected<>1 then raise exception 'QUALIFICATION_MASTER_MISSING_OR_NEWER'; end if;
  symbol:=item->>'symbol';trade_date:=evidence->>'trade_date';raw_json_sha256:=evidence->>'raw_json_sha256';return next;
 end loop;
end;
$fn$;
revoke all on function public.publish_fugle_stock_qualification_v1(jsonb) from public,anon,authenticated;
grant execute on function public.publish_fugle_stock_qualification_v1(jsonb) to service_role;
commit;
