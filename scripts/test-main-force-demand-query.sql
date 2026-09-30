BEGIN;
SET LOCAL statement_timeout='5s';
CREATE TEMP TABLE main_force_raw_fixture (symbol text, trade_date date, actor text,
 price numeric,buy numeric,sell numeric,net numeric,payload jsonb,updated_at timestamptz);
CREATE TEMP TABLE main_force_registry_fixture (branch_name text,trader_style text,active boolean,updated_at timestamptz);
INSERT INTO main_force_raw_fixture
SELECT s, d::date, 'branch-'||n, 100+n, 100-n, 1, 99-n, '{}'::jsonb, '2026-09-30T12:00:00Z'::timestamptz
FROM unnest(ARRAY['6531','2330','BAD']) s CROSS JOIN unnest(ARRAY['2026-09-29','2026-09-30']) d CROSS JOIN generate_series(1,12) n;
ALTER TABLE main_force_raw_fixture ADD COLUMN dataset text DEFAULT 'TaiwanStockTradingDailyReport';
INSERT INTO main_force_registry_fixture VALUES ('branch-1','overnight',true,'2026-09-30'),('branch-2','daytrade',true,'2026-09-30');
DO $test$
DECLARE original text; optimized text; differences integer;
BEGIN
 original := pg_get_viewdef('public.v_terminal_main_force_latest'::regclass,true);
 original := replace(replace(original,'finmind_chip_raw','pg_temp.main_force_raw_fixture'),'terminal_broker_style_registry','pg_temp.main_force_registry_fixture');
 optimized := replace(replace(original,'branch_rows AS (','branch_rows AS NOT MATERIALIZED ('),'top10_positive AS (','top10_positive AS NOT MATERIALIZED (');
 EXECUTE 'CREATE TEMP VIEW main_force_original_fixture AS '||original;
 EXECUTE 'CREATE TEMP VIEW main_force_optimized_fixture AS '||optimized;
 SELECT count(*) INTO differences FROM (
   (SELECT to_jsonb(a) FROM main_force_original_fixture a EXCEPT ALL SELECT to_jsonb(b) FROM main_force_optimized_fixture b)
   UNION ALL
   (SELECT to_jsonb(b) FROM main_force_optimized_fixture b EXCEPT ALL SELECT to_jsonb(a) FROM main_force_original_fixture a)
 ) diff;
 IF differences<>0 THEN RAISE EXCEPTION 'result_mismatch %',differences; END IF;
 IF (SELECT count(*) FROM main_force_optimized_fixture)<>2 THEN RAISE EXCEPTION 'fixture_count_mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM main_force_optimized_fixture WHERE trade_date<>'2026-09-30' OR main_force_branch_count<>10) THEN
   RAISE EXCEPTION 'latest_date_or_top10_changed';
 END IF;
END $test$;
SELECT 'PASS: original and optimized results identical; latest date, top10, styles, invalid symbol' AS result;
ROLLBACK;
