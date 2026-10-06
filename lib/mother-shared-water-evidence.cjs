'use strict';
// Pure bounded evidence resolver. Not yet connected to a production publisher.
// resolve(ref) must return immutable UTF-8 bytes from a trusted producer store.
// Hashes prove byte consistency, not authenticity of an arbitrary external store.
const {createHash}=require('node:crypto');
const sha=b=>createHash('sha256').update(b).digest('hex');
const ms=v=>typeof v==='string'&&/(Z|[+-]\d\d:\d\d)$/.test(v)?Date.parse(v):NaN;
const date=v=>Number.isFinite(v)?new Date(v+28800000).toISOString().slice(0,10):'';
function createVerifier({resolve,nowMs,maxBytes=262144}) {
 return function verifyEvidence(row,receipt) {
  const errors=[];let continuity=false,latest=false;const requireCheck=(ok,reason)=>{if(!ok)errors.push(reason);};
  const read=(ref,hash,contract)=>{
   if(typeof ref!=='string'||!ref||!/^[a-f0-9]{64}$/.test(hash||''))throw Error('REFERENCE_OR_HASH_INVALID');
   const bytes=resolve(ref);if(!Buffer.isBuffer(bytes)||bytes.length>maxBytes)throw Error('EVIDENCE_BYTES_INVALID');
   if(sha(bytes)!==hash)throw Error('EVIDENCE_HASH_MISMATCH');
   const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
   if(value.contract!==contract)throw Error('EVIDENCE_CONTRACT_MISMATCH');return value;
  };
  try {
   const now=nowMs();requireCheck(Number.isFinite(now),'CLOCK_INVALID');
   const separateFresh=receipt.contract_version==='1.1.0'&&row.source_status==='FRESH';
   requireCheck(row.trade_date===receipt.trade_date,'ROW_DATE_MISMATCH');
   requireCheck(row.source==='Fugle.websocket.aggregates','ROW_SOURCE_MISMATCH');
   const native=read(row.raw_evidence_ref,row.payload_sha256,'mother-native-aggregate-evidence-v1');
   const transport=read(row.transport_evidence_ref,row.transport_sha256,'mother-transport-evidence-v1');
   const publication=read(row.publication_evidence_ref,row.publication_sha256,'mother-publication-evidence-v1');
   for(const evidence of [native,transport,publication]) {
    requireCheck(evidence.symbol===row.symbol&&evidence.trade_date===receipt.trade_date,'EVIDENCE_IDENTITY_MISMATCH');
    requireCheck(typeof evidence.connection_id==='string'&&evidence.connection_id.length>0&&evidence.connection_id===native.connection_id,'CONNECTION_MISMATCH');
    requireCheck(typeof evidence.subscription_id==='string'&&evidence.subscription_id.length>0&&evidence.subscription_id===native.subscription_id,'SUBSCRIPTION_MISMATCH');
   }
   const payload=native.payload,received=ms(native.received_at),asof=ms(row.evidence_asof),until=ms(row.evidence_valid_until);
   requireCheck(Number.isFinite(received)&&received<=asof&&asof<=now&&until>now&&until<=asof+30000,'EVIDENCE_EXPIRED_OR_FUTURE');
   requireCheck(native.channel==='aggregates'&&payload?.symbol===row.symbol&&payload?.date===receipt.trade_date,'NATIVE_IDENTITY_MISMATCH');
   // Fugle documents isTrial as an optional true flag. Preserve omission in
   // raw bytes; lastTrade is the documented executed-trade object, not lastTrial.
   requireCheck(native.is_synthetic===false&&payload?.isTrial!==true&&(!Object.hasOwn(payload||{},'isTrial')||typeof payload.isTrial==='boolean'),'NATIVE_QUALITY_UNVERIFIED');
   const updated=payload?.lastUpdated,trade=payload?.lastTrade?.time;
   requireCheck(Number.isSafeInteger(updated)&&Number.isSafeInteger(trade),'NATIVE_MICROSECONDS_INVALID');
   requireCheck(date(trade/1000)===receipt.trade_date&&trade<=updated&&updated/1000<=received&&received-updated/1000<=30000,'NATIVE_LATEST_UNVERIFIED');
   requireCheck(Math.floor(trade/1000)===ms(row.last_trade_at),'LAST_TRADE_MISMATCH');
   requireCheck(Number.isFinite(payload?.lastTrade?.price)&&payload.lastTrade.price>0,'NATIVE_PRICE_INVALID');
   // The bounded segment must begin at an acknowledged subscription/recovery
   // checkpoint. A bare heartbeat or an ACK without a subsequent aggregate fails.
   const events=transport.events;
   requireCheck(Array.isArray(events)&&events.length>=2&&events.length<=2048,'TRANSPORT_SEGMENT_INVALID');
   if(Array.isArray(events)&&events.length>=2&&events.length<=2048){
    let previous=null;for(const e of events){
     const at=ms(e.received_at);
     requireCheck(Number.isSafeInteger(e.sequence)&&Number.isFinite(at)&&at<=asof,'TRANSPORT_EVENT_INVALID');
     if(previous)requireCheck(e.sequence===previous.sequence+1&&at>=ms(previous.received_at),'TRANSPORT_SEQUENCE_GAP');
     requireCheck(['ACK','RECOVERY_SNAPSHOT','HEARTBEAT','AGGREGATE'].includes(e.kind),'TRANSPORT_INTERRUPTED');
     previous=e;
    }
    requireCheck(['ACK','RECOVERY_SNAPSHOT'].includes(events[0].kind),'TRANSPORT_CHECKPOINT_MISSING');
    const last=events.at(-1);
    requireCheck(last.kind==='AGGREGATE'&&last.raw_sha256===row.payload_sha256&&ms(last.received_at)===received,'LATEST_AGGREGATE_NOT_BOUND');
    requireCheck(events[0].channel==='aggregates'&&events[0].symbol===row.symbol,'ACK_SCOPE_MISMATCH');
   }
   requireCheck(publication.raw_sha256===row.payload_sha256&&publication.writer_run_id===receipt.writer_run_id&&publication.generation===receipt.generation,'PUBLICATION_BATCH_MISMATCH');
   requireCheck(publication.reader_role==='anon'&&publication.row_count===1,'PUBLICATION_READBACK_MISSING');
   const written=ms(publication.write_completed_at),readback=ms(publication.readback_at);
   requireCheck(received<=written&&written<=readback&&readback<=asof,'PUBLICATION_TIME_INVALID');
   const db=publication.row;
   const readbackBytes=resolve(publication.readback_ref);
   requireCheck(Buffer.isBuffer(readbackBytes)&&readbackBytes.length<=4*1024*1024&&sha(readbackBytes)===publication.readback_bytes_sha256,'READBACK_BYTES_UNVERIFIED');
   if(Buffer.isBuffer(readbackBytes)&&readbackBytes.length<=4*1024*1024){
    const readbackRows=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(readbackBytes));
    const matched=Array.isArray(readbackRows)?readbackRows.filter(r=>r.symbol===row.symbol&&r.trade_date===receipt.trade_date):[];
    requireCheck(matched.length===1&&JSON.stringify(matched[0])===JSON.stringify(db),'READBACK_ROW_NOT_BOUND');
   }
   requireCheck(db?.symbol===row.symbol&&db?.trade_date===receipt.trade_date&&ms(db?.last_trade_time)===Math.floor(trade/1000)&&db?.price===payload?.lastTrade?.price,'PUBLICATION_VALUE_MISMATCH');
   const sameAggregate=publication.collector_head_sha256===row.payload_sha256;
   requireCheck(ms(publication.collector_head_checked_at)>=readback&&ms(publication.collector_head_checked_at)<=asof,'COLLECTOR_HEAD_TIME_INVALID');
   if(!separateFresh)requireCheck(sameAggregate,'NEWER_EVENT_UNPUBLISHED_OR_UNKNOWN');
   requireCheck(ms(publication.collector_capture_at)>readback&&ms(publication.collector_capture_at)<=ms(publication.collector_head_checked_at),'COLLECTOR_CAPTURE_NOT_AFTER_READBACK');
   if(publication.trade_head_status==='CAPTURED'){
    const head=read(publication.trade_head_ref,publication.trade_head_sha256,'mother-native-trade-head-v1'),p=head.payload;
    requireCheck(head.symbol===row.symbol&&head.trade_date===receipt.trade_date&&head.connection_id===native.connection_id&&head.channel==='trades'&&typeof head.subscription_id==='string'&&head.subscription_id.length>0,'TRADE_HEAD_IDENTITY_MISMATCH');
    requireCheck(head.is_synthetic===false&&p?.isTrial!==true&&p?.symbol===row.symbol&&Number.isSafeInteger(p?.time)&&Number.isSafeInteger(p?.serial)&&p.serial>=0&&Number.isFinite(p?.price)&&p.price>0,'TRADE_HEAD_INVALID');
    requireCheck(Number.isFinite(ms(head.received_at))&&p?.time/1000<=ms(head.received_at)&&ms(head.received_at)<=written&&date(p?.time/1000)===receipt.trade_date,'TRADE_HEAD_TIME_INVALID');
    const caughtUp=p?.time<=trade&&(p?.time!==trade||p?.price===payload?.lastTrade?.price);
    requireCheck(p?.time!==trade||p?.price===payload?.lastTrade?.price,'SAME_EVENT_PRICE_CONFLICT');
    const sameTrade=publication.trade_head_sha256===publication.collector_trade_head_sha256;
    latest=sameAggregate&&caughtUp&&sameTrade;
    if(!separateFresh){requireCheck(caughtUp,'AGGREGATE_BEHIND_TRADE_HEAD');requireCheck(sameTrade,'TRADE_HEAD_CHANGED_DURING_READBACK');}
   }else if(publication.trade_head_status==='NOT_CAPTURED'){
    latest=sameAggregate&&publication.collector_trade_head_sha256===null;
    if(!separateFresh)requireCheck(publication.collector_trade_head_sha256===null,'TRADE_ARRIVED_DURING_READBACK');
   }else requireCheck(false,'TRADE_HEAD_STATUS_MISSING');
   if(row.source_status==='NO_NEW_TRADE'){
    requireCheck(now-trade/1000>120000,'NOT_AN_IDLE_TRADE');
    if(!publication.native_window_ref)requireCheck(false,'NO_NEW_TRADE_CONTINUITY_UNPROVEN');
    else{
     const window=read(publication.native_window_ref,publication.native_window_sha256,'mother-native-observation-window-v1');
     const result=require('./mother-shared-water-window-verifier.cjs').verifyWindow(window,native,publication);
     continuity=result.verified;for(const code of result.failed_checks)requireCheck(false,code);
     // Quiet stocks may retain the same native aggregate for minutes. Their
     // short proof lifetime is bound to a NEW observation window and heartbeat,
     // never to a fabricated trade or refreshed aggregate receive timestamp.
     requireCheck(until<=ms(window.observed_until)+30000&&now-ms(window.heartbeat?.received_at)<=45000,'IDLE_OBSERVATION_EXPIRED');
    }
   }
   else {
    requireCheck(until<=(separateFresh?trade/1000+120000:received+60000),'FRESH_EVIDENCE_EXPIRED');
    requireCheck(row.source_status==='FRESH'&&now-trade/1000<=120000&&ms(row.quote_event_at)===Math.floor(trade/1000),'FRESH_TRADE_INVALID');
   }
  } catch(e){errors.push(e.message);}
  const verified=errors.length===0;
  return {verified,raw_hash_verified:verified,identity_verified:verified,native_event_verified:verified,publication_verified:verified,native_latest_verified:verified&&latest,pipeline_caught_up:verified&&latest,subscription_generation_verified:verified,continuity_verified:verified&&continuity,no_new_trade_verified:verified&&continuity&&row.source_status==='NO_NEW_TRADE',failed_checks:[...new Set(errors)],scope:'native_observation_since_latest_aggregate_not_all_day_trade_replay'};
 };
}
module.exports={createVerifier,sha};
