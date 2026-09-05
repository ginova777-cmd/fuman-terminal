-- Canonical preopen Snapshot / History writer contract v2.
-- Add the exact conflict targets used by the formal Node writer.

alter table public.fugle_preopen_snapshot
  add column if not exists trade_date date;

alter table public.fugle_preopen_snapshot_history
  add column if not exists updated_at timestamptz;

create unique index if not exists uq_fugle_preopen_snapshot_trade_date_symbol
  on public.fugle_preopen_snapshot (trade_date, symbol);

create unique index if not exists uq_fugle_preopen_history_trade_date_symbol_observed
  on public.fugle_preopen_snapshot_history (trade_date, symbol, observed_at);

comment on index public.uq_fugle_preopen_snapshot_trade_date_symbol is
  'preopen_snapshot_history_v2 canonical snapshot conflict target';

comment on index public.uq_fugle_preopen_history_trade_date_symbol_observed is
  'preopen_snapshot_history_v2 canonical history conflict target';
