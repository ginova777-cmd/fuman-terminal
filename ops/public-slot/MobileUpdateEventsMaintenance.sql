-- Mobile realtime update event maintenance.
-- Run in Supabase SQL Editor for project cpmpfhbzutkiecccekfr.

grant delete on public.mobile_update_events to service_role;

-- Optional manual cleanup. The publisher also attempts this automatically.
delete from public.mobile_update_events
where created_at < now() - interval '14 days';
