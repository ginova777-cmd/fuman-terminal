begin;
create table if not exists public.fugle_daytrade_gate_transition_receipts(
  id bigint generated always as identity primary key,
  trade_date date not null,
  canonical_run_id text not null,
  writer_run_id text,
  observed_at timestamptz not null,
  previous_source_status text,
  source_status text not null,
  previous_gate_grade text,
  gate_grade text,
  previous_gate_status text,
  gate_status text,
  previous_formal_entry_allowed boolean,
  formal_entry_allowed boolean not null,
  first_blocker text,
  source_updated_at timestamptz not null,
  transition_payload jsonb not null default '{}'::jsonb
);
create index if not exists fugle_daytrade_gate_transition_latest
  on public.fugle_daytrade_gate_transition_receipts(trade_date desc,observed_at desc);
create unique index if not exists fugle_daytrade_gate_transition_dedupe
  on public.fugle_daytrade_gate_transition_receipts(canonical_run_id,observed_at);
create or replace view public.v_fugle_daytrade_gate_transition_readback as
select trade_date,canonical_run_id,writer_run_id,observed_at,previous_source_status,source_status,
       previous_gate_grade,gate_grade,previous_gate_status,gate_status,
       previous_formal_entry_allowed,formal_entry_allowed,first_blocker,source_updated_at,transition_payload
from public.fugle_daytrade_gate_transition_receipts;
grant select on public.v_fugle_daytrade_gate_transition_readback to anon,authenticated,service_role;
revoke insert,update,delete on public.fugle_daytrade_gate_transition_receipts from anon,authenticated;
grant select,insert on public.fugle_daytrade_gate_transition_receipts to service_role;
comment on view public.v_fugle_daytrade_gate_transition_readback is
  'Append-only same-day source/canonical/unattended gate transition evidence. It does not grant formal-entry authority.';
notify pgrst,'reload schema';
commit;
