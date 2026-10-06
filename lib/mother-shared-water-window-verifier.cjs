'use strict';
const {createHash}=require('node:crypto');
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const ms=x=>typeof x==='string'&&/(Z|[+-]\d\d:\d\d)$/.test(x)?Date.parse(x):NaN;
function verifyWindow(w,native,publication){
 const errors=[],check=(ok,code)=>{if(!ok)errors.push(code);};
 check(w.contract==='mother-native-observation-window-v1'&&w.connection_id===native.connection_id&&w.symbol===native.symbol&&w.trade_date===native.trade_date,'WINDOW_IDENTITY');
 const end=ms(w.observed_until),start=ms(native.received_at);
 check(w.authenticated===true&&w.closed===false&&Number.isFinite(end)&&end===ms(publication.collector_capture_at)&&end>ms(publication.readback_at),'WINDOW_NOT_AFTER_READBACK');
 const ackIds={};
 for(const [channel,ack]of [['aggregates',w.aggregate_ack],['trades',w.trade_ack]]){
  const p=ack?.raw?.data;check(['subscribed','subscriptions'].includes(ack?.raw?.event)&&p?.channel===channel&&p?.symbol===native.symbol&&typeof p?.id==='string'&&p.id.length>0&&p.intradayOddLot!==true&&Number.isFinite(ms(ack?.received_at))&&ms(ack.received_at)<=start,'WINDOW_ACK_INVALID');ackIds[channel]=p?.id;
 }
 check(ackIds.aggregates===native.subscription_id,'WINDOW_AGGREGATE_SUBSCRIPTION');
 const hb=ms(w.heartbeat?.received_at);
 check(w.heartbeat?.raw?.event==='heartbeat'&&w.heartbeat.raw.data&&Number.isFinite(hb)&&hb>=start&&hb<=end&&end-hb<=45000,'WINDOW_HEARTBEAT_INVALID');
 // A recent last heartbeat alone cannot establish continuous observation of a
 // quiet symbol. Bounded history must cover the aggregate anchor through now.
 const beats=w.heartbeat_history;
 if(!Array.isArray(beats)||beats.length<1||beats.length>128)check(false,'WINDOW_HEARTBEAT_HISTORY_MISSING');
 else{
  let previous=start;
  for(const beat of beats){const t=ms(beat.received_at);check(beat.raw?.event==='heartbeat'&&beat.raw.data&&Number.isFinite(t)&&t>=previous&&t<=end&&t-previous<=45000,'WINDOW_HEARTBEAT_GAP');previous=t;}
  check(JSON.stringify(beats.at(-1))===JSON.stringify(w.heartbeat)&&end-previous<=45000,'WINDOW_HEARTBEAT_HISTORY_TAIL');
 }
 const events=w.events;
 if(!Array.isArray(events)||events.length<1||events.length>64||w.event_count!==events.length)return {verified:false,failed_checks:[...errors,'WINDOW_COUNT_INVALID']};
 let previous=null,lastTrade=null;
 for(let i=0;i<events.length;i++){
  const e=events[i],copy={...e};delete copy.sha256;
  check(e.sha256===hash(copy)&&e.sequence===i+1&&e.previous_sha256===(previous?.sha256||null),'WINDOW_CHAIN_INVALID');
  const at=ms(e.received_at),raw=e.raw,p=raw?.data;
  check(Number.isFinite(at)&&at>=start&&at<=end&&(!previous||at>=ms(previous.received_at)),'WINDOW_TIME_INVALID');
  check(raw?.event==='data'&&p?.symbol===native.symbol,'WINDOW_EVENT_INVALID');
  if(i===0){check(raw?.channel==='aggregates'&&raw.id===ackIds.aggregates&&at===start&&JSON.stringify(p)===JSON.stringify(native.payload),'WINDOW_ANCHOR_MISMATCH');}
  else{
   check(raw?.channel==='trades'&&raw.id===ackIds.trades&&Number.isSafeInteger(p?.time)&&Number.isSafeInteger(p?.serial)&&p.serial>=0&&p.time/1000<=at,'WINDOW_TRADE_INVALID');
   check(!Object.hasOwn(p||{},'isTrial')||typeof p.isTrial==='boolean','WINDOW_TRIAL_FLAG_INVALID');
   if(p?.isTrial!==true){
    check(Number.isFinite(p?.price)&&p.price>0&&p.time<=native.payload.lastTrade.time&&(p.time!==native.payload.lastTrade.time||p.price===native.payload.lastTrade.price),'WINDOW_NEWER_TRADE');
    if(lastTrade)check(p.serial>lastTrade.serial&&p.time>=lastTrade.time||p.serial===lastTrade.serial&&JSON.stringify(p)===JSON.stringify(lastTrade),'WINDOW_TRADE_ORDER');
    lastTrade=p;
   }
  }
  previous=e;
 }
 check(w.head_sha256===events.at(-1).sha256,'WINDOW_HEAD_MISMATCH');
 return {verified:errors.length===0,failed_checks:[...new Set(errors)],scope:'native_observation_since_latest_aggregate'};
}
module.exports={verifyWindow};
