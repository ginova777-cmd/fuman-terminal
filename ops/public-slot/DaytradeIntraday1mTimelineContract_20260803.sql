-- Daytrade 1m source contract: websocket-first, REST repair, synthetic isolation.
-- Release owner applies this file in Supabase SQL Editor.
begin;

alter table if exists public.fugle_daytrade_intraday_1m
  add column if not exists source_channel text,
  add column if not exists candle_origin text not null default 'unknown',
  add column if not exists volume_strategy_usable boolean not null default true,
  add column if not exists websocket_row boolean not null default false,
  add column if not exists rest_repair_row boolean not null default false,
  add column if not exists intraday_odd_lot boolean not null default false;

update public.fugle_daytrade_intraday_1m
set source_channel = coalesce(source_channel, case
  when source ilike '%websocket_candles%' then 'candles'
  when source ilike '%rest%' then 'rest'
  when source ilike '%quote_derived%' then 'aggregates'
  else 'unknown'
end),
candle_origin = case
  when coalesce(synthetic, false) then 'synthetic_flat'
  when source ilike '%quote_derived%' then 'quote_derived_disallowed'
  when source ilike '%rest%' then 'rest_candle'
  when source ilike '%websocket_candles%' then 'websocket_candle'
  else candle_origin
end,
volume_strategy_usable = case when source ilike '%quote_derived%' then false else coalesce(volume_strategy_usable, true) end,
websocket_row = (source ilike '%websocket_candles%'),
rest_repair_row = (source ilike '%rest%'),
intraday_odd_lot = false;

create or replace function public.protect_fugle_daytrade_intraday_1m_real_candle()
returns trigger language plpgsql as $$
begin
  if coalesce(old.synthetic, false) is false
     and coalesce(new.synthetic, false) is true then
    return old;
  end if;
  if coalesce(old.synthetic, false) is false
     and coalesce(old.volume_strategy_usable, true) is true
     and coalesce(new.volume_strategy_usable, true) is false then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_fugle_daytrade_intraday_1m_real on public.fugle_daytrade_intraday_1m;
create trigger trg_protect_fugle_daytrade_intraday_1m_real
before update on public.fugle_daytrade_intraday_1m
for each row execute function public.protect_fugle_daytrade_intraday_1m_real_candle();
create index if not exists idx_fugle_daytrade_intraday_1m_usable
  on public.fugle_daytrade_intraday_1m(trade_date, symbol, candle_time)
  where volume_strategy_usable is true;

create table if not exists public.fugle_daytrade_intraday_1m_timeline_audit (
  symbol text not null,
  trade_date date not null,
  expected_minutes integer not null default 0,
  real_candles integer not null default 0,
  synthetic_candles integer not null default 0,
  missing_minutes text[] not null default '{}'::text[],
  latest_candle_time timestamp with time zone,
  repair_count integer not null default 0,
  websocket_rows integer not null default 0,
  rest_rows integer not null default 0,
  replay_allowed boolean not null default false,
  checked_at timestamp with time zone not null default now(),
  payload jsonb not null default '{}'::jsonb,
  primary key (symbol, trade_date)
);

create index if not exists idx_daytrade_intraday_1m_timeline_audit_date
  on public.fugle_daytrade_intraday_1m_timeline_audit(trade_date, replay_allowed, symbol);

create or replace view public.v_fugle_daytrade_intraday_1m_timeline_audit as
select symbol, trade_date, expected_minutes, real_candles, synthetic_candles,
       missing_minutes, latest_candle_time, repair_count, websocket_rows, rest_rows,
       replay_allowed, checked_at, payload
from public.fugle_daytrade_intraday_1m_timeline_audit;

create or replace view public.v_fugle_daytrade_intraday_1m_volume_usable as
select symbol, market, candle_time, trade_date, open, high, low, close, volume,
       source, source_channel, candle_origin, updated_at, payload
from public.fugle_daytrade_intraday_1m
where coalesce(volume_strategy_usable, true) is true
  and coalesce(synthetic, false) is false;

create table if not exists public.fugle_daytrade_intraday_writer_lease (
  lease_name text primary key,
  owner_id text not null,
  acquired_at timestamp with time zone not null default now(),
  lease_until timestamp with time zone not null,
  updated_at timestamp with time zone not null default now(),
  payload jsonb not null default '{}'::jsonb
);

create or replace function public.acquire_fugle_daytrade_intraday_writer_lease(
  p_owner_id text, p_lease_seconds integer default 120
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_now timestamptz := now(); v_until timestamptz := v_now + make_interval(secs => greatest(30, least(900, p_lease_seconds)));
begin
  insert into public.fugle_daytrade_intraday_writer_lease(lease_name, owner_id, acquired_at, lease_until, updated_at)
  values ('daytrade-intraday-1m', p_owner_id, v_now, v_until, v_now)
  on conflict (lease_name) do update
  set owner_id = excluded.owner_id, lease_until = excluded.lease_until, updated_at = v_now
  where public.fugle_daytrade_intraday_writer_lease.lease_until < v_now
     or public.fugle_daytrade_intraday_writer_lease.owner_id = p_owner_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'writer_lease_held', 'lease_name', 'daytrade-intraday-1m');
  end if;
  return jsonb_build_object('ok', true, 'lease_name', 'daytrade-intraday-1m', 'owner_id', p_owner_id, 'lease_until', v_until);
end;
$$;

create or replace function public.release_fugle_daytrade_intraday_writer_lease(p_owner_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  delete from public.fugle_daytrade_intraday_writer_lease
   where lease_name = 'daytrade-intraday-1m' and owner_id = p_owner_id;
  return jsonb_build_object('ok', true, 'released', found);
end;
$$;

grant select on public.fugle_daytrade_intraday_1m_timeline_audit to anon, authenticated;
grant select on public.v_fugle_daytrade_intraday_1m_timeline_audit to anon, authenticated;
grant select on public.v_fugle_daytrade_intraday_1m_volume_usable to anon, authenticated;
grant execute on function public.acquire_fugle_daytrade_intraday_writer_lease(text, integer) to service_role;
grant execute on function public.release_fugle_daytrade_intraday_writer_lease(text) to service_role;

commit;
