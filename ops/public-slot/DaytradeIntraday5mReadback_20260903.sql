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
create index if not exists fugle_intraday_5m_signal_cache_latest on public.fugle_intraday_5m_signal_cache(symbol,trade_date desc,candle_time desc);
create or replace view public.v_fugle_intraday_5m_readback as select * from public.fugle_intraday_5m_signal_cache;
grant select on public.v_fugle_intraday_5m_readback to anon,authenticated,service_role;
revoke insert,update,delete on public.fugle_intraday_5m_signal_cache from anon,authenticated;
grant select,insert,update,delete on public.fugle_intraday_5m_signal_cache to service_role;
comment on view public.v_fugle_intraday_5m_readback is 'Lightweight canonical 5m trend readback. Only the independent service-role writer may populate completed bars.';

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
create index if not exists fugle_intraday_5m_verification_receipts_latest
 on public.fugle_intraday_5m_verification_receipts(trade_date desc,verified_at desc);
create or replace view public.v_fugle_intraday_5m_verification_readback as
 select contract,run_id,trade_date,status,complete,exit_code,first_blocker,
        anon_http_status,ssl_ok,verified_at,latest_complete_bar_end,
        requested_symbols,written_symbols,missing_symbols,readback_rows,
        writer_update_frequency
 from public.fugle_intraday_5m_verification_receipts;
grant select on public.v_fugle_intraday_5m_verification_readback to anon,authenticated,service_role;
revoke insert,update,delete on public.fugle_intraday_5m_verification_receipts from anon,authenticated;
grant select,insert,update,delete on public.fugle_intraday_5m_verification_receipts to service_role;
comment on view public.v_fugle_intraday_5m_verification_readback is 'Canonical anon-readable result of a real 5m writer plus verifier run; join technical rows by run_id and trade_date.';
notify pgrst,'reload schema';
commit;
