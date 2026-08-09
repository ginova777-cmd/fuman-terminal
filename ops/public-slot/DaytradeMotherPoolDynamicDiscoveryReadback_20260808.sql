begin;

drop view if exists public.v_fugle_daytrade_mother_pool_discovery_readback;

create view public.v_fugle_daytrade_mother_pool_discovery_readback as
select
  mp.trade_date,
  mp.symbol,
  mp.name,
  mp.market,
  mp.price,
  mp.open_price,
  mp.previous_close,
  mp.change_percent,
  mp.total_volume,
  mp.trade_value,
  mp.avg5_volume,
  coalesce(nullif(mp.payload #>> '{motherPoolMetrics,volumeRatio5}', '')::numeric, mp.volume_vs_avg5_ratio, 0) as relative_volume_ratio,
  coalesce(nullif(mp.payload #>> '{motherPoolMetrics,volumeRank}', '')::integer, mp.volume_rank, 0) as volume_rank,
  coalesce(nullif(mp.payload #>> '{motherPoolMetrics,valueRank}', '')::integer, 0) as trade_value_rank,
  coalesce(nullif(mp.payload #>> '{motherPoolMetrics,ma3TurnUp}', '')::boolean, false) as ma3_turn_up,
  coalesce(nullif(mp.payload #>> '{motherPoolMetrics,ma5TurnUp}', '')::boolean, false) as ma5_turn_up,
  coalesce(nullif(mp.payload #>> '{motherPoolMetrics,ma10TurnUp}', '')::boolean, false) as ma10_turn_up,
  coalesce(nullif(mp.payload #>> '{motherPoolMetrics,ma30TurnUp}', '')::boolean, false) as ma30_turn_up,
  coalesce(nullif(mp.payload #>> '{motherPoolMetrics,ma58TurnUp}', '')::boolean, false) as ma58_turn_up,
  coalesce(nullif(mp.payload #>> '{motherPoolMetrics,maBullStackShort}', '')::boolean, false) as ma_bull_stack_short,
  coalesce(nullif(mp.payload #>> '{motherPoolMetrics,maBullStackMid}', '')::boolean, false) as ma_bull_stack_mid,
  coalesce(nullif(mp.payload #>> '{motherPoolMetrics,aboveMa30}', '')::boolean, false) as above_ma30,
  coalesce(nullif(mp.payload #>> '{motherPoolMetrics,aboveMa58}', '')::boolean, false) as above_ma58,
  coalesce(nullif(mp.payload #>> '{motherPoolMetrics,openingRangeBreak}', '')::boolean, false) as opening_range_break,
  coalesce(nullif(mp.payload #>> '{motherPoolMetrics,surgeFlag}', '')::boolean, false) as surge_flag,
  coalesce(nullif(mp.payload #>> '{motherPoolMetrics,volumeSpikeFlag}', '')::boolean, false) as volume_spike_flag,
  coalesce(mp.payload -> 'strategySourceFlags', '[]'::jsonb) as strategy_source_flags,
  mp.sector_name,
  mp.sector_strength_score,
  coalesce(nullif(mp.payload ->> 'liquidityGrade', ''), 'watch_only') as liquidity_grade,
  mp.mother_pool_score,
  mp.mother_pool_rank,
  coalesce(mp.payload -> 'poolReasons', '[]'::jsonb) as pool_reasons,
  mp.source_name,
  mp.updated_at,
  mp.in_formal_priority_top40,
  mp.mother_readiness_status,
  mp.quote_age_seconds,
  coalesce(mp.payload -> 'dataGap', '{"status":"OK","candle_count":0,"first_candle_time":"","last_candle_time":"","missing_window":""}'::jsonb) as data_gap,
  coalesce(mp.payload ->> 'motherPoolCandidate', 'false')::boolean as mother_pool_candidate,
  coalesce(mp.payload #> '{motherPoolMetrics,basePoolFailedChecks}', '[]'::jsonb) as base_pool_failed_checks,
  coalesce(mp.payload #> '{motherPoolMetrics,basePoolPendingChecks}', '[]'::jsonb) as base_pool_pending_checks,
  coalesce(mp.payload #>> '{motherPoolMetrics,basePoolEligible}', 'false')::boolean as base_pool_eligible,
  coalesce(mp.payload #>> '{motherPoolMetrics,basePoolPending}', 'false')::boolean as base_pool_pending,
  mp.payload
from public.v_fugle_daytrade_mother_pool mp
where coalesce(mp.price, 0) >= 50;

grant select on public.v_fugle_daytrade_mother_pool_discovery_readback to anon, authenticated, service_role;

commit;
