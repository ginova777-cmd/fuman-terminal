'use strict';
// Bounded in-memory capture; no subscriptions, network requests or disk I/O.
// snapshot() is a point-in-time export, never a claim of durable publication.
const crypto=require('node:crypto');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function createCapture({connectionId,maxSymbols=2000,maxBytes=4*1024*1024}={}){
 if(typeof connectionId!=='string'||!connectionId)throw Error('CONNECTION_ID_REQUIRED');
 const journal=require('./mother-shared-water-native-journal.cjs').createJournal({connectionId,maxBytes});
 let authenticated=false,closed=false,bytes=0,lastError=null;
 const requested=new Set(),acks=new Map(),latest=new Map();
 const tradeRequested=new Set(),tradeAcks=new Map(),tradeHeads=new Map();let tradeBytes=0;
 function removeTrade(symbol){const old=tradeHeads.get(symbol);if(old)tradeBytes-=old.byte_length;tradeHeads.delete(symbol);}
 function remove(symbol){const old=latest.get(symbol);if(old)bytes-=old.byte_length;latest.delete(symbol);}
 function invalidate(reason){latest.clear();acks.clear();tradeAcks.clear();tradeHeads.clear();bytes=0;tradeBytes=0;lastError=reason;}
 return {
  request(channel,symbol){
   journal.request(channel,symbol);
   if(!/^\d{4}$/.test(symbol))return;
   if(channel==='aggregates'&&(requested.has(symbol)||requested.size<maxSymbols)){requested.add(symbol);acks.delete(symbol);remove(symbol);}
   if(channel==='trades'&&(tradeRequested.has(symbol)||tradeRequested.size<maxSymbols)){tradeRequested.add(symbol);tradeAcks.delete(symbol);removeTrade(symbol);remove(symbol);}
  },
  observe(message,receivedAt){
   journal.observe(message,receivedAt);
   if(closed)return false;
   if(!message||typeof message!=='object'||!Number.isFinite(Date.parse(receivedAt))){invalidate('UNPARSEABLE_NATIVE_MESSAGE');authenticated=false;return false;}
   if(message?.event==='authenticated'){authenticated=true;return false;}
   if(message?.event==='error'){invalidate('PROVIDER_ERROR');authenticated=false;return false;}
   if(!authenticated)return false;
   if(message?.event==='unsubscribed'){
    const ids=new Set((Array.isArray(message.data)?message.data:[message.data]).map(r=>r?.id));
    for(const [symbol,ack]of acks)if(ids.has(ack.id)){acks.delete(symbol);remove(symbol);}
    for(const [symbol,ack]of tradeAcks)if(ids.has(ack.id)){tradeAcks.delete(symbol);removeTrade(symbol);remove(symbol);}return false;
   }
   if(['subscribed','subscriptions'].includes(message?.event)){
    if(message.event==='subscriptions')invalidate('SUBSCRIPTIONS_REFRESHED');
    for(const r of Array.isArray(message.data)?message.data:[message.data]){
     if(r?.channel==='trades'&&tradeRequested.has(r.symbol)&&typeof r.id==='string'&&r.id&&r.intradayOddLot!==true){
      if(tradeAcks.get(r.symbol)?.id!==r.id){removeTrade(r.symbol);remove(r.symbol);}
      tradeAcks.set(r.symbol,{...structuredClone(r),received_at:receivedAt});continue;
     }
     if(r?.channel!=='aggregates'||!requested.has(r.symbol)||typeof r.id!=='string'||!r.id||r.intradayOddLot===true)continue;
     if(acks.get(r.symbol)?.id!==r.id)remove(r.symbol);
     acks.set(r.symbol,{...structuredClone(r),received_at:receivedAt});
    }return false;
   }
   const data=message?.data;
   if(message.channel==='trades'&&data&&!Array.isArray(data)&&tradeRequested.has(data.symbol)){
    const ack=tradeAcks.get(data.symbol);
    if(!ack||message.id!==ack.id||Date.parse(ack.received_at)>Date.parse(receivedAt)){remove(data.symbol);lastError='TRADE_SUBSCRIPTION_UNVERIFIED';return false;}
    if(data.isTrial===true)return false;
    if(!Number.isSafeInteger(data.time)||!Number.isSafeInteger(data.serial)||data.serial<0||!Number.isFinite(data.price)||data.price<=0||data.time/1000>Date.parse(receivedAt)){
     remove(data.symbol);removeTrade(data.symbol);lastError='NATIVE_TRADE_INVALID';return false;
    }
    const old=tradeHeads.get(data.symbol),payloadText=JSON.stringify(data);
    if(old){const previous=JSON.parse(old.raw_utf8).payload;
     if(data.serial===previous.serial&&payloadText===JSON.stringify(previous))return false;
     // Serial is used for ordering, never assumed to advance by one per stock.
     if(data.serial<=previous.serial||data.time<previous.time){remove(data.symbol);removeTrade(data.symbol);tradeAcks.delete(data.symbol);lastError='TRADE_ORDER_OR_SERIAL_CONFLICT';return false;}
    }
    const native={contract:'mother-native-trade-head-v1',symbol:data.symbol,trade_date:new Date(data.time/1000+28800000).toISOString().slice(0,10),connection_id:connectionId,subscription_id:ack.id,channel:'trades',received_at:receivedAt,is_synthetic:false,payload:structuredClone(data)};
    const raw=Buffer.from(JSON.stringify(native)),entry={symbol:data.symbol,raw_utf8:raw.toString('utf8'),raw_sha256:hash(raw),received_at:receivedAt};entry.byte_length=Buffer.byteLength(JSON.stringify(entry));
    if(raw.length>262144||bytes+tradeBytes-(old?.byte_length||0)+entry.byte_length>maxBytes){remove(data.symbol);removeTrade(data.symbol);lastError='CAPTURE_BYTE_LIMIT';return false;}
    removeTrade(data.symbol);tradeHeads.set(data.symbol,entry);tradeBytes+=entry.byte_length;
    const aggregate=latest.get(data.symbol);if(aggregate){const last=JSON.parse(aggregate.raw_utf8).payload.lastTrade;
     if(!last||data.time>last.time||data.time===last.time&&data.price!==last.price)remove(data.symbol);
    }
    return true;
   }
   // Only an explicitly identified aggregate channel is evidence; never infer
   // an auth response, trial, candle or trade packet as an aggregate.
   if((message?.channel||data?.channel)!=='aggregates'||!data||Array.isArray(data)||!requested.has(data.symbol))return false;
   const ack=acks.get(data.symbol);if(!ack||Date.parse(ack.received_at)>Date.parse(receivedAt))return false;
   if(message.id&&message.id!==ack.id)return false;
   const tradeHead=tradeHeads.get(data.symbol);
   if(tradeHead){const t=JSON.parse(tradeHead.raw_utf8).payload,last=data.lastTrade;
    if(!last||last.time<t.time||last.time===t.time&&last.price!==t.price){remove(data.symbol);lastError='AGGREGATE_BEHIND_TRADE_HEAD';return false;}
   }
   const native={contract:'mother-native-aggregate-evidence-v1',symbol:data.symbol,trade_date:data.date,connection_id:connectionId,subscription_id:ack.id,channel:'aggregates',received_at:receivedAt,is_synthetic:false,payload:structuredClone(data)};
   const raw=Buffer.from(JSON.stringify(native));if(raw.length>262144){lastError='NATIVE_RECORD_TOO_LARGE';remove(data.symbol);return false;}
   const rawHash=hash(raw);
   const transport={contract:'mother-transport-evidence-v1',symbol:data.symbol,trade_date:data.date,connection_id:connectionId,subscription_id:ack.id,continuity_basis:'fresh_native_aggregate_after_ack_same_connection',sequence_scope:'two_record_checkpoint_not_provider_serial',ack_payload:ack,
    events:[{sequence:1,kind:'ACK',symbol:data.symbol,channel:'aggregates',received_at:ack.received_at},{sequence:2,kind:'AGGREGATE',raw_sha256:rawHash,received_at:receivedAt}]};
   const transportBytes=Buffer.from(JSON.stringify(transport));
   const entry={symbol:data.symbol,raw_utf8:raw.toString('utf8'),raw_sha256:rawHash,transport_utf8:transportBytes.toString('utf8'),transport_sha256:hash(transportBytes),received_at:receivedAt};
   entry.byte_length=Buffer.byteLength(JSON.stringify(entry));
   const next=bytes-(latest.get(data.symbol)?.byte_length||0)+entry.byte_length;
   if(next+tradeBytes>maxBytes){lastError='CAPTURE_BYTE_LIMIT';remove(data.symbol);return false;}
   latest.set(data.symbol,entry);bytes=next;return true;
  },
  close(){journal.close();closed=true;authenticated=false;invalidate('CONNECTION_CLOSED');},
  snapshot(at,{symbols}={}){
   const selection=symbols?require('./mother-shared-water-capture-request.cjs').scope(symbols):null,allowed=selection?new Set(selection.requested_symbols):null;
   const observation=journal.snapshot(at,selection?.requested_symbols),selected=items=>structuredClone([...items.values()].filter(r=>!allowed||allowed.has(r.symbol)));
   return {contract:'mother-shared-water-capture-v1',connection_id:connectionId,captured_at:at,authenticated,closed,byte_length:bytes+tradeBytes+observation.byte_length,last_error:lastError,stored:false,rows:selected(latest),trade_heads:selected(tradeHeads),native_windows:observation.rows,continuity_verified:false,...(selection?{...selection,missing_symbols:selection.requested_symbols.filter(s=>!latest.has(s))}:{})};
  }
 };
}
module.exports={createCapture};
