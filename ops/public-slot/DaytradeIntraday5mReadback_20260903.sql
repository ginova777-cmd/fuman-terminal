begin;
do $$ begin
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='v_fugle_intraday_5m_readback' and c.relkind='m') then execute 'drop materialized view public.v_fugle_intraday_5m_readback';
 else execute 'drop view if exists public.v_fugle_intraday_5m_readback'; end if;
end $$;
create table if not exists public.fugle_intraday_5m_signal_cache(
 trade_date date not null,symbol text not null,candle_time timestamptz not null,bar_start timestamptz not null,bar_end timestamptz not null,
 open numeric,high numeric,low numeric,close numeric,volume numeric,bar_count integer,bar_complete boolean not null,
 ma5_5m numeric,ma10_5m numeric,ma20_5m numeric,ma5_rising_5m boolean,ma10_rising_5m boolean,ma20_rising_5m boolean,
 ma5_cross_ma10_up_5m boolean,ma10_cross_ma20_up_5m boolean,ma5_cross_ma20_up_5m boolean,
 kd_k_5m numeric,kd_d_5m numeric,kd_golden_cross_5m boolean,rsi6_5m numeric,rsi12_5m numeric,rsi_golden_cross_5m boolean,
 macd_dif_5m numeric,macd_signal_5m numeric,macd_golden_cross_5m boolean,macd_zero_cross_up_5m boolean,
 data_gap_5m boolean not null,source_status text not null,trend_5m_status text not null,trend_5m_reason text,
 ma20_warmup_mode text not null default 'previous_and_current_trade_date',source text not null default 'fugle_daytrade_intraday_1m',
 run_id text not null,updated_at timestamptz not null default now(),primary key(trade_date,symbol,candle_time)
);
alter table public.fugle_intraday_5m_signal_cache
 add column if not exists rsi3_5m numeric,
 add column if not exists rsi3_cross_rsi6_up_5m boolean,
 add column if not exists kd_5_3_golden_cross_5m boolean,
 add column if not exists kd_period integer not null default 5,
 add column if not exists kd_k_smoothing integer not null default 3,
 add column if not exists kd_d_smoothing integer not null default 3,
 add column if not exists kd_seed numeric not null default 50,
 add column if not exists trend_5m_strategy_version text not null default 'golden-cross-any-v3',
 add column if not exists golden_cross_any_5m boolean,
 add column if not exists calculation_version text not null default 'five-minute-indicators-v3',
 add column if not exists bar_kind text not null default 'regular_session',
 add column if not exists confirmation_eligible boolean not null default false,
 add column if not exists previous_bar_end timestamptz,
 add column if not exists previous_rsi3_5m numeric,
 add column if not exists previous_rsi6_5m numeric,
 add column if not exists previous_kd_k_5m numeric,
 add column if not exists previous_kd_d_5m numeric,
 add column if not exists previous_ma5_5m numeric,
 add column if not exists previous_ma10_5m numeric,
 add column if not exists previous_ma20_5m numeric,
 add column if not exists gap_reason text,
 add column if not exists calculated_at timestamptz not null default now();
create index if not exists fugle_intraday_5m_signal_cache_latest on public.fugle_intraday_5m_signal_cache(symbol,trade_date desc,candle_time desc);
create or replace view public.v_fugle_intraday_5m_readback as
 select * from (
  select c.*,row_number() over(partition by trade_date,symbol order by candle_time desc,updated_at desc) as latest_rank
  from public.fugle_intraday_5m_signal_cache c
 ) x where latest_rank=1;
create or replace view public.v_fugle_intraday_5m_history_readback as
 select * from public.fugle_intraday_5m_signal_cache;
grant select on public.v_fugle_intraday_5m_readback to anon,authenticated,service_role;
grant select on public.v_fugle_intraday_5m_history_readback to anon,authenticated,service_role;
revoke insert,update,delete on public.fugle_intraday_5m_signal_cache from anon,authenticated;
grant select,insert,update,delete on public.fugle_intraday_5m_signal_cache to service_role;
comment on view public.v_fugle_intraday_5m_readback is 'Lightweight canonical 5m trend readback. Only the independent service-role writer may populate completed bars.';
comment on view public.v_fugle_intraday_5m_history_readback is 'Canonical versioned 5m history for replay. Consumers must filter symbol, trade_date, run_id and bar_end <= as_of.';

create table if not exists public.fugle_intraday_5m_verification_receipts(
 run_id text primary key,
 contract text not null,
 trade_date date not null,
 status text not null check(status in ('complete','blocked')),
 complete boolean not null,
 exit_code integer not null,
 first_blocker text,
 anon_http_status integer,
 ssl_ok boolean not null,
 verified_at timestamptz not null,
 latest_complete_bar_end timestamptz,
 requested_symbols text[] not null default '{}',
 written_symbols text[] not null default '{}',
 missing_symbols text[] not null default '{}',
 readback_rows integer not null default 0,
 writer_update_frequency text not null default 'event_driven_and_every_5_minutes_during_market',
 created_at timestamptz not null default now()
);
alter table public.fugle_intraday_5m_verification_receipts
 add column if not exists strategy_version text not null default 'golden-cross-any-v3',
 add column if not exists calculation_version text not null default 'five-minute-indicators-v3',
 add column if not exists history_readback_rows integer not null default 0,
 add column if not exists diagnostic_summary jsonb not null default '{}'::jsonb;
create index if not exists fugle_intraday_5m_verification_receipts_latest
 on public.fugle_intraday_5m_verification_receipts(trade_date desc,verified_at desc);
drop view if exists public.v_fugle_intraday_5m_verification_readback;
create or replace view public.v_fugle_intraday_5m_verification_readback as
 select contract,strategy_version,calculation_version,run_id,trade_date,status,complete,exit_code,first_blocker,
        anon_http_status,ssl_ok,verified_at,latest_complete_bar_end,
        requested_symbols,written_symbols,missing_symbols,readback_rows,
        writer_update_frequency,history_readback_rows,diagnostic_summary
 from public.fugle_intraday_5m_verification_receipts;
grant select on public.v_fugle_intraday_5m_verification_readback to anon,authenticated,service_role;
revoke insert,update,delete on public.fugle_intraday_5m_verification_receipts from anon,authenticated;
grant select,insert,update,delete on public.fugle_intraday_5m_verification_receipts to service_role;
comment on view public.v_fugle_intraday_5m_verification_readback is 'Canonical anon-readable result of a real 5m writer plus verifier run; join technical rows by run_id and trade_date.';
notify pgrst,'reload schema';
commit;
