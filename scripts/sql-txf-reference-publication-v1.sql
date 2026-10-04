begin;
create table public.fugle_daytrade_txf_reference (
 trade_date date not null, product text not null check(product='TXF'), session text not null check(session='REGULAR'),
 status text not null check(status in ('VERIFIED','WAITING_CATALOGUE','INVALID','CONFLICT')), reason text,
 payload jsonb, revision text not null check(revision ~ '^[a-f0-9]{64}$'), writer_run_id text not null,
 published_at timestamptz not null default clock_timestamp(),
 primary key(trade_date,product,session),
 check(status<>'VERIFIED' or (payload is not null and payload->>'trade_date'=trade_date::text
 and payload->>'future_symbol' ~ '^TXF[A-L][0-9]$' and payload->>'product'='TXF'
 and payload->>'session'='REGULAR' and payload->>'mapping_contract'='fugle-txf-reference-read-v1'
 and payload->>'policy_version'='txf-regular-daily-fixed-v1'))
);
alter table public.fugle_daytrade_txf_reference enable row level security;
revoke all on public.fugle_daytrade_txf_reference from public,anon,authenticated;
grant select,insert,update on public.fugle_daytrade_txf_reference to service_role;
create function public.guard_txf_reference_v1() returns trigger language plpgsql set search_path=pg_catalog as $$
begin
 if TG_OP='UPDATE' then
  if OLD.status='CONFLICT' then return OLD;end if;
  if (OLD.status='VERIFIED' and NEW.status='VERIFIED' and
   ((OLD.payload->>'future_symbol') is distinct from (NEW.payload->>'future_symbol') or
    (OLD.payload->>'expiry_date') is distinct from (NEW.payload->>'expiry_date') or
    (OLD.payload->>'catalogue_source_hash') is distinct from (NEW.payload->>'catalogue_source_hash'))) then
   NEW.status:='CONFLICT';NEW.reason:='SAME_DAY_REFERENCE_CONFLICT';
   NEW.payload:=jsonb_build_object('previous',OLD.payload,'incoming',NEW.payload);
  end if;
 end if;
 if NEW.status='VERIFIED' then
  if (NEW.payload->>'verified_at')::timestamptz>clock_timestamp()
   or (NEW.payload->>'valid_from')::timestamptz>(NEW.payload->>'verified_at')::timestamptz
   or (NEW.payload->>'valid_until')::timestamptz<=(NEW.payload->>'valid_from')::timestamptz
  then raise exception 'TXF_REFERENCE_TIME_INVALID';end if;
 end if;
 NEW.published_at:=clock_timestamp();return NEW;
end; $$;
revoke all on function public.guard_txf_reference_v1() from public,anon,authenticated;
create trigger guard_txf_reference_v1 before insert or update on public.fugle_daytrade_txf_reference for each row execute function public.guard_txf_reference_v1();
create function public.get_fugle_daytrade_txf_reference(p_trade_date date,p_session text default 'REGULAR')
returns jsonb language plpgsql stable security definer set search_path=pg_catalog set statement_timeout='5s' as $$
declare cal record; r record; verdict text; usable boolean:=false; stamp timestamptz:=now();
begin
 if p_trade_date is null or p_session is distinct from 'REGULAR' then raise exception 'TXF_REFERENCE_ARGUMENT_INVALID';end if;
 select * into cal from public.market_calendar where market='TW' and trade_date=p_trade_date;
 if not found or cal.is_open is null or cal.payload->>'calendar_contract' is distinct from 'market-calendar-contract-v1' then verdict:='CALENDAR_UNVERIFIED';
 elsif cal.updated_at>stamp or cal.updated_at<stamp-interval '7 days' then verdict:='CALENDAR_STALE';
 elsif cal.is_open=false then verdict:='MARKET_CLOSED';
 else verdict:='WAITING_CATALOGUE';end if;
 select * into r from public.fugle_daytrade_txf_reference where trade_date=p_trade_date and product='TXF' and session=p_session;
 if verdict='WAITING_CATALOGUE' and found then
  verdict:=r.status;
  if verdict='VERIFIED' then
   if p_trade_date<>(stamp at time zone 'Asia/Taipei')::date then verdict:='STALE_TRADE_DATE';
   elsif stamp<(r.payload->>'valid_from')::timestamptz then verdict:='NOT_YET_VALID';
   elsif stamp>=(r.payload->>'valid_until')::timestamptz then verdict:='EXPIRED';
   else usable:=true;end if;
  end if;
 end if;
 return jsonb_build_object('contract','fugle-txf-reference-read-v1','trade_date',p_trade_date,'product','TXF','session',p_session,
  'status',verdict,'mapping_usable',usable,'checked_at',stamp,'mapping_count',case when usable then 1 else 0 end,
  'future_symbol',case when usable then r.payload->>'future_symbol' else null end,
  'mapping',case when r.status='VERIFIED' then r.payload else null end,
  'data_gap_reason',case when usable then null else coalesce(r.reason,verdict) end,
  'published_at',r.published_at,'writer_run_id',r.writer_run_id,
  'calendar',jsonb_build_object('market','TW','is_open',cal.is_open,'contract',cal.payload->>'calendar_contract','updated_at',cal.updated_at),
  'quote_readiness','NOT_EVALUATED','candles_readiness','NOT_EVALUATED');
end; $$;
revoke all on function public.get_fugle_daytrade_txf_reference(date,text) from public;
grant execute on function public.get_fugle_daytrade_txf_reference(date,text) to anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;

