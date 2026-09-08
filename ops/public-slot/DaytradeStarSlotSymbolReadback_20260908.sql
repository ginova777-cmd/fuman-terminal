-- Canonical per-slot/per-symbol STAR evidence contract.
-- This is independent from the four-slot daily closure receipt: a single
-- DATA_GAP remains isolated while other READY symbols stay evaluable.
begin;

create table if not exists public.fugle_daytrade_star_slot_verification_receipts (
  verification_run_id text primary key,
  contract text not null,
  contract_version text not null,
  trade_date date not null,
  capture_slot text not null check (capture_slot in ('0845','0850','0855','0859')),
  canonical_slot_run_id text not null,
  status text not null check (status in ('complete','partial','failed')),
  complete boolean not null,
  exit_code integer not null,
  source_common_valid boolean not null,
  published_at timestamptz not null,
  verified_at timestamptz not null,
  universe_count integer not null default 0,
  source_valid_count integer not null default 0,
  strategy_evaluated_count integer not null default 0,
  strategy_match_count integer,
  strategy_no_match_count integer,
  data_gap_count integer not null default 0,
  failed_checks text[] not null default '{}',
  first_blocker text,
  source_identity jsonb not null default '{}'::jsonb,
  diagnostic_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.fugle_daytrade_star_slot_symbol_results (
  verification_run_id text not null references public.fugle_daytrade_star_slot_verification_receipts(verification_run_id) on delete cascade,
  contract text not null,
  contract_version text not null,
  trade_date date not null,
  capture_slot text not null check (capture_slot in ('0845','0850','0855','0859')),
  canonical_slot_run_id text not null,
  symbol text not null,
  future_symbol text,
  source_event_at timestamptz,
  received_at timestamptz,
  published_at timestamptz not null,
  verified_at timestamptz not null,
  source_latency_ms bigint,
  verification_latency_ms bigint,
  late_publication boolean not null default false,
  preopen_realtime_usable boolean not null default false,
  run_id text,
  generation_id text,
  natural_schedule_evidence boolean not null default false,
  source_common_valid boolean not null,
  quality_ok boolean not null,
  quality_status text not null check (quality_status in ('READY','DATA_GAP','BLOCKED_COMMON')),
  first_blocker text,
  failed_checks text[] not null default '{}',
  technical_data jsonb not null default '{}'::jsonb,
  strategy_evaluable boolean not null default false,
  strategy_result text not null default 'VIEWER_PENDING' check (strategy_result in ('VIEWER_PENDING','BLOCKED_DATA_GAP','BLOCKED_COMMON')),
  strategy_evaluation_owner text not null default 'viewer_live_rule',
  formal_candidate boolean not null default false,
  formal_entry_allowed boolean not null default false,
  order_allowed boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (verification_run_id, symbol)
);

alter table public.fugle_daytrade_star_slot_verification_receipts
  drop constraint if exists fugle_daytrade_star_slot_verification_receipts_status_check;
alter table public.fugle_daytrade_star_slot_verification_receipts
  add constraint fugle_daytrade_star_slot_verification_receipts_status_check
  check (status in ('complete','partial','failed','pending'));

create index if not exists fugle_daytrade_star_slot_receipt_lookup
  on public.fugle_daytrade_star_slot_verification_receipts(trade_date desc,capture_slot,verified_at desc);
create index if not exists fugle_daytrade_star_slot_symbol_lookup
  on public.fugle_daytrade_star_slot_symbol_results(trade_date desc,capture_slot,symbol,verified_at desc);

-- Raw writer tables stay private.  This view is the minimum evidence surface
-- consumed by the canonical verifier and Viewer bounded-retry reader.
create or replace view public.v_fugle_daytrade_star_slot_evidence_source as
select
  s.trade_date,
  s.capture_slot,
  s.underlying_symbol as symbol,
  s.fut_contract as future_symbol,
  s.captured_at as received_at,
  nullif(s.payload->>'websocket_quote_seen_at','')::timestamptz as future_source_event_at,
  nullif(s.payload->>'trial_event_at','')::timestamptz as trial_event_at,
  coalesce(nullif(s.payload->>'trial_event_at','')::timestamptz,
           nullif(s.payload->>'websocket_quote_seen_at','')::timestamptz) as source_event_at,
  s.captured_at as published_at,
  nullif(s.payload->>'run_id','') as run_id,
  nullif(s.payload->>'generation_id','') as generation_id,
  s.natural_schedule_evidence,
  s.fut_price,
  s.fut_change_pct,
  nullif(s.payload->>'relative_to_txf_percent','')::numeric as relative_to_txf_percent,
  s.fut_volume,
  s.trial_price,
  nullif(s.payload->>'reference_price','')::numeric as reference_price,
  s.best_bid,
  s.best_ask,
  s.bid_ask_ratio,
  s.source,
  h.future_0845_open_price,
  h.future_preopen_high_price,
  h.future_preopen_low_price,
  h.future_preopen_sample_count,
  h.future_preopen_range_start_at,
  h.future_preopen_range_end_at,
  h.future_0845_source_event_at,
  h.future_latest_source_event_at,
  'natural_slot_snapshots_0845_through_current_slot'::text as future_pattern_evidence_mode,
  false as recent_1m_three_sample_supported
from public.fugle_daytrade_preopen_futopt_snapshots s
left join lateral (
  select
    (array_agg(p.fut_price order by p.captured_at asc)
      filter (where p.capture_slot='0845' and p.fut_price>0))[1] as future_0845_open_price,
    max(p.fut_price) filter (where p.fut_price>0) as future_preopen_high_price,
    min(p.fut_price) filter (where p.fut_price>0) as future_preopen_low_price,
    count(*) filter (where p.fut_price>0)::integer as future_preopen_sample_count,
    min(p.captured_at) filter (where p.fut_price>0) as future_preopen_range_start_at,
    max(p.captured_at) filter (where p.fut_price>0) as future_preopen_range_end_at,
    (array_agg(nullif(p.payload->>'websocket_quote_seen_at','')::timestamptz order by p.captured_at asc)
      filter (where p.capture_slot='0845' and p.fut_price>0))[1] as future_0845_source_event_at,
    (array_agg(nullif(p.payload->>'websocket_quote_seen_at','')::timestamptz order by p.captured_at desc)
      filter (where p.fut_price>0))[1] as future_latest_source_event_at
  from public.fugle_daytrade_preopen_futopt_snapshots p
  where p.trade_date=s.trade_date
    and p.underlying_symbol=s.underlying_symbol
    and p.natural_schedule_evidence is true
    and p.capture_slot between '0845' and s.capture_slot
) h on true;

create or replace view public.v_fugle_daytrade_star_slot_verification_readback as
select verification_run_id,contract,contract_version,trade_date,capture_slot,
       canonical_slot_run_id,status,complete,exit_code,source_common_valid,
       published_at,verified_at,universe_count,source_valid_count,
       strategy_evaluated_count,strategy_match_count,strategy_no_match_count,
       data_gap_count,failed_checks,first_blocker,source_identity,diagnostic_summary
from public.fugle_daytrade_star_slot_verification_receipts;

create or replace view public.v_fugle_daytrade_star_slot_symbol_readback as
select verification_run_id,contract,contract_version,trade_date,capture_slot,
       canonical_slot_run_id,symbol,future_symbol,source_event_at,received_at,
       published_at,verified_at,source_latency_ms,verification_latency_ms,
       late_publication,preopen_realtime_usable,run_id,generation_id,natural_schedule_evidence,
       source_common_valid,quality_ok,quality_status,first_blocker,failed_checks,
       technical_data,strategy_evaluable,strategy_result,strategy_evaluation_owner,
       formal_candidate,formal_entry_allowed,order_allowed
from public.fugle_daytrade_star_slot_symbol_results;

-- Keep this migration independently applicable.  These shared guards are
-- intentionally identical to the side-volume schema migration.
create or replace function public.guard_fugle_daytrade_verification_receipt_immutable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'IMMUTABLE_VERIFICATION_RUN_DELETE_FORBIDDEN';
  end if;
  if old.status <> 'pending' then
    raise exception 'IMMUTABLE_VERIFICATION_RUN_ALREADY_FINAL';
  end if;
  if (to_jsonb(new) - array['status','complete','exit_code','first_blocker'])
     is distinct from
     (to_jsonb(old) - array['status','complete','exit_code','first_blocker']) then
    raise exception 'IMMUTABLE_VERIFICATION_RUN_IDENTITY_OR_EVIDENCE_CHANGED';
  end if;
  if new.status = 'pending' then
    raise exception 'IMMUTABLE_VERIFICATION_RUN_PENDING_REWRITE_FORBIDDEN';
  end if;
  return new;
end;
$$;

create or replace function public.guard_fugle_daytrade_verification_symbol_immutable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'IMMUTABLE_VERIFICATION_SYMBOL_RESULT';
end;
$$;

drop trigger if exists trg_star_slot_receipt_immutable on public.fugle_daytrade_star_slot_verification_receipts;
create trigger trg_star_slot_receipt_immutable
before update or delete on public.fugle_daytrade_star_slot_verification_receipts
for each row execute function public.guard_fugle_daytrade_verification_receipt_immutable();

drop trigger if exists trg_star_slot_symbol_immutable on public.fugle_daytrade_star_slot_symbol_results;
create trigger trg_star_slot_symbol_immutable
before update or delete on public.fugle_daytrade_star_slot_symbol_results
for each row execute function public.guard_fugle_daytrade_verification_symbol_immutable();

alter table public.fugle_daytrade_star_slot_verification_receipts enable row level security;
alter table public.fugle_daytrade_star_slot_symbol_results enable row level security;
revoke insert,update,delete on public.fugle_daytrade_star_slot_verification_receipts from anon,authenticated;
revoke insert,update,delete on public.fugle_daytrade_star_slot_symbol_results from anon,authenticated;
grant select,insert,update,delete on public.fugle_daytrade_star_slot_verification_receipts to service_role;
grant select,insert,update,delete on public.fugle_daytrade_star_slot_symbol_results to service_role;
grant select on public.v_fugle_daytrade_star_slot_evidence_source to anon,authenticated,service_role;
grant select on public.v_fugle_daytrade_star_slot_verification_readback to anon,authenticated,service_role;
grant select on public.v_fugle_daytrade_star_slot_symbol_readback to anon,authenticated,service_role;

comment on view public.v_fugle_daytrade_star_slot_verification_readback is 'Canonical slot-level receipt. complete means full slot coverage; partial preserves READY symbols while isolating per-symbol DATA_GAP.';
comment on view public.v_fugle_daytrade_star_slot_symbol_readback is 'Canonical immutable per-symbol slot result v2. Viewer binds verification_run_id and may evaluate only quality_status=READY; technical_data includes natural 08:45 open and the 08:45-through-current-slot high/low range; formal entry remains false.';
notify pgrst,'reload schema';
commit;
