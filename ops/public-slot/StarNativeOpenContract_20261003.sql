begin;
create or replace function public.fuman_star_native_open_v1(e jsonb, expected_symbol text, expected_date date, captured timestamptz)
returns table(price numeric,event_at text)
language plpgsql stable security invoker set search_path=pg_catalog,public
as $fn$
declare raw jsonb; native_time timestamptz;
begin
 price:=null;event_at:=null;raw:=e->'raw_evidence';
 if e->>'contract' is distinct from 'fugle-futopt-native-open-v1'
  or e->>'status' is distinct from 'CONFIRMED'
  or e->>'future_symbol' is distinct from expected_symbol
  or e->>'trade_date' is distinct from expected_date::text
  or raw->>'symbol' is distinct from expected_symbol
  or raw->>'date' is distinct from expected_date::text
  or raw->>'type' is distinct from 'FUTURE'
  or raw->>'exchange' is distinct from 'TAIFEX'
  or jsonb_typeof(raw->'openPrice') is distinct from 'number'
  or jsonb_typeof(raw->'openTime') is distinct from 'number'
  or raw->'isSynthetic'='true'::jsonb or raw->'is_synthetic'='true'::jsonb
  or captured is null then return next;return;end if;
 if (raw->>'openPrice')::numeric<=0 or (raw->>'openTime')::numeric<=0
  or trunc((raw->>'openTime')::numeric)<>(raw->>'openTime')::numeric then return next;return;end if;
 native_time:=to_timestamp((raw->>'openTime')::numeric/1000000);
 -- STAR1's named 08:45 field requires a real opening event in that minute.
 -- Later native openings remain available in the producer evidence, not relabelled.
 if (native_time at time zone 'Asia/Taipei')::date<>expected_date
  or to_char(native_time at time zone 'Asia/Taipei','HH24:MI')<>'08:45'
  or native_time>captured then return next;return;end if;
 price:=(raw->>'openPrice')::numeric;
 event_at:=to_char(native_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
 return next;
exception when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range then
 price:=null;event_at:=null;return next;
end;
$fn$;
revoke all on function public.fuman_star_native_open_v1(jsonb,text,date,timestamptz) from public;
grant execute on function public.fuman_star_native_open_v1(jsonb,text,date,timestamptz) to anon,authenticated,service_role;
commit;
