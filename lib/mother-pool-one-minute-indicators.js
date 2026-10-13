'use strict';
const {calculate,PARAMETERS}=require('./telegram-detectors/level-cross-indicators.cjs');
const {build}=require('./mother-pool-detector-candle-source');
const CONTRACT='intraday_natural_1m_kd_rsi_macd_v1';
function row(symbol,bars,identity,asOf){
 let calculation=null,error=null;
 try{calculation=calculate({bars,stock_id:symbol,trade_date:identity.trade_date,as_of:asOf});}catch(e){error=e.message;}
 const last=calculation?.rows.at(-1),ready=last?.valid===true&&last.available_indicators?.length===3&&Date.parse(asOf)-Date.parse(last.timestamp)<=120000;
 return {symbol,status:ready?'READY':'DATA_GAP',data_gap_reason:ready?null:error||'NATURAL_1M_INDICATOR_WARMUP_OR_SOURCE_GAP',source:'Fugle.websocket.candles.TSE_OTC',source_contract:CONTRACT,source_updated_at:bars.at(-1)?.available_at||asOf,event_time:last?.timestamp||null,is_synthetic:false,replay:false,look_ahead:false,timeframe:'1m',parameters:PARAMETERS,kd:{k:last?.values?.k??null,d:last?.values?.d??null},rsi:{rsi5:last?.values?.rsi5??null,rsi15:last?.values?.rsi15??null},macd:{dif:last?.values?.dif??null,signal:last?.values?.signal??null},crosses:{golden:last?.golden||[],death:last?.death||[]},source_history:bars,formal_candidate_allowed:false,publish_allowed:false};
}
function collect({candles,identity,symbols,asOf}){
 const source=build({candles,tradeDate:identity.trade_date,canonicalRunId:identity.canonical_run_id,asOf});
 return {...identity,module_id:'B15',created_at:asOf,requested_symbols:[...symbols],rows:symbols.map(s=>{const r=row(s,source.groups.get(s)||[],identity,asOf);if(source.rejected.some(x=>x.symbol===s)){r.status='DATA_GAP';r.data_gap_reason='REJECTED_CANDLE_INPUT';}return r;})};
}
module.exports={CONTRACT,row,collect};
