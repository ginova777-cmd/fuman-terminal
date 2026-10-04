-- Draft migration. Apply only through the release-owner migration path.
-- Dedicated futures bars prevent TXF contracts entering stock-only 1m consumers.
begin;
create table public.fugle_daytrade_futopt_intraday_1m (
 trade_date date not null,
 session text not null check (session in ('REGULAR','AFTERHOURS')),
 future_symbol text not null check (future_symbol ~ '^TXF[A-L][0-9]$'),
 timeframe integer not null check (timeframe=1),
 candle_time timestamptz not null,
 open numeric not null check (open>0 and open<'Infinity'::numeric),
 high numeric not null check (high>0 and high<'Infinity'::numeric),
 low numeric not null check (low>0 and low<'Infinity'::numeric),
 close numeric not null check (close>0 and close<'Infinity'::numeric),
 volume bigint not null check (volume>=0),
 source text not null check (source in ('Fugle:WS:candles','Fugle:REST:intraday/candles')),
 is_synthetic boolean not null check (is_synthetic=false),
 received_at timestamptz not null,
 available_at timestamptz not null,
 first_available_at timestamptz not null,
 closed_at_receipt boolean not null,
 raw_sha256 text not null check (raw_sha256 ~ '^[a-f0-9]{64}$'),
 raw_evidence jsonb not null check (jsonb_typeof(raw_evidence)='object'),
 conflict boolean not null,
 volume_strategy_usable boolean not null,
 data_gap_reason text,
 archive_run_id text not null,
 writer_run_id text not null,
 first_published_at timestamptz not null default clock_timestamp(),
 published_at timestamptz not null default clock_timestamp(),
 primary key(trade_date,session,future_symbol,candle_time),
 check (low<=least(open,close) and high>=greatest(open,close) and low<=high),
 check (date_trunc('minute',candle_time)=candle_time),
 check (candle_time<=received_at and first_available_at<=available_at and available_at=received_at),
 check (volume_strategy_usable=not conflict),
 check (not conflict or data_gap_reason is not null),
 check (session<>'REGULAR' or (trade_date=(candle_time at time zone 'Asia/Taipei')::date
   and (candle_time at time zone 'Asia/Taipei')::time>='08:45'::time
   and (candle_time at time zone 'Asia/Taipei')::time<'13:45'::time))
);
alter table public.fugle_daytrade_futopt_intraday_1m enable row level security;
revoke all on public.fugle_daytrade_futopt_intraday_1m from public,anon,authenticated;
grant select,insert,update on public.fugle_daytrade_futopt_intraday_1m to service_role;
create function public.stamp_futopt_candle_publication_v1() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
 if NEW.received_at>clock_timestamp() then raise exception 'TXF_FUTURE_RECEIPT'; end if;
 if TG_OP='UPDATE' then
  if NEW.received_at<OLD.received_at then return null; end if;
  NEW.first_published_at:=OLD.first_published_at;
 else NEW.first_published_at:=clock_timestamp(); end if;
 NEW.published_at:=clock_timestamp();
 return NEW;
end; $$;
revoke all on function public.stamp_futopt_candle_publication_v1() from public,anon,authenticated;
create trigger stamp_futopt_candle_publication_v1 before insert or update
on public.fugle_daytrade_futopt_intraday_1m for each row execute function public.stamp_futopt_candle_publication_v1();
create function public.get_fugle_daytrade_futopt_intraday_1m(
 p_trade_date date,p_future_symbol text,p_session text default 'REGULAR',p_limit integer default 300,p_before timestamptz default null
) returns setof public.fugle_daytrade_futopt_intraday_1m
language plpgsql stable security definer set search_path=pg_catalog set statement_timeout='5s' as $$
begin
 if p_trade_date is null or p_future_symbol is null or p_future_symbol !~ '^TXF[A-L][0-9]$'
  or p_session is null or p_session not in ('REGULAR','AFTERHOURS') or p_limit is null or p_limit<1 or p_limit>800
 then raise exception 'TXF_READ_BOUND_INVALID'; end if;
 return query select t.* from public.fugle_daytrade_futopt_intraday_1m t
 where t.trade_date=p_trade_date and t.future_symbol=p_future_symbol and t.session=p_session
  and (p_before is null or t.candle_time<p_before)
 order by t.candle_time desc limit p_limit;
end; $$;
revoke all on function public.get_fugle_daytrade_futopt_intraday_1m(date,text,text,integer,timestamptz) from public;
grant execute on function public.get_fugle_daytrade_futopt_intraday_1m(date,text,text,integer,timestamptz) to anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
