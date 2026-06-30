-- Strategy3 unattended API audit hardening.
-- Purpose:
--   Allow read-only verifiers to prove retention/cost cleanup evidence without
--   running cleanup jobs or touching latest strategy results.

begin;

grant select on public.fuman_retention_cleanup_log to service_role;

-- This view is the preferred public audit surface; keep raw log reads limited to
-- service_role while allowing terminal health checks to read the summarized state.
grant select on public.v_fuman_cost_governance_audit_status to anon;
grant select on public.v_fuman_cost_governance_audit_status to authenticated;
grant select on public.v_fuman_cost_governance_audit_status to service_role;

comment on table public.fuman_retention_cleanup_log is
  'Retention cleanup audit log. service_role read access is required for read-only unattended verifiers.';

commit;
