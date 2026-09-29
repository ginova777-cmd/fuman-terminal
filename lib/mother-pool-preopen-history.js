'use strict';
const {isDeepStrictEqual}=require('node:util');
const volume=require('./mother-pool-daily-volume-baseline');
const ohlc=require('./mother-pool-previous-ohlc');
const dateOf=t=>Number.isFinite(Date.parse(t))?new Date(Date.parse(t)+28800000).toISOString().slice(0,10):null;
const finite=n=>typeof n==='number'&&Number.isFinite(n);
function evaluate({symbol,tradeDate,daily,readAt,quote,master,history,asOf}){
 const gaps=[],now=Date.parse(asOf),prev=ohlc.evaluate(symbol,tradeDate,daily,readAt,asOf);
 const hm=Number.isFinite(now)?new Date(now+28800000).toISOString().slice(11,16):'';
 if(dateOf(asOf)!==tradeDate||hm<'06:00'||hm>='09:00')gaps.push('PREOPEN_OBSERVATION_INVALID');
 if(prev.status!=='READY')gaps.push('PREVIOUS_OHLC:'+prev.data_gap_reason);
 let baseline=null;try{baseline=volume.build({symbol,tradeDate,rows:daily?.rows||[],calendar:daily?.calendar});}catch{gaps.push('DAILY_CALENDAR_INVALID');}
 if(baseline?.status!=='READY')gaps.push('DAILY_VOLUME_BASELINE_INVALID');
 const avg5=baseline?.status==='READY'?baseline.avg_volume5:null;
 const avg3=avg5===null?null:baseline.rows.slice(-3).reduce((n,r)=>n+r.volume_lots,0)/3;
 const shares=master?.official_issued_common_shares;
 if(master?.stock_master_source!=='MOPS_OPEN_DATA_TWSE_TPEX'||master.official_present!==true||!finite(shares)||shares<=0
  ||!/^\d{4}-\d{2}-\d{2}$/.test(master.stock_master_source_date||'')||master.stock_master_source_date>tradeDate
  ||dateOf(master.stock_master_synced_at)!==tradeDate||Date.parse(master.stock_master_synced_at)>now)gaps.push('OFFICIAL_SHARES_INVALID');
 const last=baseline?.rows?.at(-1),turnover=!gaps.includes('OFFICIAL_SHARES_INVALID')&&baseline?.status==='READY'?last.volume_lots*1000/shares*100:null;
 const qt=quote?.payload?.quote_seen_at||quote?.updated_at,qa=(now-Date.parse(qt))/1000;
 const quoteDate=dateOf(qt),quoteMode=quoteDate===tradeDate?'current_day':quoteDate===prev.source_date?'previous_session_reference':null;
 if(quote?.symbol!==symbol||!quoteMode||!Number.isFinite(qa)||qa<0||!finite(quote.price)||quote.price<=0
  ||quote?.payload?.source!=='fugle-websocket-cache'||quote?.payload?.is_synthetic===true||quote?.is_synthetic===true)gaps.push('QUOTE_SOURCE_INVALID');
 const bars=(Array.isArray(history?.rows)?history.rows:[]).filter(r=>r.symbol===symbol&&r.trade_date===prev.source_date).sort((a,b)=>Date.parse(a.candle_time)-Date.parse(b.candle_time));
 if(history?.contract!=='daytrade_preopen_raw_rpc_evidence_v1'||history.observation_trade_date!==tradeDate||history.source_rpc!=='get_fugle_daytrade_intraday_1m_latest_n'
  ||!history.requested_symbols?.includes(symbol)||!Number.isFinite(Date.parse(history.observed_at))||Date.parse(history.observed_at)>now||!bars.length)gaps.push('HISTORICAL_K_MISSING');
 if(new Set(bars.map(b=>b.candle_time)).size!==bars.length)gaps.push('HISTORICAL_K_DUPLICATE');
 for(const b of bars){const t=Date.parse(b.candle_time),seen=Date.parse(b.payload?.sourceCandleSeenAt),hm=Number.isFinite(t)?new Date(t+28800000).toISOString().slice(11,16):'';
  if(b.source!=='fugle_daytrade_fast_sync:websocket_candles'||b.synthetic!==false||b.replay===true||b.look_ahead===true||b.volume_strategy_usable!==true||b.payload?.originalSource!=='fugle-ws-candles'||b.payload?.originalChannel!=='candles'||b.payload?.candleOrigin!=='websocket_candle'||b.payload?.is_synthetic===true
   ||!Number.isFinite(t)||t%60000!==0||dateOf(b.candle_time)!==prev.source_date||hm<'09:00'||hm>'13:29'||!Number.isFinite(seen)||seen<t+60000||seen>now
   ||!finite(b.volume)||b.volume<0||['open','high','low','close'].some(k=>!finite(b[k])||b[k]<=0)||b.high<Math.max(b.open,b.low,b.close)||b.low>Math.min(b.open,b.high,b.close))gaps.push('HISTORICAL_K_INVALID');
 }
 const failed=[...new Set(gaps)];
 return {source_date:prev.source_date,prev_open:prev.prev_open,prev_high:prev.prev_high,prev_low:prev.prev_low,prev_close:prev.prev_close,
  amplitude_pct:prev.prev_range_pct,amplitude_formula:'(previous_high-previous_low)/previous_close*100',avg_volume3_lots:avg3,avg_volume5_lots:avg5,
  reference_turnover_pct:turnover,turnover_formula:'previous_session_volume_lots*1000/current_official_issued_common_shares*100',issued_common_shares:finite(shares)?shares:null,
  quote_age_seconds:Number.isFinite(qa)?qa:null,quote_mode:quoteMode,quote_price:finite(quote?.price)?quote.price:null,
  history_bar_count:bars.length,k_age_seconds:bars.length?(now-Date.parse(bars.at(-1).candle_time))/1000:null,
  today_1m_requirement:'NOT_DUE_IN_PREOPEN',failed_checks:failed,status:failed.length?'DATA_GAP':'READY',data_gap_reason:failed.length?failed.join('|'):null};
}
function collect({identity,symbols,dailyVolumeMap,quoteMap,activeSymbols,rawEvidence,asOf}){
 const masters=new Map(activeSymbols.map(r=>[r.symbol,r.turnoverMaster]));
 const rows=symbols.map(symbol=>{const v=dailyVolumeMap.get(symbol),raw={symbol,tradeDate:identity.trade_date,daily:v?.daily_volume_evidence||null,readAt:v?.daily_ohlcv_read_at||null,quote:quoteMap.get(symbol)||null,master:masters.get(symbol)||null,
  history:rawEvidence?{...rawEvidence,rows:rawEvidence.rows?.filter(r=>r.symbol===symbol)}:null,asOf};
  return {symbol,...evaluate(raw),raw_evidence:raw,source:'Fugle.quote+strategy4_daily_ohlcv_view+MOPS+Fugle.persisted.websocket.candles',source_contract:'preopen_a07_quote_history_receipt_v1',source_updated_at:asOf,event_time:asOf,is_synthetic:false,replay:false,look_ahead:false};});
 return {...identity,module_id:'A07',created_at:asOf,requested_symbols:[...symbols],rows};
}
function verify(row,r){try{const raw=row.raw_evidence;if(raw.symbol!==row.symbol||raw.tradeDate!==r.trade_date||raw.asOf!==r.observed_at)return false;const expected=evaluate(raw);return expected.status==='READY'&&row.source_contract==='preopen_a07_quote_history_receipt_v1'&&Object.entries(expected).every(([k,v])=>isDeepStrictEqual(row[k],v));}catch{return false;}}
module.exports={collect,evaluate,verify};
