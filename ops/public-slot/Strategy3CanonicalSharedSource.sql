-- Strategy3 canonical shared-source contract, 2026-07-02.
-- Release-owner apply only. This does not start writers/scanners and does not assert production YES.
--
-- Goal:
--   Strategy3 uses the same canonical Supabase quote / 1m / readiness source that Strategy2 uses.
--   Strategy3 still owns its own 09:00-12:59 readiness view and gate.
--   Fugle direct 1m is not a Strategy3 full-market source; it is priority repair only.

begin;

create or replace view public.v_strategy3_source_speed_profile as
select
  'strategy3_stable'::text as profile_name,
  'stable'::text as mode,
  5::integer as rest_quote_batch_size,
  30::integer as rest_quote_every_seconds,
  3000::integer as rest_quote_delay_milliseconds,
  10::integer as fugle_collector_batch_size,
  1::integer as fugle_collector_concurrency,
  6000::integer as fugle_collector_request_delay_milliseconds,
  10::integer as fugle_collector_adaptive_initial_rpm,
  5::integer as fugle_collector_adaptive_min_rpm,
  20::integer as fugle_collector_adaptive_max_rpm,
  true::boolean as direct1m_enabled,
  'priority-repair-only'::text as direct1m_usage,
  1::integer as direct1m_batch_size,
  90::integer as direct1m_every_seconds,
  8000::integer as direct1m_delay_milliseconds,
  '07:00'::text as direct1m_prewarm_start,
  300::integer as direct1m_prewarm_symbol_count,
  2::integer as direct1m_prewarm_batch_size,
  120::integer as direct1m_prewarm_bars,
  600000::integer as rate_limit_429_cooldown_milliseconds,
  1200000::integer as rate_limit_429_max_cooldown_milliseconds,
  900000::integer as priority_only_after_429_milliseconds,
  1000::integer as min_same_day_quote_rows,
  900::integer as max_quote_age_seconds,
  1000::integer as min_session_ready_symbols,
  120::integer as max_intraday_1m_stale_seconds,
  jsonb_build_object(
    'rule', 'Strategy3 scanner reads Supabase only; no full-market Fugle direct 1m.',
    'direct1mUsage', 'priority-repair-only',
    'source', 'fugle_quotes_latest + fugle_intraday_1m canonical table + stock_daily_volume',
    'strategy3View', 'v_strategy3_intraday_1m_status',
    'gateView', 'v_strategy3_source_gate'
  ) as payload;

drop view if exists public.v_strategy3_quote_ready;
drop view if exists public.v_strategy3_intraday_1m_status;

create or replace view public.v_strategy3_intraday_1m_status as
with config as (
  select
    ((now() at time zone 'Asia/Taipei')::date) as taipei_today,
    time '09:00:00' as session_start,
    time '12:59:59' as session_end
),
recent as (
  select *
  from (
    select
      m.symbol,
      m.market,
      m.candle_time,
      m.trade_date,
      m.updated_at,
      row_number() over (
        partition by m.symbol
        order by m.candle_time desc nulls last
      ) as rn
    from public.fugle_intraday_1m m
    cross join config c
    where m.symbol ~ '^[0-9]{4}$'
      and m.trade_date >= c.taipei_today - 8
      and m.candle_time is not null
  ) ranked
  where rn <= 200
),
per_symbol as (
  select
    r.symbol,
    (array_agg(r.market order by r.candle_time desc nulls last))[1] as market,
    max(r.candle_time) filter (
      where r.trade_date = c.taipei_today
        and (r.candle_time at time zone 'Asia/Taipei')::time between c.session_start and c.session_end
    ) as latest_candle_time,
    max(r.updated_at) as updated_at,
    min(r.candle_time) as first_candle_time,
    count(*) filter (
      where r.trade_date = c.taipei_today
        and (r.candle_time at time zone 'Asia/Taipei')::time between c.session_start and c.session_end
    )::integer as today_candle_count,
    count(*) filter (where r.trade_date < c.taipei_today)::integer as warmup_candle_count,
    count(*)::integer as continuous_candle_count,
    count(*)::integer as candle_count
  from recent r
  cross join config c
  group by r.symbol
)
select
  symbol,
  symbol as code,
  market,
  latest_candle_time,
  (latest_candle_time at time zone 'Asia/Taipei')::text as latest_candle_time_taipei,
  updated_at,
  first_candle_time,
  today_candle_count,
  today_candle_count as rows_today,
  warmup_candle_count,
  continuous_candle_count,
  candle_count,
  (today_candle_count > 0) as has_today_data,
  case
    when latest_candle_time is null then 999999
    else greatest(0, extract(epoch from (now() - latest_candle_time)))::integer
  end as latest_candle_age_seconds,
  (continuous_candle_count >= 20) as ready_ge_20,
  (continuous_candle_count >= 35) as ready_ge_35,
  (continuous_candle_count >= 80) as ready_ge_80,
  (continuous_candle_count >= 100) as ready_ge_100,
  (continuous_candle_count >= 200) as ready_ge_200,
  (continuous_candle_count >= 20) as ready_ma20_continuous,
  (continuous_candle_count >= 35) as ready_ma35_continuous,
  (continuous_candle_count >= 80) as ready_macd_continuous,
  (continuous_candle_count >= 35) as ma35_available,
  (today_candle_count >= 35) as ready_35,
  (continuous_candle_count >= 80) as ready_80,
  (continuous_candle_count >= 100) as ready_100,
  (continuous_candle_count >= 120) as ready_120,
  (continuous_candle_count >= 160) as ready_160,
  (
    today_candle_count >= 35
    and continuous_candle_count >= 35
    and latest_candle_time is not null
    and greatest(0, extract(epoch from (now() - latest_candle_time)))::integer <= 120
  ) as strategy3_intraday_ready,
  case
    when today_candle_count >= 35
      and continuous_candle_count >= 35
      and latest_candle_time is not null
      and greatest(0, extract(epoch from (now() - latest_candle_time)))::integer <= 120
      then 'A'
    when latest_candle_time is not null and today_candle_count > 0 then 'C'
    else 'D'
  end as strategy3_intraday_gate_grade,
  case
    when latest_candle_time is null then 'missing_strategy3_session_1m'
    when today_candle_count < 35 then 'today_session_candles_below_35'
    when continuous_candle_count < 35 then 'ma35_continuous_not_ready'
    when greatest(0, extract(epoch from (now() - latest_candle_time)))::integer > 120 then 'intraday_1m_stale_gt_120s'
    else ''
  end as strategy3_intraday_fail_closed_reason
from per_symbol;

create or replace view public.v_strategy3_quote_ready as
select
  q.symbol,
  q.symbol as code,
  coalesce(u.name, q.name, q.symbol) as name,
  coalesce(u.market, q.market) as market,
  u.industry,
  coalesce(q.last_price, q.close) as price,
  coalesce(q.close, q.last_price) as close,
  coalesce(q.prev_close, q.previous_close) as prev_close,
  coalesce(q.previous_close, q.prev_close) as previous_close,
  coalesce(q.change, coalesce(q.last_price, q.close) - coalesce(q.previous_close, q.prev_close)) as change,
  q.change_percent,
  coalesce(q.trade_volume_lots, q.trade_volume, q.total_volume) as trade_volume_lots,
  coalesce(q.trade_volume_shares, q.trade_volume, q.total_volume) as trade_volume,
  coalesce(q.trade_volume_shares, q.trade_volume, q.total_volume) as trade_volume_shares,
  coalesce(q.total_volume, q.trade_volume_lots, q.trade_volume) as total_volume,
  q.trade_value,
  q.high,
  q.low,
  q.open,
  null::numeric as limit_up_price,
  null::numeric as limit_down_price,
  q.updated_at,
  q.last_trade_time,
  coalesce(q.quote_source, 'fugle_latest') as quote_source,
  coalesce(q.quote_time, q.last_trade_time, q.updated_at) as quote_time,
  greatest(0, floor(extract(epoch from (now() - coalesce(q.quote_time, q.last_trade_time, q.updated_at)))))::integer as quote_age_seconds,
  (coalesce(q.quote_time, q.last_trade_time, q.updated_at) >= now() - interval '120 seconds') as quote_fresh,
  (coalesce(q.quote_time, q.last_trade_time, q.updated_at) >= now() - interval '120 seconds') as is_quote_fresh,
  ((coalesce(q.quote_time, q.last_trade_time, q.updated_at) at time zone 'Asia/Taipei')::date = (now() at time zone 'Asia/Taipei')::date) as is_same_taipei_trade_day,
  'shares'::text as volume_unit,
  null::numeric as cumulative_bid_volume,
  null::numeric as cumulative_ask_volume,
  null::numeric as cumulative_bid_ask_volume,
  null::numeric as avg_volume_5_lots,
  null::numeric as avg_volume_20_lots,
  null::numeric as avg_volume_5,
  null::numeric as avg_volume_20,
  null::numeric as avg_volume_5_shares,
  null::numeric as avg_volume_20_shares,
  null::integer as avg_volume_5_days,
  null::integer as avg_volume_20_days,
  null::numeric as volume_ratio_5,
  rank() over (order by q.trade_value desc nulls last) as trade_value_rank,
  rank() over (order by coalesce(q.total_volume, q.trade_volume_shares, q.trade_volume) desc nulls last) as total_volume_rank,
  null::numeric as issued_shares,
  null::numeric as turnover_rate,
  s.today_candle_count,
  s.rows_today,
  s.latest_candle_time,
  s.ready_35,
  s.ready_ge_35,
  s.ready_80,
  s.ready_ge_80,
  s.ready_100,
  s.ready_120,
  s.ready_160,
  q.stock_type,
  coalesce(u.is_active, true) as is_active,
  coalesce(u.is_etf, false) as is_etf,
  coalesce(u.is_warrant, false) as is_warrant,
  coalesce(u.is_cb, false) as is_cb,
  coalesce(u.is_blacklisted, false) as is_blacklisted,
  coalesce(u.is_daytrade_unsuitable, false) as is_daytrade_unsuitable,
  q.is_halted,
  q.is_trial,
  false as is_disposition,
  false as is_attention,
  false as is_full_delivery,
  false as is_periodic_auction,
  false as is_margin_suspended,
  q.session,
  jsonb_build_object(
    'quote_source', coalesce(q.quote_source, 'fugle_latest'),
    'formal_source', 'fugle_quotes_latest+v_strategy3_intraday_1m_status+stock_daily_volume',
    'strategy3_intraday_gate_grade', s.strategy3_intraday_gate_grade
  ) as payload
from public.fugle_quotes_latest q
left join public.stock_universe u
  on u.symbol = q.symbol
left join public.v_strategy3_intraday_1m_status s
  on s.symbol = q.symbol
where q.symbol ~ '^[0-9]{4}$'
  and coalesce(q.stock_type, 'COMMONSTOCK') = 'COMMONSTOCK'
  and coalesce(u.is_active, true) = true
  and coalesce(u.is_etf, false) = false
  and coalesce(u.is_warrant, false) = false
  and coalesce(u.is_cb, false) = false
  and coalesce(u.is_blacklisted, false) = false
  and coalesce(u.is_daytrade_unsuitable, false) = false;

create or replace view public.v_strategy3_source_gate as
with profile as (
  select *
  from public.v_strategy3_source_speed_profile
  limit 1
),
quotes as (
  select
    count(*) filter (where q.symbol ~ '^[0-9]{4}$')::integer as active_symbols,
    count(*) filter (
      where q.symbol ~ '^[0-9]{4}$'
        and (coalesce(q.quote_time, q.last_trade_time, q.updated_at) at time zone 'Asia/Taipei')::date = (now() at time zone 'Asia/Taipei')::date
    )::integer as same_day_quote_rows,
    count(*) filter (
      where q.symbol ~ '^[0-9]{4}$'
        and coalesce(q.quote_time, q.last_trade_time, q.updated_at) >= now() - interval '120 seconds'
    )::integer as fresh_quotes_120s,
    max(coalesce(q.quote_time, q.last_trade_time, q.updated_at)) as latest_quote_at
  from public.fugle_quotes_latest q
  where coalesce(q.stock_type, 'COMMONSTOCK') = 'COMMONSTOCK'
),
intraday as (
  select
    count(*)::integer as intraday_status_rows,
    count(*) filter (where today_candle_count > 0)::integer as today_1m_symbols,
    count(*) filter (where strategy3_intraday_ready)::integer as session_ready_symbols,
    count(*) filter (where ready_ma20_continuous)::integer as ready_ma20_continuous,
    count(*) filter (where ready_ma35_continuous)::integer as ready_ma35_continuous,
    max(latest_candle_time) as latest_candle_time,
    min(latest_candle_age_seconds) filter (where latest_candle_time is not null)::integer as intraday_1m_stale_seconds
  from public.v_strategy3_intraday_1m_status
),
daily as (
  select
    count(distinct coalesce(symbol, code))::integer as daily_volume_rows,
    max(trade_date) as daily_volume_latest_trade_date
  from public.stock_daily_volume
),
shared as (
  select status, updated_at, stale_seconds, message, payload
  from public.source_status
  where source_name = 'fugle_shared_source'
  limit 1
),
calc as (
  select
    now() as checked_at,
    q.active_symbols,
    q.same_day_quote_rows,
    q.fresh_quotes_120s,
    case when q.active_symbols > 0 then round(q.fresh_quotes_120s::numeric / q.active_symbols, 4) else 0 end as fresh_quote_coverage_120s,
    case
      when q.latest_quote_at is null then 999999
      else greatest(0, extract(epoch from (now() - q.latest_quote_at)))::integer
    end as quote_age_seconds,
    i.intraday_status_rows,
    i.today_1m_symbols,
    i.session_ready_symbols,
    i.ready_ma20_continuous,
    i.ready_ma35_continuous,
    i.latest_candle_time,
    coalesce(i.intraday_1m_stale_seconds, 999999) as intraday_1m_stale_seconds,
    d.daily_volume_rows,
    d.daily_volume_latest_trade_date,
    s.status as shared_source_status,
    s.updated_at as shared_source_updated_at,
    s.message as shared_source_message,
    p.min_same_day_quote_rows,
    p.max_quote_age_seconds,
    p.min_session_ready_symbols,
    p.max_intraday_1m_stale_seconds
  from quotes q
  cross join intraday i
  cross join daily d
  cross join profile p
  left join shared s on true
)
select
  checked_at,
  'strategy3_canonical_source'::text as source_name,
  case
    when coalesce(shared_source_status, '') in ('stopped', 'error', 'failed', 'critical') then 'D'
    when same_day_quote_rows < min_same_day_quote_rows then 'D'
    when daily_volume_rows < 1000 then 'D'
    when session_ready_symbols < min_session_ready_symbols then 'D'
    when ready_ma20_continuous < min_session_ready_symbols then 'D'
    when ready_ma35_continuous < min_session_ready_symbols then 'D'
    when quote_age_seconds > max_quote_age_seconds then 'C'
    when intraday_1m_stale_seconds > max_intraday_1m_stale_seconds then 'C'
    else 'A'
  end as gate_grade,
  case
    when coalesce(shared_source_status, '') in ('stopped', 'error', 'failed', 'critical') then 'degraded'
    when same_day_quote_rows < min_same_day_quote_rows
      or daily_volume_rows < 1000
      or session_ready_symbols < min_session_ready_symbols
      or ready_ma20_continuous < min_session_ready_symbols
      or ready_ma35_continuous < min_session_ready_symbols
      or quote_age_seconds > max_quote_age_seconds
      or intraday_1m_stale_seconds > max_intraday_1m_stale_seconds
      then 'degraded'
    else 'ok'
  end as status,
  concat_ws(
    '; ',
    case when coalesce(shared_source_status, '') in ('stopped', 'error', 'failed', 'critical') then 'shared_source_hard_stopped=' || shared_source_status end,
    case when same_day_quote_rows < min_same_day_quote_rows then 'same_day_quote_rows=' || same_day_quote_rows || '<' || min_same_day_quote_rows end,
    case when daily_volume_rows < 1000 then 'daily_volume_rows=' || daily_volume_rows || '<1000' end,
    case when session_ready_symbols < min_session_ready_symbols then 'session_ready_symbols=' || session_ready_symbols || '<' || min_session_ready_symbols end,
    case when ready_ma20_continuous < min_session_ready_symbols then 'ready_ma20_continuous=' || ready_ma20_continuous || '<' || min_session_ready_symbols end,
    case when ready_ma35_continuous < min_session_ready_symbols then 'ready_ma35_continuous=' || ready_ma35_continuous || '<' || min_session_ready_symbols end,
    case when quote_age_seconds > max_quote_age_seconds then 'quote_age_seconds=' || quote_age_seconds || '>' || max_quote_age_seconds end,
    case when intraday_1m_stale_seconds > max_intraday_1m_stale_seconds then 'intraday_1m_stale_seconds=' || intraday_1m_stale_seconds || '>' || max_intraday_1m_stale_seconds end
  ) as reason,
  active_symbols,
  same_day_quote_rows,
  fresh_quotes_120s,
  fresh_quote_coverage_120s,
  quote_age_seconds,
  intraday_status_rows,
  today_1m_symbols,
  session_ready_symbols,
  session_ready_symbols as ready_ge_35,
  ready_ma20_continuous,
  ready_ma35_continuous,
  latest_candle_time,
  (latest_candle_time at time zone 'Asia/Taipei')::text as latest_candle_time_taipei,
  intraday_1m_stale_seconds,
  daily_volume_rows,
  daily_volume_latest_trade_date,
  shared_source_status,
  shared_source_updated_at,
  shared_source_message,
  min_same_day_quote_rows,
  max_quote_age_seconds,
  min_session_ready_symbols,
  max_intraday_1m_stale_seconds
from calc;

grant select on public.v_strategy3_source_speed_profile to anon, authenticated, service_role;
grant select on public.v_strategy3_intraday_1m_status to anon, authenticated, service_role;
grant select on public.v_strategy3_quote_ready to anon, authenticated, service_role;
grant select on public.v_strategy3_source_gate to anon, authenticated, service_role;

comment on view public.v_strategy3_intraday_1m_status is
  'Strategy3 09:00-12:59 readiness view backed by the canonical shared fugle_intraday_1m table. No Strategy3 full-market direct 1m fetch.';

comment on view public.v_strategy3_source_gate is
  'Strategy3 A/D gate for canonical quote + 09:00-12:59 1m + daily volume readiness. A is required before Strategy3 formal publish.';

notify pgrst, 'reload schema';

commit;
