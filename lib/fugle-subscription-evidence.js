'use strict';
const CHANNELS=['trades','aggregates','candles'];
function create(connectionId,channels=CHANNELS){
 let authenticated=false,authenticatedAt=null,closedAt=null;
 const requested=new Map(),acknowledged=new Map(),market=new Map();
 const key=(channel,symbol)=>channel+'|'+symbol;
 function request(channel,symbol,at){
  if(!authenticated||closedAt||!channels.includes(channel)||!/^\d{4}$/.test(symbol)||!Number.isFinite(Date.parse(at)))return false;
  const k=key(channel,symbol);acknowledged.delete(k);
  requested.set(k,{channel,symbol,requested_at:at});return true;
 }
 function message(payload,at){
  if(!payload||!Number.isFinite(Date.parse(at))||closedAt)return;
  const event=payload.event;
  if(event==='authenticated'){authenticated=true;authenticatedAt=at;return;}
  if(event==='error'&&/auth|credential/i.test(String(payload.data?.message||''))){authenticated=false;authenticatedAt=null;requested.clear();acknowledged.clear();return;}
  if(!authenticated)return;
  if(event==='unsubscribed'){
   const values=Array.isArray(payload.data)?payload.data:[payload.data];
   for(const value of values)for(const [k,row] of acknowledged)if(value?.id===row.id)acknowledged.delete(k);
  }
  if(!['subscribed','subscriptions'].includes(event))return;
  if(event==='subscriptions')acknowledged.clear();
  for(const row of (Array.isArray(payload.data)?payload.data:[payload.data])){
   const k=key(row?.channel,row?.symbol),intent=requested.get(k);
   if(!intent||typeof row.id!=='string'||!row.id||row.intradayOddLot===true||Date.parse(at)<Date.parse(intent.requested_at))continue;
   acknowledged.set(k,{...intent,id:row.id,acknowledged_at:at});
  }
 }
 function marketMessage(channel,symbol,at){
  const k=key(channel,symbol),ack=acknowledged.get(k),ms=Date.parse(at);
  if(!authenticated||closedAt||!ack||!Number.isFinite(ms)||ms<Date.parse(ack.acknowledged_at))return false;
  const previous=market.get(k);if(previous&&ms<Date.parse(previous.received_at))return false;
  market.set(k,{channel,symbol,subscription_id:ack.id,received_at:at});return true;
 }
 function close(at){closedAt=at;authenticated=false;acknowledged.clear();}
 function snapshot(){return {contract:'fugle_subscription_ack_evidence_v1',connection_id:connectionId,authenticated,authenticated_at:authenticatedAt,closed_at:closedAt,
  market_messages:[...market.values()].filter(r=>acknowledged.get(key(r.channel,r.symbol))?.id===r.subscription_id&&Date.parse(r.received_at)>=Date.parse(acknowledged.get(key(r.channel,r.symbol)).acknowledged_at)),
  requested:[...requested.values()],acknowledged:[...acknowledged.values()],pending:[...requested.keys()].filter(k=>!acknowledged.has(k))};}
 return {request,message,marketMessage,close,snapshot};
}
module.exports={create};
