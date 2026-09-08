-- Canonical STAR preopen readback contract. Supersedes and removes the
-- retired 2026-09-02 SQL filename so operators cannot apply an older path.
begin;

-- Full stock-futures roster.  This view intentionally retains excluded
-- contracts so readers can prove that selection was not limited to a fixed
-- symbol list, Mother Pool, display rank, or the first REST page.
create or replace view public.v_fugle_daytrade_star_universe_readback as
with clock as (
  select (now() at time zone 'Asia/Taipei')::date as trade_date
), normalized as (
  select
    c.trade_date,
    coalesce(nullif(t.underlying_symbol,''), nullif(t.payload->>'underlying_symbol',''), nullif(t.payload->>'underlyingSymbol','')) as underlying_symbol,
    coalesce(nullif(t.underlying_name,''), nullif(t.payload->>'underlying_name',''), nullif(t.payload->>'underlyingName','')) as underlying_name,
    upper(nullif(t.future_symbol,'')) as future_symbol,
    t.name as future_name,
    upper(coalesce(nullif(t.product,''), nullif(t.payload->>'product',''), 'STOCK_FUTURE')) as product,
    t.contract_type,
    case
      when nullif(t.end_date::text,'') ~ '^\d{4}-\d{2}-\d{2}$' then t.end_date::date
      when nullif(t.end_date::text,'') ~ '^\d{8}$' then to_date(t.end_date::text,'YYYYMMDD')
      when nullif(t.payload->>'CDate','') ~ '^\d{8}$' then to_date(t.payload->>'CDate','YYYYMMDD')
      else null
    end as contract_end_date,
    t.exchange,
    t.session,
    t.updated_at as contract_source_updated_at
  from public.futopt_tickers t
  cross join clock c
  where nullif(t.future_symbol,'') is not null
), stock_candidates as (
  select *
  from normalized
  where underlying_symbol ~ '^\d{4}$'
    and future_symbol not like 'TXF%'
    and product in ('S','STOCK_FUTURE')
), ranked as (
  select s.*,
    row_number() over (
      partition by underlying_symbol
      order by
        case when contract_end_date >= trade_date then 0 when contract_end_date is null then 1 else 2 end,
        contract_end_date asc nulls last,
        contract_source_updated_at desc nulls last,
        future_symbol asc
    ) as candidate_rank,
    count(*) over (partition by underlying_symbol) as candidate_count
  from stock_candidates s
)
select
  trade_date,
  underlying_symbol,
  coalesce(underlying_name, underlying_symbol) as underlying_name,
  future_symbol,
  future_name,
  product,
  contract_type,
  contract_end_date,
  exchange,
  session,
  candidate_rank,
  candidate_count,
  (candidate_rank=1 and contract_end_date is not null and contract_end_date>=trade_date) as selected_near_one,
  case when candidate_rank=1 and contract_end_date is not null and contract_end_date>=trade_date then 'selected' else 'excluded' end as selection_status,
  case
    when candidate_rank=1 and contract_end_date is not null and contract_end_date>=trade_date then null
    when contract_end_date is null then 'EXPIRY_MISSING'
    when contract_end_date<trade_date then 'EXPIRED'
    else 'DUPLICATE_LATER_EXPIRY'
  end as exclusion_reason,
  'earliest_non_expired_end_date'::text as selection_rule,
  contract_source_updated_at,
  contract_source_updated_at as resolved_at,
  underlying_symbol as symbol,
  future_symbol as fut_contract
from ranked;

create or replace view public.v_fugle_daytrade_star_preopen_readback as
with near_one as (
  select n.*
  from public.v_fugle_daytrade_star_universe_readback n
  where n.trade_date = (now() at time zone 'Asia/Taipei')::date
    and n.selected_near_one is true
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
    (array_agg(payload->>'websocket_quote_seen_at' order by captured_at asc) filter (where fut_price > 0 and capture_slot='0845'))[1] as future_open_source_event_at,
    (array_agg(fut_price order by captured_at desc) filter (where fut_price > 0))[1] as futopt_last_price,
    (array_agg(payload->>'websocket_quote_seen_at' order by captured_at desc) filter (where fut_price > 0))[1] as future_last_source_event_at,
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
    -- User removed the old trial-rise, limit-up-bid, and bid/ask-ratio hard
    -- gates.  Keep only usable auction evidence plus best bid >= trial.
    (trial_price>0 and reference_price>0
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
  (coalesce(future_pattern='開盤回測守住',false) and preopen_ok) as star_final_ok,
  case
    when future_symbol is null or future_symbol='' or future_symbol like 'TXF%' then 'NO_CONTRACT'
    when futopt_last_price<=0 then 'FUTURE_PRICE_MISSING'
    when preopen_snapshot_count=0 then 'NATURAL_FUTURE_PREOPEN_DATA_GAP'
    when future_open_price is null or futopt_last_price is null then 'NATURAL_FUTURE_PREOPEN_DATA_GAP'
    when futopt_change_percent is null or relative_to_txf_percent is null or futopt_total_volume is null then 'NATURAL_FUTURE_PREOPEN_DATA_GAP'
    when trial_price is null or trial_price<=0 then 'TRIAL_PRICE_MISSING'
    when reference_price is null or reference_price<=0 then 'REFERENCE_PRICE_MISSING'
    when best_bid_price is null or best_bid_price<=0 then 'BEST_BID_MISSING'
    else null end as data_gap_reason,
  case
    when future_pattern='開盤回測守住' and preopen_ok then 'STAR'
    when preopen_snapshot_count=0 or future_open_price is null or futopt_last_price is null then 'DATA_GAP｜期貨自然時槽缺資料'
    when trial_price is null or trial_price<=0 then 'DATA_GAP｜試撮價缺失'
    when reference_price is null or reference_price<=0 then 'DATA_GAP｜參考價缺失'
    when best_bid_price is null or best_bid_price<=0 then 'DATA_GAP｜最佳委買缺失'
    else 'NO_MATCH｜條件未通過' end as display_label,
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
    else 'DATA_GAP_OR_FUTURE_OPEN_RETEST_NOT_MET' end as future_open_retest_reason,
  coalesce(r.reference_price>0,false) as reference_price_ok,
  coalesce(r.trial_price>0,false) as trial_price_ok,
  case when r.reference_price>0 and r.trial_price>0 then 'ok' else 'DATA_GAP' end as preopen_evidence_status,
  case
    when r.reference_price is null or r.reference_price<=0 then 'REFERENCE_PRICE_MISSING'
    when r.trial_price is null or r.trial_price<=0 then 'TRIAL_PRICE_MISSING'
    else null end as preopen_data_gap_reason,
  si.identity_future_open_source_event_at as future_0845_source_event_at,
  si.identity_future_last_source_event_at as future_0859_source_event_at,
  si.identity_latest_payload->>'trial_event_at' as trial_event_at,
  si.identity_latest_payload->>'run_id' as run_id,
  si.identity_latest_payload->>'generation_id' as generation_id,
  case
    when future_symbol is null or future_symbol='' or future_symbol like 'TXF%'
      or futopt_last_price is null or futopt_last_price<=0
      or preopen_snapshot_count=0
      or future_open_price is null
      or futopt_change_percent is null or relative_to_txf_percent is null or futopt_total_volume is null
      or trial_price is null or trial_price<=0
      or reference_price is null or reference_price<=0
      or best_bid_price is null or best_bid_price<=0 then 'DATA_GAP'
    when coalesce(future_pattern='開盤回測守住',false) and preopen_ok then 'PASS'
    else 'NO_MATCH'
  end as strategy_result,
  case
    when trial_price>0 and reference_price>0 and best_bid_price<trial_price then 'BEST_BID_BELOW_TRIAL'
    when futopt_change_percent<2 then 'FUTURE_CHANGE_BELOW_2_PERCENT'
    when relative_to_txf_percent<1 then 'RELATIVE_TO_TXF_BELOW_1_PERCENT'
    when futopt_total_volume<50 then 'FUTURE_VOLUME_BELOW_50'
    when future_pattern is null then 'FUTURE_OPEN_RETEST_NOT_MET'
    else null end as strategy_no_match_reason
from rules r
left join (
  select
    trade_date,
    underlying_symbol,
    future_open_source_event_at as identity_future_open_source_event_at,
    future_last_source_event_at as identity_future_last_source_event_at,
    latest_payload as identity_latest_payload
  from snapshot_agg
) si on si.trade_date=r.trade_date and si.underlying_symbol=r.symbol;

grant select on public.v_fugle_daytrade_star_preopen_readback to anon, authenticated;
grant select on public.v_fugle_daytrade_star_universe_readback to anon, authenticated;
comment on view public.v_fugle_daytrade_star_universe_readback is 'Full anon-readable stock-futures contract roster. Exactly one valid non-expired near contract per underlying is selected; exclusions and reasons remain visible.';
comment on view public.v_fugle_daytrade_star_preopen_readback is 'All current stock-futures near-one underlyings; same-day natural 08:45-08:59 evidence only; missing rows remain explicit and STAR fails closed.';
notify pgrst, 'reload schema';
commit;
