'use strict';
const {build}=require('./mother-pool-detector-candle-source');
const tongzi=require('./mother-pool-tongzi');
function collect({candles,identity,symbols,asOf,tradesBySymbol={}}) {
 const source=build({candles,tradeDate:identity.trade_date,canonicalRunId:identity.canonical_run_id,asOf});
 if(!Array.isArray(symbols)||new Set(symbols).size!==symbols.length)throw Error('INVALID_REQUESTED_UNIVERSE');
 const plans={B01:[],B22:[],B23:[]};
 for(const symbol of symbols){
  const bars=source.groups.get(symbol)||[],latest=bars.at(-1);
  const rejected=source.rejected.some(r=>r.symbol===symbol);
  const fresh=latest&&Date.parse(asOf)-Date.parse(latest.timestamp)<=120000;
  const base={symbol,source:'Fugle.websocket.candles.TSE_OTC',source_contract:'natural_completed_candle_v1',source_updated_at:latest?.available_at||asOf,
   source_missing:!latest,is_synthetic:false,replay:false,look_ahead:false,event_time:latest?.timestamp||null};
  plans.B01.push({...base,status:fresh&&!rejected?'READY':'DATA_GAP',data_gap_reason:rejected?'REJECTED_CANDLE_INPUT':!fresh?'NATURAL_CANDLE_MISSING_OR_STALE':null,
   candle:latest||null,volume:latest?.volume_raw??null,volume_unit:latest?.volume_raw_unit??null});
  const reference=bars.find(b=>Date.parse(b.timestamp)===Date.parse(identity.trade_date+'T09:01:00+08:00'))||null;
  let result=null,reason=null;
  try{result=tongzi.evaluate({symbol,trade_date:identity.trade_date,bar:reference,trades:tradesBySymbol[symbol]||[],completedBars:bars,asOf});}catch(e){reason=e.message;}
  plans.B22.push({...base,source_contract:tongzi.CONTRACT,status:result&&!rejected&&result.trade_evidence_status==='AVAILABLE'&&!result.data_gaps.length?'READY':'DATA_GAP',data_gap_reason:result&&!rejected&&result.trade_evidence_status==='AVAILABLE'&&!result.data_gaps.length?null:reason||result?.data_gaps.join('|')||(result?.trade_evidence_status!=='AVAILABLE'?'B22_NATIVE_TRADE_INPUT_UNAVAILABLE':'REJECTED_CANDLE_INPUT'),
   tongzi:result,reference_bar:reference,trade_evidence:tradesBySymbol[symbol]||[],completed_bars:bars});
  const start=Date.parse(identity.trade_date+'T09:00:00+08:00');
  const continuous=bars.length>0&&bars.every((b,i)=>Date.parse(b.timestamp)===start+i*60000);
  const pointReady=Boolean(fresh&&!rejected&&continuous&&Date.parse(latest.timestamp)+60000===Math.floor(Date.parse(asOf)/60000)*60000);
  const high=pointReady?Math.max(...bars.map(b=>b.high)):null,low=pointReady?Math.min(...bars.map(b=>b.low)):null;
  plans.B23.push({...base,source_contract:'intraday_point_in_time_extremes_v1',status:pointReady?'READY':'DATA_GAP',data_gap_reason:pointReady?null:'POINT_IN_TIME_FULL_SESSION_BARS_REQUIRED',
   event_time:asOf,
   bars_through_event:bars,current_price:latest?.close??null,day_high_so_far:high,day_low_so_far:low,
   distance_from_high_pct:pointReady?(latest.close-high)/high*100:null,distance_from_low_pct:pointReady?(latest.close-low)/low*100:null,
   new_high:pointReady?latest.close>=high:null,new_low:pointReady?latest.close<=low:null});
 }
 return Object.entries(plans).map(([module_id,rows])=>({...identity,module_id,created_at:asOf,requested_symbols:[...symbols],rows}));
}
module.exports={collect};
