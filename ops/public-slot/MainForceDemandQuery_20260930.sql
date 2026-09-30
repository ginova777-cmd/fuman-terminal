-- No scheduler, table cleanup, source fetching or result/strategy logic changes.
BEGIN;
SET LOCAL statement_timeout='5s';
SET LOCAL lock_timeout='2s';
DO $fix$
DECLARE old_sql text; new_sql text;
BEGIN
  old_sql := pg_get_viewdef('public.v_terminal_main_force_latest'::regclass,true);
  IF old_sql NOT LIKE '%branch_rows AS (%' OR old_sql NOT LIKE '%top10_positive AS (%' THEN
    RAISE EXCEPTION 'main_force_definition_drift_or_already_applied';
  END IF;
  IF to_regclass('public.main_force_definition_backup_20260930') IS NOT NULL THEN
    RAISE EXCEPTION 'backup_exists_review_required';
  END IF;
  EXECUTE 'CREATE VIEW public.main_force_definition_backup_20260930 AS ' || old_sql;
  REVOKE ALL ON public.main_force_definition_backup_20260930 FROM PUBLIC,anon,authenticated;
  new_sql := replace(replace(old_sql,'branch_rows AS (','branch_rows AS NOT MATERIALIZED ('),
    'top10_positive AS (','top10_positive AS NOT MATERIALIZED (');
  EXECUTE 'CREATE OR REPLACE VIEW public.v_terminal_main_force_latest AS ' || new_sql;
END $fix$;
COMMIT;
-- Rollback (only after review): CREATE OR REPLACE VIEW using pg_get_viewdef
-- of main_force_definition_backup_20260930. Original public view grants persist.
