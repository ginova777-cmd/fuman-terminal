-- Fugle source live repair B5, 2026-06-29.
-- Fix coverage heartbeat upsert failures on older fugle_source_coverage tables.

delete from public.fugle_source_coverage a
using public.fugle_source_coverage b
where a.ctid < b.ctid
  and a.source_name = b.source_name
  and a.checked_at = b.checked_at;

create unique index if not exists idx_fugle_source_coverage_source_checked_at_unique
  on public.fugle_source_coverage (source_name, checked_at);

notify pgrst, 'reload schema';
