-- Dedicated daytrade source: one writer host, all other machines read-only.
begin;

create table if not exists public.fugle_daytrade_source_writer_lease (
  source_name text primary key,
  writer_host_id text not null,
  writer_instance_id text not null,
  source_role text not null default 'writer',
  heartbeat_at timestamptz not null default now(),
  lease_expires_at timestamptz not null,
  trade_date date not null default (now() at time zone 'Asia/Taipei')::date,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists idx_fugle_daytrade_source_writer_lease_expiry
  on public.fugle_daytrade_source_writer_lease(lease_expires_at);

create or replace function public.claim_fugle_daytrade_source_writer_lease(
  p_source_name text,
  p_writer_host_id text,
  p_writer_instance_id text,
  p_lease_seconds integer default 240
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  claimed_row public.fugle_daytrade_source_writer_lease;
  claimed boolean := false;
  seconds integer := greatest(60, least(coalesce(p_lease_seconds, 240), 600));
begin
  if nullif(trim(p_source_name), '') is null
     or nullif(trim(p_writer_host_id), '') is null
     or nullif(trim(p_writer_instance_id), '') is null then
    return jsonb_build_object('ok', false, 'claimed', false, 'reason_code', 'writer_identity_missing');
  end if;

  insert into public.fugle_daytrade_source_writer_lease (
    source_name, writer_host_id, writer_instance_id, source_role,
    heartbeat_at, lease_expires_at, trade_date, payload, updated_at
  ) values (
    trim(p_source_name), trim(p_writer_host_id), trim(p_writer_instance_id), 'writer',
    now(), now() + make_interval(secs => seconds),
    (now() at time zone 'Asia/Taipei')::date,
    jsonb_build_object('lease', 'dedicated_daytrade_source_writer'), now()
  )
  on conflict (source_name) do update
    set writer_host_id = excluded.writer_host_id,
        writer_instance_id = excluded.writer_instance_id,
        source_role = excluded.source_role,
        heartbeat_at = excluded.heartbeat_at,
        lease_expires_at = excluded.lease_expires_at,
        trade_date = excluded.trade_date,
        payload = excluded.payload,
        updated_at = excluded.updated_at
    where public.fugle_daytrade_source_writer_lease.lease_expires_at <= now()
       or (public.fugle_daytrade_source_writer_lease.writer_host_id = excluded.writer_host_id
           and public.fugle_daytrade_source_writer_lease.writer_instance_id = excluded.writer_instance_id)
  returning * into claimed_row;

  claimed := found;
  if claimed then
    return jsonb_build_object('ok', true, 'claimed', true,
      'source_name', claimed_row.source_name,
      'writer_host_id', claimed_row.writer_host_id,
      'writer_instance_id', claimed_row.writer_instance_id,
      'heartbeat_at', claimed_row.heartbeat_at,
      'lease_expires_at', claimed_row.lease_expires_at,
      'trade_date', claimed_row.trade_date);
  end if;

  select * into claimed_row from public.fugle_daytrade_source_writer_lease
   where source_name = trim(p_source_name);
  return jsonb_build_object('ok', false, 'claimed', false,
    'reason_code', 'writer_lease_held',
    'current_writer_host_id', claimed_row.writer_host_id,
    'current_writer_instance_id', claimed_row.writer_instance_id,
    'heartbeat_at', claimed_row.heartbeat_at,
    'lease_expires_at', claimed_row.lease_expires_at,
    'trade_date', claimed_row.trade_date);
end;
$$;

revoke all on function public.claim_fugle_daytrade_source_writer_lease(text, text, text, integer) from public;
grant execute on function public.claim_fugle_daytrade_source_writer_lease(text, text, text, integer) to service_role;

do $$
begin
  if to_regclass('public.v_fugle_daytrade_source_writer_lease') is null then
    execute $view$
      create view public.v_fugle_daytrade_source_writer_lease as
      select source_name, writer_host_id, writer_instance_id, source_role,
             heartbeat_at, lease_expires_at, trade_date,
             greatest(0, floor(extract(epoch from (lease_expires_at - now())))::integer) as lease_remaining_seconds,
             updated_at,
             jsonb_build_object('source_host_id', writer_host_id,
               'source_host_role', source_role,
               'writer_instance_id', writer_instance_id,
               'writer_heartbeat_at', heartbeat_at,
               'writer_lease_expires_at', lease_expires_at) as payload
        from public.fugle_daytrade_source_writer_lease;
    $view$;
  end if;
end;
$$;

grant select on public.v_fugle_daytrade_source_writer_lease to anon, authenticated, service_role;
commit;
