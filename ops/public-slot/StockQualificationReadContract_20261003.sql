begin;
create or replace function public.fuman_stock_qualification_v1(p_payload jsonb,p_symbol text,p_trade_date date)
returns table(is_common_stock boolean,is_tradable boolean,daytrade_allowed boolean,is_suspended boolean,is_disposition boolean,is_attention boolean,
 qualification_stock_type text,qualification_source_date date,qualification_received_at text,qualification_recorded_at text,qualification_raw_sha256 text)
language sql stable security invoker set search_path=pg_catalog,public
as $fn$
 with raw as (select p_payload->'fugle_qualification' e), checked as (
  select e,e->'raw' r,
   coalesce(e->>'contract'='fugle-stock-qualification-v1'
    and e->>'publication_contract'='stock-qualification-publication-v1'
    and e->>'source'='fugle.intraday.ticker'
    and e->'identity_valid'='true'::jsonb
    and e->>'symbol'=p_symbol and e->'raw'->>'symbol'=p_symbol
    and e->>'trade_date'=p_trade_date::text and e->'raw'->>'date'=p_trade_date::text
    and e->>'raw_json_sha256' ~ '^[0-9a-f]{64}$',false) valid
  from raw
 ), typed as (
  select *,case when valid and r->>'securityType'='01' and r->>'type'='EQUITY' then true
    when valid and r->>'securityType' ~ '^(0[2-9]|[1-3][0-9]|4[0-7])$' then false else null end common
  from checked
 )
 select common,
  case when valid and r->>'securityStatus' in ('NORMAL','SUSPENDED','TERMINATED') then r->>'securityStatus'='NORMAL' end,
  case when valid and jsonb_typeof(r->'canDayTrade')='boolean' then (r->>'canDayTrade')::boolean end,
  case when valid and r->>'securityStatus' in ('NORMAL','SUSPENDED','TERMINATED') then r->>'securityStatus'='SUSPENDED' end,
  case when valid and jsonb_typeof(r->'isDisposition')='boolean' then (r->>'isDisposition')::boolean end,
  case when valid and jsonb_typeof(r->'isAttention')='boolean' then (r->>'isAttention')::boolean end,
  case when common then 'COMMONSTOCK' when common=false then 'NON_COMMON_STOCK' end,
  case when valid then p_trade_date end,
  case when valid then e->>'received_at' end,
  case when valid then e->>'publication_recorded_at' end,
  case when valid then e->>'raw_json_sha256' end
 from typed;
$fn$;
revoke all on function public.fuman_stock_qualification_v1(jsonb,text,date) from public;
grant execute on function public.fuman_stock_qualification_v1(jsonb,text,date) to anon,authenticated,service_role;
-- Existing view projections are appended by the separately guarded patch.
commit;
