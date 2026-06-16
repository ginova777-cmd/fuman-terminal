-- Strategy4 full-scan universe fix, 2026-06-16.
-- Strategy4 is not an intraday hot-pool scanner. It should scan the full
-- common-stock universe after product/blacklist/industry exclusions.
-- Do not use day-trade-only suitability or realtime liquidity as a Strategy4
-- universe gate.

create or replace view public.strategy4_stock_universe_view as
select
  symbol,
  name,
  market,
  industry,
  coalesce(is_etf, false) as is_etf,
  coalesce(is_warrant, false) as is_warrant,
  coalesce(is_cb, false) as is_cb,
  coalesce(is_blacklisted, false) as is_blacklisted,
  coalesce(is_daytrade_unsuitable, false) as is_daytrade_unsuitable,
  coalesce(is_active, false) as is_active,
  (
    coalesce(is_active, false) = true
    and coalesce(is_etf, false) = false
    and coalesce(is_warrant, false) = false
    and coalesce(is_cb, false) = false
    and coalesce(is_blacklisted, false) = false
    and coalesce(name, '') !~ '(ETF|ETN|權證|購|售|牛|熊|債|可轉債)'
    and coalesce(industry, '') !~ '(水泥|軍工|國防|航太)'
  ) as is_strategy4_eligible,
  updated_at,
  payload
from public.stock_universe;

grant select on public.strategy4_stock_universe_view to anon;
grant select on public.strategy4_stock_universe_view to service_role;

notify pgrst, 'reload schema';
