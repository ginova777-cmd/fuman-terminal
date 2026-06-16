-- Strategy4 universe alignment fix, 2026-06-16.
-- Align public.strategy4_stock_universe_view with Node normalizeStock/isExcludedStock
-- exclusions so DB eligible count matches Strategy4 runtime universe count.

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
    and symbol ~ '^[0-9]{4}$'
    and symbol not like '00%'
    and coalesce(is_etf, false) = false
    and coalesce(is_warrant, false) = false
    and coalesce(is_cb, false) = false
    and coalesce(is_blacklisted, false) = false
    and nullif(trim(coalesce(name, '')), '') is not null
    and concat_ws(' ', symbol, name, industry) !~* '(ETF|ETN|DR|指數|台灣50|高股息|正2|反1|期貨|債|權證|認購|認售|牛證|熊證|CB|可轉債)'
    and concat_ws(' ', symbol, name, industry) !~* '(水泥|軍工|國防|航太|漢翔|雷虎|龍德|駐龍|晟田|寶一|亞航|千附)'
  ) as is_strategy4_eligible,
  updated_at,
  payload
from public.stock_universe;

grant select on public.strategy4_stock_universe_view to anon;
grant select on public.strategy4_stock_universe_view to service_role;

notify pgrst, 'reload schema';
