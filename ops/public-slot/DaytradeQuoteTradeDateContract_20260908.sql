-- Canonical quote trade-date contract for cross-computer daytrade readers.
-- Safe to apply repeatedly. Existing rows are dated from their own quote event,
-- never from the deployment time.

begin;

alter table public.fugle_daytrade_quotes_live
  add column if not exists trade_date date;

update public.fugle_daytrade_quotes_live
set trade_date = (coalesce(last_trade_time, quote_seen_at, updated_at) at time zone 'Asia/Taipei')::date
where trade_date is null;

alter table public.fugle_daytrade_quotes_live
  alter column trade_date set not null;

create index if not exists idx_fugle_daytrade_quotes_live_trade_date_symbol_seen
  on public.fugle_daytrade_quotes_live(trade_date, symbol, quote_seen_at desc);

comment on column public.fugle_daytrade_quotes_live.trade_date is
  'Asia/Taipei trade date derived from the quote event (last_trade_time, then quote_seen_at, then updated_at). Readers must filter this column and must not infer today from receipt time.';

create or replace view public.v_fugle_daytrade_quotes_live_v2 as
select
  q.*,
  'daytrade-quotes-live-trade-date-v1'::text as contract_version,
  coalesce(q.last_trade_time, q.quote_seen_at, q.updated_at) as quote_event_at,
  ('fugle_daytrade_source:' || to_char(q.trade_date, 'YYYYMMDD') || ':canonical')::text as canonical_run_id,
  (q.trade_date = (coalesce(q.last_trade_time, q.quote_seen_at, q.updated_at) at time zone 'Asia/Taipei')::date) as quote_trade_date_match
from public.fugle_daytrade_quotes_live q;

grant select on public.fugle_daytrade_quotes_live to anon,authenticated,service_role;
grant select on public.v_fugle_daytrade_quotes_live_v2 to anon,authenticated,service_role;

comment on view public.v_fugle_daytrade_quotes_live_v2 is
  'Versioned anon readback for daytrade quotes. Filter trade_date and require quote_trade_date_match=true; canonical_run_id is derived only from the row trade date.';

notify pgrst,'reload schema';
commit;
