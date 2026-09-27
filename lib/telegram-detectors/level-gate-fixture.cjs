'use strict';
// Offline fixtures only; never used by runner or source loader.
const {evaluate,key,CONTRACT}=require('./level-cross-gate.cjs');
function fixture(){
 const date='2026-09-16',start=Date.parse(date+'T09:28:00+08:00');
 const bars=Array.from({length:31},(_,i)=>({stock_id:'3450',trade_date:date,timestamp:new Date(start+i*60000).toISOString(),open:100,high:i===30?101:100,low:100,close:i===30?101:100,complete:true,is_synthetic:false,timeframe:'1m'}));
 const event={stock_id:'3450',trade_date:date,timestamp:date+'T09:58:00+08:00',event_type:'VOLUME_ANOMALY_EVENT',primary_ratio:3,data_gap:false};
 const levelInput={stock_id:'3450',trade_date:date,available_at:date+'T08:50:00+08:00',previous_close:100,cost:null,open:null,previous_low:null,gaps:[]};
 const now=date+'T09:59:00+08:00',proof={event_id:key(event),event,bars,levelInput,now};
 return {event:{...event,gate:evaluate(proof)},proof,CONTRACT};
}
module.exports={fixture};
