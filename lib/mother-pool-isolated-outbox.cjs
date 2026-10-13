'use strict';
// Isolated durable B16/B24 adapter. There is deliberately no network transport.
const fs=require('node:fs'),path=require('node:path');
const {writeExclusive}=require('./daytrade-durable-json');
const {hash,identityFields}=require('./mother-pool-module-write-set');
const {combine}=require('./mother-pool-directional-combinations');
const policy=require('./mother-pool-b24-cooldown');
const adapter=require('./mother-pool-b16-combination-adapter');
function requireOk(value,code){if(!value)throw Error(code);}
function load(file){return fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null;}
function immutable(file,value){const old=load(file);if(old){requireOk(hash(old)===hash(value),'IMMUTABLE_RECORD_CONFLICT');return false;}writeExclusive(file,value);return true;}
function verifySource(writeSet,verifier){
 requireOk(writeSet?.module_id==='B24'&&writeSet.plan_hash===hash(writeSet.plan)&&writeSet.ack?.committed===true&&writeSet.ack.plan_hash===writeSet.plan_hash,'B24_ACK_REQUIRED');
 requireOk(verifier?.ok===true&&verifier.plan_hash===writeSet.plan_hash&&identityFields.every(k=>verifier[k]===writeSet[k]),'B24_VERIFIER_BINDING_REQUIRED');
 requireOk(identityFields.every(k=>writeSet[k]!=null),'B24_IDENTITY_REQUIRED');
 requireOk(Array.isArray(writeSet.plan.rows)&&Array.isArray(writeSet.plan.data_gap_symbols)&&writeSet.plan.data_gap_symbols.length===0&&writeSet.plan.rows.every(r=>r.status==='READY'),'B24_SOURCE_GAP');
}
async function run({directory,writeSet,verifier,asOf,sink,fault=null,eventReceipt=null,evidenceRoot=null,currentFile=null,clock=()=>new Date().toISOString()}){
 const monotonicStart=performance.now();
 requireOk(sink?.kind==='isolated'&&typeof sink.deliver==='function','ISOLATED_SINK_REQUIRED');
 if(eventReceipt){
  asOf=clock();
  const E=require('./mother-pool-event-evidence.cjs'),receipt=E.read(evidenceRoot,eventReceipt);
  requireOk(receipt.contract==='b24_event_verified_v1'&&receipt.status==='EVENT_VERIFIED','EVENT_VERIFIER_RECEIPT_REQUIRED');
  const actual=require('./verify-mother-pool-event.cjs').verify({root:evidenceRoot,bundleRef:receipt.bundle_ref,currentFile,now:asOf});
  requireOk(hash({...actual,verified_at:receipt.verified_at})===hash(receipt)&&Date.parse(receipt.verified_at)<=Date.parse(asOf),'EVENT_RECEIPT_CHANGED');
  // The original immutable receipt is retained; this adapter object is not a fabricated ACK or Proof.
  verifier=receipt;
  writeSet={...receipt.identity,plan_hash:eventReceipt.sha256,plan:{rows:[{symbol:receipt.symbol,events:actual.events}]}};
 }else verifySource(writeSet,verifier);
 requireOk(Number.isFinite(Date.parse(asOf)),'INVALID_CLOCK');
 fs.mkdirSync(directory,{recursive:true});
 const lock=path.join(directory,'round.lock');let fd;
 try{fd=fs.openSync(lock,'wx');}catch(e){if(e.code==='EEXIST')throw Error('OUTBOX_LOCK_REQUIRES_REVIEW');throw e;}
 try{
  fs.writeFileSync(fd,JSON.stringify({contract:'isolated_outbox_lock_v1',scope:'TEST_ONLY',pid:process.pid,token:require('node:crypto').randomUUID(),created_at:new Date().toISOString()}));fs.fsyncSync(fd);
  const identity=Object.fromEntries(identityFields.map(k=>[k,writeSet[k]]));
  const root=path.join(directory,hash([identity.trade_date,identity.canonical_run_id]));fs.mkdirSync(root,{recursive:true});
  const eventsDir=path.join(root,'events'),intentsDir=path.join(root,'intents');fs.mkdirSync(eventsDir,{recursive:true});fs.mkdirSync(intentsDir,{recursive:true});
  immutable(path.join(root,'source-'+writeSet.plan_hash+'.json'),{writeSet,verifier});
  for(const row of writeSet.plan.rows)for(const event of row.events||[]){
   requireOk(event.event_id&&event.symbol===row.symbol&&event.trade_date===identity.trade_date&&event.canonical_run_id===identity.canonical_run_id&&event.source_contract_ok===true&&Number.isFinite(Date.parse(event.event_timestamp))&&Date.parse(event.event_timestamp)<=Date.parse(asOf),'INVALID_EVENT_SOURCE');
   // Original event content is immutable; each round retains its own provenance.
   immutable(path.join(eventsDir,hash(event.event_id)+'.json'),event);
   immutable(path.join(root,hash([event.event_id,writeSet.plan_hash])+'.json'),{event_id:event.event_id,identity,source_plan_hash:writeSet.plan_hash});
  }
  // Retain historical events for audit, but only the independently verified occurrence is eligible now.
  const events=eventReceipt?verifier.events:fs.readdirSync(eventsDir).filter(n=>n.endsWith('.json')).map(n=>load(path.join(eventsDir,n)));
  const results=[];
  for(const combination of combine(events,{asOf})){
   const members=combination.event_sequence.map(x=>events.find(e=>e.event_id===x.event_id));
   const initial=policy.decide({events:members,now:asOf,qualityGate:true,notifierEligible:combination.eligible_for_notifier,freshnessPassed:true});
   if(!initial.key){results.push({reason:initial.reason});continue;}
   const previousRecords=fs.readdirSync(intentsDir).filter(n=>n.endsWith('.intent.json')).map(n=>load(path.join(intentsDir,n))).filter(x=>x.key===initial.key);
   const unresolved=previousRecords.some(x=>load(path.join(intentsDir,x.occurrence_id+'.attempt.json'))&&!load(path.join(intentsDir,x.occurrence_id+'.ack.json')));
   const delivered=previousRecords.map(x=>load(path.join(intentsDir,x.occurrence_id+'.ack.json'))).filter(Boolean).sort((a,b)=>Date.parse(a.sent_at)-Date.parse(b.sent_at));
   const decision=policy.decide({events:members,now:asOf,qualityGate:true,notifierEligible:combination.eligible_for_notifier,freshnessPassed:true,previous:delivered.at(-1)||null,deliveredOccurrenceIds:delivered.map(x=>x.occurrence_id),unresolvedDelivery:unresolved});
   if(!decision.allowed){results.push({occurrence_id:decision.occurrence_id,reason:decision.reason});continue;}
   const prepared=await adapter.prepare({combinations:[combination],events,asOf,policy:{decide:()=>decision}});
   if(prepared.intents.length!==1){results.push({reason:prepared.blocked[0]?.reason||'INTENT_REJECTED'});continue;}
   if(eventReceipt){
    const enqueueTime=clock();
    require('./verify-mother-pool-event.cjs').verify({root:evidenceRoot,bundleRef:verifier.bundle_ref,currentFile,now:enqueueTime});
    requireOk(Date.parse(enqueueTime)>=Date.parse(asOf),'CLOCK_REGRESSION');asOf=enqueueTime;
   }
   const base=path.join(intentsDir,decision.occurrence_id);
   const intent={...decision,intent:prepared.intents[0]};immutable(base+'.intent.json',intent);
   const enqueuedAt=eventReceipt?clock():asOf;
   const enqueuedMs=performance.now()-monotonicStart;
   if(fault==='after_intent')throw Error('INJECTED_AFTER_INTENT');
   writeExclusive(base+'.attempt.json',{occurrence_id:decision.occurrence_id,attempted_at:asOf});
   if(fault==='after_attempt')throw Error('INJECTED_AFTER_ATTEMPT');
   let ack;try{ack=await sink.deliver(intent);}catch(e){results.push({occurrence_id:decision.occurrence_id,reason:'DELIVERY_OUTCOME_UNKNOWN'});continue;}
   if(fault==='after_delivery')throw Error('INJECTED_AFTER_DELIVERY');
   if(ack?.confirmed!==true||ack.occurrence_id!==decision.occurrence_id||ack.sink!=='isolated'){results.push({occurrence_id:decision.occurrence_id,reason:'DELIVERY_OUTCOME_UNKNOWN'});continue;}
   const sinkAckAt=eventReceipt?clock():asOf;
   writeExclusive(base+'.ack.json',{key:decision.key,occurrence_id:decision.occurrence_id,event_ids:decision.event_ids,status:'delivered',sent_at:sinkAckAt,sink_ack:ack});
   if(fault==='after_ack')throw Error('INJECTED_AFTER_ACK');
   results.push({occurrence_id:decision.occurrence_id,status:'ISOLATED_ACKED',enqueued_at:enqueuedAt,sink_ack_at:sinkAckAt,enqueued_ms:enqueuedMs,sink_ack_ms:performance.now()-monotonicStart});
  }
  const receipt={contract:'mother_pool_isolated_durable_outbox_v1',identity,source_plan_hash:writeSet.plan_hash,event_count:events.length,results,formal_execution:false,telegram_sent:0};
  writeExclusive(path.join(root,'round-'+require('node:crypto').randomUUID()+'.json'),receipt);
  return receipt;
 }finally{fs.closeSync(fd);fs.unlinkSync(lock);}
}
module.exports={run,verifySource};
