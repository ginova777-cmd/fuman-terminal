'use strict';
function create(){
 const counts={messages:0,accepted_rows:0,empty_messages:0,missing_symbol:0,missing_time:0,invalid_close:0,unclassified:0};
 let last_received_at=null,last_accepted_event_at=null;
 const fields=['symbol','date','candleTime','time','open','high','low','close','volume','candles','data'];
 const shapes=[];
 function observe(payload,normalized,receivedAt){
  counts.messages++;last_received_at=receivedAt;counts.accepted_rows+=normalized.length;
  for(const row of normalized){const ms=Date.parse(row.candleTime);if(Number.isFinite(ms)&&(!last_accepted_event_at||ms>Date.parse(last_accepted_event_at)))last_accepted_event_at=new Date(ms).toISOString();}
  if(normalized.length)return;
  const data=payload?.data??payload??{},candidates=Array.isArray(data)?data:Array.isArray(data?.candles)?data.candles:Array.isArray(data?.data)?data.data:[data];
  if(!candidates.length){counts.empty_messages++;return;}
  const shape={event:['data','snapshot'].includes(payload?.event)?payload.event:'other',array:Array.isArray(data),fields:fields.filter(k=>Object.prototype.hasOwnProperty.call(data,k))};
  if(shapes.length<4&&!shapes.some(x=>JSON.stringify(x)===JSON.stringify(shape)))shapes.push(shape);
  // Fixed counters only. No raw values, credentials, per-stock maps or unbounded logs.
  for(const candidate of candidates){const row=candidate?.data||candidate||{};
   if(!/^\d{4}$/.test(String(row.symbol||'').replace(/\D/g,'').slice(0,4)))counts.missing_symbol++;
   else if(!(row.date||row.candleTime||row.time))counts.missing_time++;
   else if(!Number.isFinite(Number(row.close))||Number(row.close)<=0)counts.invalid_close++;
   else counts.unclassified++;
  }
 }
 function snapshot(){return {...counts,last_received_at,last_accepted_event_at,rejected_shapes:shapes.map(x=>({...x,fields:[...x.fields]}))};}
 return {observe,snapshot};
}
module.exports={create};
