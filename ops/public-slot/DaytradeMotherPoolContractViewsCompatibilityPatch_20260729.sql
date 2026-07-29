-- Compatibility patch for existing production view columns.
-- Do not replace v_fugle_daytrade_mother_pool: production already has
-- legacy contract columns that CREATE OR REPLACE VIEW cannot remove.
-- Rebuild only the dependent TOP40 views with SELECT mp.* so every existing
-- mother-pool column stays in the same order and type.

begin;

do $$
begin
  if to_regclass('public.v_fugle_daytrade_mother_pool') is null then
    raise exception 'missing required view public.v_fugle_daytrade_mother_pool; run the existing mother-pool bootstrap first';
  end if;
end
$$;

create or replace view public.v_fugle_daytrade_formal_priority_top40 as
select mp.*
from public.v_fugle_daytrade_mother_pool mp
where coalesce(mp.in_formal_priority_top40, false) is true
order by mp.mother_pool_rank asc nulls last, mp.symbol asc
limit 40;

create or replace view public.v_fugle_daytrade_priority_top40 as
select mp.*
from public.v_fugle_daytrade_mother_pool mp
where coalesce(mp.in_formal_priority_top40, false) is true
order by mp.mother_pool_rank asc nulls last, mp.symbol asc
limit 40;

grant select on public.v_fugle_daytrade_formal_priority_top40 to anon, authenticated, service_role;
grant select on public.v_fugle_daytrade_priority_top40 to anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;
