-- Immutable catalogue publications; anon receives bounded pages through this RPC only.
begin;
create table if not exists public.fugle_daytrade_stock_future_candidates (
  trade_date date not null,
  catalogue_run_id text not null,
  revision text not null check (revision ~ '^[a-f0-9]{64}$'),
  writer_run_id text not null,
  published_at timestamptz not null default clock_timestamp(),
  payload jsonb not null,
  primary key (trade_date,catalogue_run_id,revision),
  check (payload ?& array['contract','trade_date','catalogue_run_id','candidates']),
  check(payload->>'contract'='stock-future-candidates-v1'),
  check(payload->>'trade_date'=trade_date::text),
  check(payload->>'catalogue_run_id'=catalogue_run_id),
  check(jsonb_typeof(payload->'candidates')='array'),
  check(jsonb_array_length(payload->'candidates')<=5000)
);
alter table public.fugle_daytrade_stock_future_candidates enable row level security;
revoke all on public.fugle_daytrade_stock_future_candidates from public,anon,authenticated;
grant select,insert on public.fugle_daytrade_stock_future_candidates to service_role;
create or replace function public.get_fugle_daytrade_stock_future_candidates(
 p_trade_date date,p_catalogue_run_id text,p_revision text,p_offset integer default 0,p_limit integer default 200
) returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,public set statement_timeout='5s' as $$
declare r public.fugle_daytrade_stock_future_candidates%rowtype; page jsonb; n integer;
begin
 if p_trade_date is null or coalesce(length(p_catalogue_run_id),0)=0 or p_revision is null or p_revision !~ '^[a-f0-9]{64}$' or p_offset is null or p_offset<0 or p_offset>5000 or p_limit is null or p_limit<1 or p_limit>200 then raise exception 'CANDIDATE_REQUEST_INVALID' using errcode='22023'; end if;
 select * into r from public.fugle_daytrade_stock_future_candidates where trade_date=p_trade_date and catalogue_run_id=p_catalogue_run_id and revision=p_revision;
 if not found then return jsonb_build_object('contract','stock-future-candidates-read-v1','status','NOT_PUBLISHED','trade_date',p_trade_date,'catalogue_run_id',p_catalogue_run_id,'revision',p_revision,'rows','[]'::jsonb,'total_count',null); end if;
 n=jsonb_array_length(r.payload->'candidates');
 select coalesce(jsonb_agg(value order by ord),'[]'::jsonb) into page from jsonb_array_elements(r.payload->'candidates') with ordinality as t(value,ord) where ord>p_offset and ord<=p_offset+p_limit;
 return jsonb_build_object('contract','stock-future-candidates-read-v1','status','PUBLISHED','trade_date',r.trade_date,'catalogue_run_id',r.catalogue_run_id,'revision',r.revision,'writer_run_id',r.writer_run_id,'published_at',r.published_at,'policy',r.payload->'policy','generated_at',r.payload->'generated_at','counts',r.payload->'counts','total_count',n,'offset',p_offset,'returned_count',jsonb_array_length(page),'next_offset',case when p_offset+p_limit<n then p_offset+p_limit else null end,'rows',page);
end $$;
revoke all on function public.get_fugle_daytrade_stock_future_candidates(date,text,text,integer,integer) from public;
grant execute on function public.get_fugle_daytrade_stock_future_candidates(date,text,text,integer,integer) to anon,authenticated,service_role;
create or replace view public.v_fugle_daytrade_stock_future_candidate_publications as
select trade_date,catalogue_run_id,revision,writer_run_id,published_at,payload->>'policy' as policy,payload->'counts' as counts
from public.fugle_daytrade_stock_future_candidates;
grant select on public.v_fugle_daytrade_stock_future_candidate_publications to anon,authenticated;
create or replace function public.publish_fugle_daytrade_stock_future_candidates(p_payload jsonb,p_revision text,p_writer_run_id text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public set statement_timeout='5s' as $$
declare r public.fugle_daytrade_stock_future_candidates%rowtype;
begin
 if p_payload is null or p_revision is null or p_revision !~ '^[a-f0-9]{64}$' or coalesce(length(p_writer_run_id),0)=0 or octet_length(p_payload::text)>8388608 then raise exception 'CANDIDATE_PUBLICATION_INVALID'; end if;
 insert into public.fugle_daytrade_stock_future_candidates(trade_date,catalogue_run_id,revision,writer_run_id,payload)
 values((p_payload->>'trade_date')::date,p_payload->>'catalogue_run_id',p_revision,p_writer_run_id,p_payload)
 on conflict do nothing;
 select * into r from public.fugle_daytrade_stock_future_candidates where trade_date=(p_payload->>'trade_date')::date and catalogue_run_id=p_payload->>'catalogue_run_id' and revision=p_revision;
 if r.payload<>p_payload then raise exception 'CANDIDATE_REVISION_CONFLICT'; end if;
 return jsonb_build_object('status','PUBLISHED','revision',r.revision,'catalogue_run_id',r.catalogue_run_id,'total_count',jsonb_array_length(r.payload->'candidates'),'published_at',r.published_at);
end $$;
revoke all on function public.publish_fugle_daytrade_stock_future_candidates(jsonb,text,text) from public,anon,authenticated;
grant execute on function public.publish_fugle_daytrade_stock_future_candidates(jsonb,text,text) to service_role;
commit;
