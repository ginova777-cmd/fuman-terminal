'use strict';
const {build}=require('./mother-pool-detector-candle-source');
const SOURCE='Fugle.websocket.candles.TSE_OTC';
function evaluate(bars,symbol,tradeDate,asOf,rejected=false){
 const now=Date.parse(asOf),window=bars.slice(-20),gaps=[];
 if(!Number.isFinite(now)||new Date(now+28800000).toISOString().slice(0,10)!==tradeDate)gaps.push('MA20_OBSERVATION_TIME_INVALID');
 if(rejected)gaps.push('REJECTED_CANDLE_INPUT');
 if(window.length!==20)gaps.push('TWENTY_COMPLETED_BARS_REQUIRED');
 if(window.some((b,i)=>b.stock_id!==symbol||b.trade_date!==tradeDate||b.source!==SOURCE||b.complete!==true||b.is_synthetic!==false||!Number.isFinite(Date.parse(b.timestamp))||!Number.isFinite(Date.parse(b.available_at))||Date.parse(b.available_at)>now||Date.parse(b.available_at)<Date.parse(b.timestamp)+60000||Date.parse(b.timestamp)+60000>now||new Date(Date.parse(b.timestamp)+28800000).toISOString().slice(0,10)!==tradeDate||typeof b.close!=='number'||!Number.isFinite(b.close)||b.close<=0||(i&&Date.parse(b.timestamp)-Date.parse(window[i-1].timestamp)!==60000)))gaps.push('INVALID_OR_MISSING_NATURAL_BAR');
 const latest=window.at(-1);
 if(window.some(b=>{const t=Date.parse(b.timestamp);if(!Number.isFinite(t))return true;const hm=new Date(t+28800000).toISOString().slice(11,16);return hm<'09:00'||hm>'13:29'||t%60000!==0||['open','high','low','close'].some(k=>typeof b[k]!=='number'||!Number.isFinite(b[k])||b[k]<=0)||b.high<Math.max(b.open,b.close,b.low)||b.low>Math.min(b.open,b.close,b.high);}))gaps.push('MA20_BAR_PRICE_OR_SESSION_INVALID');
 if(!latest||now-Date.parse(latest.timestamp)>120000)gaps.push('MA20_WINDOW_STALE');
 return {valid_bar_count:window.length,ma20:gaps.length?null:window.reduce((n,b)=>n+b.close,0)/20,bar_end:latest?.timestamp||null,ready:gaps.length===0,data_gaps:gaps};
}
function validateSnapshot(snapshot,identity,symbols,asOf){
 if(!require('./daytrade-mother-pool-snapshot').inspectSnapshot(snapshot,identity.trade_date).ok||snapshot.canonical_run_id!==identity.canonical_run_id||snapshot.mother_pool_run_id!==identity.mother_pool_run_id||snapshot.generation!==identity.snapshot_generation||snapshot.snapshot_sequence!==identity.snapshot_sequence||Date.parse(snapshot.effective_at)>Date.parse(asOf)||snapshot.symbols.length!==symbols.length||symbols.some(s=>!snapshot.symbols.includes(s)))throw Error('MA20_SNAPSHOT_UNIVERSE_MISMATCH');
}
function collect({identity,symbols,candles,asOf,snapshot}){
 if(!Array.isArray(symbols)||!symbols.length||new Set(symbols).size!==symbols.length)throw Error('INVALID_MA20_UNIVERSE');
 validateSnapshot(snapshot,identity,symbols,asOf);
 const source=build({candles,tradeDate:identity.trade_date,canonicalRunId:identity.canonical_run_id,asOf});
 const rows=symbols.map(symbol=>{
  const bars=(source.groups.get(symbol)||[]).slice(-20),rejected=source.rejected.filter(x=>x.symbol===symbol);
  const result=evaluate(bars,symbol,identity.trade_date,asOf,rejected.length>0);
  return {symbol,...result,source:SOURCE,source_contract:'preopen_a08_ma20_receipt_v1',source_updated_at:bars.at(-1)?.available_at||asOf,event_time:asOf,
   natural_bars:bars,rejected_inputs:rejected,status:result.ready?'READY':'DATA_GAP',data_gap_reason:result.ready?null:result.data_gaps.join('|'),is_synthetic:false,replay:false,look_ahead:false};
 });
 const ready=rows.filter(x=>x.ready).map(x=>x.symbol),missing=symbols.filter(x=>!ready.includes(x)),coverage=ready.length/symbols.length*100;
 const coverageRows=rows.map(row=>({...row,source_contract:'preopen_a09_ma20_coverage_receipt_v1',status:coverage>=90?'READY':'DATA_GAP',data_gap_reason:coverage>=90?null:'MA20_COVERAGE_BELOW_90',ready_count:ready.length,checked_count:symbols.length,coverage_pct:coverage,threshold_pct:90,not_ready_symbols:missing}));
 return [{module_id:'A08',rows},{module_id:'A09',rows:coverageRows}].map(p=>({...identity,...p,created_at:asOf,requested_symbols:[...symbols],source_evidence:{snapshot}}));
}
module.exports={collect,evaluate,SOURCE,validateSnapshot};
