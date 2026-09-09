-- Mother Pool short moving-average contract, 2026-09-09.
-- MA30/MA35/MA58 are legacy readback columns only; they are not warmup or Gate inputs.
do $$
declare
  view_sql text;
begin
  select pg_get_viewdef('public.v_fugle_daytrade_canonical_gate'::regclass, true)
    into view_sql;

  if position('normalized.ready_ma35_continuous_symbols > 0' in view_sql) = 0 then
    raise notice 'MA35 Gate term already absent';
    return;
  end if;

  view_sql := replace(
    view_sql,
    ' AND normalized.ready_ma35_continuous_symbols > 0',
    ''
  );
  view_sql := replace(
    view_sql,
    ' + (normalized.ready_ma35_continuous_symbols > 0)::integer',
    ''
  );

  execute 'create or replace view public.v_fugle_daytrade_canonical_gate as ' || view_sql;
end
$$;

comment on view public.v_fugle_daytrade_canonical_gate is
  'Canonical daytrade Gate. Required short direction is MA5>MA10>MA20; MA30/MA35/MA58 are excluded from warmup and Gate decisions.';
