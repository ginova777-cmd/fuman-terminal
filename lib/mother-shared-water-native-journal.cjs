'use strict';
// A bounded native observation window, not a claim about provider-side packet
// loss or an entire trading day. Source bytes are published before verification.
const {createHash}=require('node:crypto');
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function createJournal({connectionId,maxBytes=4*1024*1024,maxEventsPerSymbol=64}){
 const requested=new Set(),acks=new Map(),windows=new Map();let authenticated=false,closed=false,bytes=0,heartbeat=null;const heartbeatHistory=[];
 const key=(c,s)=>c+':'+s;
 function drop(symbol){const old=windows.get(symbol);if(old)bytes-=old.size;windows.delete(symbol);}
 function reset(){acks.clear();windows.clear();bytes=0;heartbeat=null;heartbeatHistory.length=0;authenticated=false;}
 function save(symbol,value){const size=Buffer.byteLength(JSON.stringify(value));const total=bytes-(windows.get(symbol)?.size||0)+size;if(total>maxBytes||value.events.length>maxEventsPerSymbol){drop(symbol);return false;}windows.set(symbol,{value,size});bytes=total;return true;}
 function append(w,raw,at){const previous=w.events.at(-1);const e={sequence:previous?previous.sequence+1:1,received_at:at,previous_sha256:previous?.sha256||null,raw:structuredClone(raw)};e.sha256=hash(e);w.events.push(e);}
 return {
  request(channel,symbol){if(['trades','aggregates'].includes(channel)){requested.add(key(channel,symbol));acks.delete(key(channel,symbol));drop(symbol);}},
  observe(raw,at){
   if(closed)return;
   if(!raw||typeof raw!=='object'||!Number.isFinite(Date.parse(at))){reset();return;}
   if(raw.event==='error'){reset();return;}
   if(raw.event==='authenticated'){authenticated=true;return;}
   if(!authenticated)return;
   if(raw.event==='heartbeat'){heartbeat={received_at:at,raw:structuredClone(raw)};heartbeatHistory.push(heartbeat);if(heartbeatHistory.length>128)heartbeatHistory.shift();return;}
   if(raw.event==='unsubscribed'){for(const r of Array.isArray(raw.data)?raw.data:[raw.data])for(const [k,a]of acks)if(a.raw.data.id===r?.id){acks.delete(k);drop(a.raw.data.symbol);}return;}
   if(['subscribed','subscriptions'].includes(raw.event)){
    if(raw.event==='subscriptions'){acks.clear();windows.clear();bytes=0;}
    for(const r of Array.isArray(raw.data)?raw.data:[raw.data])if(r&&requested.has(key(r.channel,r.symbol))&&typeof r.id==='string'&&r.id&&r.intradayOddLot!==true){drop(r.symbol);acks.set(key(r.channel,r.symbol),{received_at:at,raw:{event:raw.event,data:structuredClone(r)}});}return;
   }
   if(raw.event!=='data'||!['trades','aggregates'].includes(raw.channel))return;
   const p=raw.data,s=p?.symbol,ack=acks.get(key(raw.channel,s));
   if(!s||!ack||raw.id!==ack.raw.data.id){if(s)drop(s);return;}
   if(raw.channel==='aggregates'){
    const tradeAck=acks.get(key('trades',s));
    if(!tradeAck||p.isTrial===true||!Number.isSafeInteger(p.lastUpdated)||!Number.isSafeInteger(p.lastTrade?.time)){drop(s);return;}
    const w={contract:'mother-native-observation-window-v1',connection_id:connectionId,symbol:s,trade_date:p.date,aggregate_ack:structuredClone(ack),trade_ack:structuredClone(tradeAck),events:[]};append(w,raw,at);save(s,w);return;
   }
   const old=windows.get(s);if(!old)return;
   if(!Number.isSafeInteger(p.time)||!Number.isSafeInteger(p.serial)){drop(s);return;}
   const w=structuredClone(old.value);append(w,raw,at);save(s,w);
  },
  close(){closed=true;reset();},
  snapshot(at,symbols=null){
   const allowed=symbols?new Set(symbols):null;
   const rows=[];for(const {value}of windows.values()){
    if(allowed&&!allowed.has(value.symbol))continue;
    const evidence={...value,observed_until:at,heartbeat:structuredClone(heartbeat),heartbeat_history:structuredClone(heartbeatHistory.filter(h=>Date.parse(h.received_at)>=Date.parse(value.events[0].received_at))),closed,authenticated,event_count:value.events.length,head_sha256:value.events.at(-1).sha256};
    const raw=JSON.stringify(evidence);rows.push({symbol:value.symbol,raw_utf8:raw,raw_sha256:createHash('sha256').update(raw).digest('hex')});
   }
   return {rows,byte_length:bytes,scope:'native_observation_since_latest_aggregate'};
  }
 };
}
module.exports={createJournal};
