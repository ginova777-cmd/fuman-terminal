-- Hard gate for seven_strategy_daily_history.
-- Apply once in the Supabase SQL Editor on the production project.
-- Bad historical rows are intentionally not deleted by this migration.

begin;

create or replace function public.enforce_seven_strategy_formal_history_evidence()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ev jsonb := coalesce(new.evidence, '{}'::jsonb);
  source_status text := lower(coalesce(ev ->> 'source_status', ev ->> 'sourceStatus', ''));
  gate_grade text := upper(coalesce(ev ->> 'gate_grade', ev ->> 'gateGrade', ev ->> 'canonical_gate_grade', ev ->> 'canonicalGateGrade', ''));
  gate_status text := lower(coalesce(ev ->> 'gate_status', ev ->> 'gateStatus', ev ->> 'canonical_gate_status', ev ->> 'canonicalGateStatus', ''));
  formal_verdict text := upper(coalesce(ev ->> 'formal_entry_speed_verdict', ev ->> 'formalEntrySpeedVerdict', ''));
  formal_allowed text := lower(coalesce(ev ->> 'formal_entry_allowed', ev ->> 'formalEntryAllowed', ''));
begin
  if lower(coalesce(new.signal_type, '')) not in ('detected', 'formal') then
    return new;
  end if;

  if source_status not in ('ok', 'ready') then
    raise exception 'seven_strategy_history_formal_evidence_rejected:source_status=%', source_status;
  end if;
  if gate_grade <> 'A' then
    raise exception 'seven_strategy_history_formal_evidence_rejected:gate_grade=%', gate_grade;
  end if;
  if gate_status <> 'ready' then
    raise exception 'seven_strategy_history_formal_evidence_rejected:gate_status=%', gate_status;
  end if;
  if formal_verdict <> 'YES' then
    raise exception 'seven_strategy_history_formal_evidence_rejected:formal_entry_speed_verdict=%', formal_verdict;
  end if;
  if formal_allowed not in ('true', 'yes', '1') then
    raise exception 'seven_strategy_history_formal_evidence_rejected:formal_entry_allowed=%', formal_allowed;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_seven_strategy_formal_history_evidence on public.seven_strategy_daily_history;
create trigger trg_seven_strategy_formal_history_evidence
before insert or update of signal_type, evidence
on public.seven_strategy_daily_history
for each row
execute function public.enforce_seven_strategy_formal_history_evidence();

-- Browser clients are read-only; only the service-role writer may insert.
revoke insert on public.seven_strategy_daily_history from anon, authenticated;
grant insert on public.seven_strategy_daily_history to service_role;

commit;
