-- 2026-08-11: Keep scanner health bounded after strategy3 quote-ready retirement.
-- The health view only needs a current readiness count; the snapshot is authoritative
-- and avoids evaluating the expensive legacy quote-ready view for every scanner.
DO $$
DECLARE
  view_sql text;
  next_sql text;
BEGIN
  SELECT pg_get_viewdef('public.v_scanner_resource_health'::regclass, true) INTO view_sql;
  IF position('v_strategy3_quote_ready' IN view_sql) = 0 THEN
    RAISE NOTICE 'v_scanner_resource_health already uses the bounded readiness source';
    RETURN;
  END IF;

  next_sql := regexp_replace(
    view_sql,
    E'SELECT count\\(\\*\\)\\s+FROM v_strategy3_quote_ready AS quote_ready_rows',
    'SELECT count(*) FROM strategy3_ready_snapshot AS quote_ready_rows',
    'g'
  );
  IF next_sql = view_sql THEN
    RAISE EXCEPTION 'scanner health replacement anchor missing';
  END IF;

  EXECUTE format('CREATE OR REPLACE VIEW public.v_scanner_resource_health AS %s', next_sql);
END $$;

NOTIFY pgrst, 'reload schema';