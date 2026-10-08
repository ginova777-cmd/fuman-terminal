'use strict';
// Isolated continuous phase boundaries. No R0-R6 history recovery and no formal IO.
const {OfflineStore,hash,bytes}=require('../integration/offline-store.cjs');
const digest=x=>hash(bytes(x));
class ContinuousPorts {
 constructor({coordinator,phase,sourceVersion,port,stop=()=>false,fault}){
  this.c=coordinator;this.phase=phase;this.stop=stop;this.fault=fault;this.receipts={};
  this.source={algorithm:sourceVersion,port};
 }
 check(){if(this.stop())throw Error('ADAPTER_STOP_BEFORE_PUBLISH');}
 record(phase,payload,dependencies=[]){
  this.check();const independent=new OfflineStore(this.c.directory);
  const envelope={contract:'phase234-continuous-port-v1',phase,identity:this.identity,
   previous_phase:phase===2?null:this.receipts[phase-1],payload,dependencies:[...new Set(dependencies)].sort()};
  if(phase>2){const parent=independent.get(envelope.previous_phase);if(parent.phase!==phase-1||digest(parent.identity)!==digest(this.identity))throw Error('PORT_CHAIN_IDENTITY');}
  const ref=this.c.store.put(envelope),readback=independent.get(ref);
  if(digest(readback)!==ref)throw Error('PORT_READBACK_HASH');
  for(const dep of readback.dependencies)independent.verifiedBytes(dep);
  this.receipts[phase]=ref;
  if(this.fault==='AFTER_PORT_'+phase)throw Error('CRASH_AFTER_PORT_'+phase);
  return ref;
 }
 phase2(x){
  const {frame,b,prior,changed,nextMeta}=x;
  this.identity={trade_date:frame.trade_date,epoch:frame.epoch,sequence:frame.sequence,intent_hash:digest(frame),
   baseline_hash:digest(b),source:this.source,previous_checkpoint:prior?digest(prior):null};
  this.p2={changed_symbols:Object.keys(changed).sort(),changed_minutes:x.changedMinutes,candle_symbols:x.candles,
   changed,checkpoint:nextMeta,resource_events:x.resourceEvents,revisions:x.revisions};
  this.record(2,this.p2,[...Object.values(changed),...Object.keys(changed).map(s=>nextMeta.lifecycle[s]).filter(Boolean)]);
  if(this.phase===2)return this.publishPartial(x,2);
 }
 phase3(x){
  this.record(3,{discovery:x.discovery,checkpoint:x.nextMeta.phase3,
   changed_symbols:this.p2.changed_symbols,changed_minutes:this.p2.changed_minutes},[x.nextMeta.phase3]);
  if(this.phase===3)return this.publishPartial(x,3);
 }
 publishPartial({frame,b,prior,changed,nextMeta},phase){
  this.check();const next={sequence:frame.sequence,txHash:digest({identity:this.identity,receipts:this.receipts}),
   sourceCursor:{status:frame.status,epoch:frame.epoch,sequence:frame.sequence,intent_hash:digest(frame)},
   symbols:{...b.symbols,...prior?.symbols,...changed},coordinator:nextMeta,
   continuous:{phase,identity:this.identity,receipts:{...this.receipts}},execution_mode:'CONTINUOUS_INCREMENTAL'};
  this.c.store.transaction(current=>{if(digest(current)!==digest(prior))throw Error('CONCURRENT_ROOT_CHANGED');return next;},{fault:this.fault});
  return {status:'ISOLATED_PHASE_COMMITTED',phase,root:next,notifications_sent:0};
 }
 wrapPublication(){
  const transaction=this.c.store.transaction.bind(this.c.store);
  this.c.store.transaction=(build,options)=>{this.check();return transaction(prior=>{
   const next=build(prior);
   if(this.phase===4){this.record(4,{result_hash:digest(next),checkpoint:next.sourceCursor,
     changed_symbols:this.p2.changed_symbols,changed_minutes:this.p2.changed_minutes},
     [...Object.values(next.strategy),...Object.values(next.telegram),...Object.values(next.pending),...Object.values(next.outbox)]);
    next.coordinator.continuous={phase:4,identity:this.identity,receipts:{...this.receipts}};
   }
   this.check();return next;
  },options);};
 }
 verify(root){
  const independent=new OfflineStore(this.c.directory),metadata=root.continuous||root.coordinator?.continuous;
  if(!metadata||metadata.phase!==this.phase)throw Error('PORT_ROOT_PHASE');
  const baseline=this.c.baseline();if(metadata.identity.baseline_hash!==digest(baseline)||metadata.identity.trade_date!==baseline.binding.payload.trade_date||metadata.identity.epoch!==baseline.binding.payload.epoch)throw Error('PORT_BASELINE_DRIFT');
  if(digest(metadata.identity.source)!==digest(this.source))throw Error('PORT_SOURCE_DRIFT');
  if(metadata.identity.epoch!==root.sourceCursor.epoch||metadata.identity.sequence!==root.sequence||metadata.identity.intent_hash!==root.sourceCursor.intent_hash)throw Error('PORT_ROOT_IDENTITY');
  for(let p=2;p<=this.phase;p++){
   const ref=metadata.receipts[p],record=independent.get(ref);
   if(record.phase!==p||record.contract!=='phase234-continuous-port-v1'||digest(record.identity)!==digest(metadata.identity)||record.previous_phase!==(p===2?null:metadata.receipts[p-1]))throw Error('PORT_CHAIN_IDENTITY');
   for(const h of record.dependencies)independent.verifiedBytes(h);
   if(p===4){const projected=structuredClone(root);delete projected.coordinator.continuous;if(record.payload.result_hash!==digest(projected))throw Error('PORT_RESULT_HASH');}
  }
  return metadata;
 }
}
module.exports={ContinuousPorts};
