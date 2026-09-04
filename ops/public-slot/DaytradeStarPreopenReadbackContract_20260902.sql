begin;

create or replace view public.v_fugle_daytrade_star_preopen_readback as
with near_one as (
  select n.*
  from public.v_fugle_daytrade_near_one_contract n
  where n.trade_date = (now() at time zone 'Asia/Taipei')::date
    and n.is_near_one is true
), snapshots as (
  select s.*
  from public.v_fugle_daytrade_preopen_snapshot_contract s
  where s.trade_date = (now() at time zone 'Asia/Taipei')::date
    and s.natural_schedule_evidence is true
    and s.capture_slot between '0845' and '0859'
), snapshot_agg as (
  select
    trade_date, underlying_symbol,
    count(*)::integer as preopen_snapshot_count,
    min(captured_at) as first_preopen_seen_at,
    max(captured_at) as last_preopen_seen_at,
    (array_agg(trial_price order by captured_at desc) filter (where trial_price > 0))[1] as trial_price,
    (array_agg(trial_change_pct order by captured_at desc) filter (where trial_price > 0))[1] as trial_rise_percent,
    (array_agg(best_bid order by captured_at desc) filter (where trial_price > 0))[1] as best_bid_price,
    (array_agg(best_ask order by captured_at desc) filter (where trial_price > 0))[1] as best_ask_price,
    (array_agg(bid_ask_ratio order by captured_at desc) filter (where trial_price > 0))[1] as bid_ask_ratio,
    min(fut_price) filter (where fut_price > 0) as future_low_price,
    max(fut_price) filter (where fut_price > 0) as future_high_price,
    (array_agg(fut_price order by captured_at asc) filter (where fut_price > 0 and capture_slot='0845'))[1] as future_open_price,
    (array_agg(fut_price order by captured_at desc) filter (where fut_price > 0))[1] as futopt_last_price,
    (array_agg(fut_change_pct order by captured_at desc) filter (where fut_price > 0))[1] as futopt_change_percent,
    (array_agg(fut_volume order by captured_at desc) filter (where fut_price > 0))[1] as futopt_total_volume,
    (array_agg(nullif(payload->>'txf_change_percent','')::numeric order by captured_at desc) filter (where fut_price > 0))[1] as txf_change_percent,
    (array_agg(nullif(payload->>'relative_to_txf_percent','')::numeric order by captured_at desc) filter (where fut_price > 0))[1] as relative_to_txf_percent,
    (array_agg(payload order by captured_at desc))[1] as latest_payload
  from snapshots
  group by trade_date, underlying_symbol
), live as (
  select * from public.v_stock_future_live_contract
  where trade_date = (now() at time zone 'Asia/Taipei')::date
), base as (
  select
    n.trade_date, n.symbol, coalesce(l.stock_name,n.symbol) as stock_name,
    n.fut_contract as future_symbol, true as near_one_present,
    a.futopt_last_price,
    a.futopt_change_percent,
    a.relative_to_txf_percent,
    a.futopt_total_volume,
    a.future_open_price, a.future_high_price, a.future_low_price,
    a.trial_price,
    nullif(a.latest_payload->>'reference_price','')::numeric as reference_price,
    a.trial_rise_percent, a.best_bid_price,
    nullif(a.latest_payload->>'bid_volume','')::numeric as bid_volume,
    nullif(a.latest_payload->>'ask_volume','')::numeric as ask_volume,
    a.bid_ask_ratio,
    coalesce((a.latest_payload->>'is_limit_up_bid')::boolean,false) as is_limit_up_bid,
    coalesce(a.preopen_snapshot_count,0) as preopen_snapshot_count,
    a.first_preopen_seen_at, a.last_preopen_seen_at,
    greatest(n.resolved_at,coalesce(a.last_preopen_seen_at,n.resolved_at)) as updated_at
  from near_one n
  left join snapshot_agg a on a.trade_date=n.trade_date and a.underlying_symbol=n.symbol
  left join live l on l.trade_date=n.trade_date and l.symbol=n.symbol
), rules as (
  select b.*,
    (future_symbol is not null and future_symbol<>'' and future_symbol not like 'TXF%' and futopt_last_price>0
      and futopt_change_percent>=2 and relative_to_txf_percent>=1 and futopt_total_volume>=50) as future_ok,
    (trial_price>0 and reference_price>0 and trial_rise_percent>=2 and bid_ask_ratio>=1.5
      and best_bid_price>=trial_price and preopen_snapshot_count>0) as preopen_ok,
    case when future_open_price>0 and futopt_last_price>0
      and abs(futopt_last_price-future_open_price)/future_open_price*100<=1
      and futopt_last_price>=future_open_price*0.995
      and futopt_change_percent>=2 and relative_to_txf_percent>=1 and futopt_total_volume>=50
      then '開盤回測守住' else null end as future_pattern
  from base b
)
select r.*,
  (future_symbol is null or future_symbol='' or futopt_last_price<=0) as empty_shell_row,
  case when future_open_price>0 and futopt_last_price>0
    and futopt_change_percent is not null and relative_to_txf_percent is not null and futopt_total_volume is not null
    then 'ready' else 'DATA_GAP' end as source_status,
  future_ok as star_precheck_ok,
  coalesce(future_pattern='開盤回測守住',false) as star_type1_ok,
  (future_ok and preopen_ok) as star_blind_buy_ok,
  coalesce(future_pattern='開盤回測守住',false) as star_final_ok,
  case
    when future_pattern='開盤回測守住' then null
    when future_symbol is null or future_symbol='' or future_symbol like 'TXF%' then 'NO_CONTRACT'
    when futopt_last_price<=0 then 'FUTURE_PRICE_MISSING'
    when preopen_snapshot_count=0 then 'NATURAL_FUTURE_PREOPEN_DATA_GAP'
    when future_open_price is null or futopt_last_price is null then 'NATURAL_FUTURE_PREOPEN_DATA_GAP'
    when futopt_change_percent is null or relative_to_txf_percent is null or futopt_total_volume is null then 'NATURAL_FUTURE_PREOPEN_DATA_GAP'
    when reference_price is null or reference_price<=0 then 'REFERENCE_PRICE_MISSING'
    when not preopen_ok then 'PREOPEN_CONDITION_NOT_MET'
    when future_pattern is null then 'FUTURE_OPEN_RETEST_NOT_MET'
    else null end as data_gap_reason,
  case
    when future_pattern='開盤回測守住' then 'STAR'
    when preopen_snapshot_count=0 or future_open_price is null or futopt_last_price is null then 'DATA_GAP｜期貨自然時槽缺資料'
    when not future_ok or not preopen_ok then 'DATA_GAP｜' || coalesce(case when preopen_snapshot_count=0 then '試撮缺資料' else '條件未通過' end,'條件未通過')
    else '盤前觀察' end as display_label,
  r.symbol as underlying_symbol,
  r.stock_name as name,
  r.future_open_price as future_0845_open_price,
  r.future_high_price as future_preopen_high_price,
  r.future_low_price as future_preopen_low_price,
  r.futopt_last_price as future_0859_last_price,
  r.futopt_change_percent as future_change_percent,
  r.futopt_total_volume as future_total_volume,
  case when r.future_open_price>0 and r.futopt_last_price>0
    then abs(r.futopt_last_price-r.future_open_price)/r.future_open_price*100 else null end as future_open_near_percent,
  coalesce(r.future_pattern='開盤回測守住',false) as future_open_retest_ok,
  case when r.future_pattern='開盤回測守住' then '期貨0845開盤後，0859前回到開盤價附近並守住'
    else 'DATA_GAP_OR_FUTURE_OPEN_RETEST_NOT_MET' end as future_open_retest_reason
from rules r;

grant select on public.v_fugle_daytrade_star_preopen_readback to anon, authenticated;
comment on view public.v_fugle_daytrade_star_preopen_readback is 'All current stock-futures near-one underlyings; same-day natural 08:45-08:59 evidence only; missing rows remain explicit and STAR fails closed.';
notify pgrst, 'reload schema';
commit;
