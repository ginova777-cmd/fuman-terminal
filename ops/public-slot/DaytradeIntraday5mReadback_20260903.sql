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
notify pgrst,'reload schema';
commit;
