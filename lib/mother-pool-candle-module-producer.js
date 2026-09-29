'use strict';
const {build}=require('./mother-pool-detector-candle-source');
const {b22}=require('./intraday-context-detectors-b19-b24');
function collect({candles,identity,symbols,asOf}) {
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
  const rangeBars=bars.filter(b=>Date.parse(b.timestamp)>=Date.parse(identity.trade_date+'T09:00:00+08:00')&&Date.parse(b.timestamp)<Date.parse(identity.trade_date+'T09:05:00+08:00'))
   .map(b=>({...b,symbol,synthetic:false,natural:true,completed:true}));
  const detection=b22({symbol,trade_date:identity.trade_date,canonical_run_id:identity.canonical_run_id,event_timestamp:asOf,current_price:latest?.close,opening_range_bars:rangeBars});
  const valid=detection.source_contract_ok&&!rejected&&fresh;
  plans.B22.push({...base,status:valid?'READY':'DATA_GAP',data_gap_reason:valid?null:'OPENING_RANGE_SOURCE_INCOMPLETE',
   opening_range:{valid:Boolean(valid),symbol,trade_date:identity.trade_date,as_of:asOf,bars:rangeBars,high:detection.orh,low:detection.orl},detector:detection});
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
