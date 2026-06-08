create table if not exists public.strategy2_1m_candles (
  trade_date date not null,
  code text not null,
  minute text not null,
  open numeric,
  high numeric,
  low numeric,
  close numeric not null,
  volume numeric,
  source text not null default 'fugle',
  updated_at timestamptz not null default now(),
  primary key (trade_date, code, minute)
);
