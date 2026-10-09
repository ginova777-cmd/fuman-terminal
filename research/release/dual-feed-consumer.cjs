'use strict';
const fs=require('fs'),path=require('path');
const {ProductionAdapter}=require('./production-adapter.cjs');
const {OfflineStore}=require('../integration/offline-store.cjs');
const {digest}=require('../integration/coordinator.cjs');
const {sha,read}=require('./producer-handoff.cjs');
const {load}=require('./technical-control.cjs');
class DualFeedConsumer {
 constructor({directory,env,control}){this.directory=directory;this.control=control;this.adapter=new ProductionAdapter({directory,env,stop:()=>control.stopped(),port:{scope:'ISOLATED',contract:'phase234-file-port-v1',version:'dual-feed-v1'}});}
 async run({quote,candle,catalogues,barrierFile,asOf,gate,plan=null,fault}){
  if(!this.adapter.enabled.some(Boolean))return {status:'OFF'};
  this.control.check();if(this.control.stopped())return {status:'STOPPED'};
  const lock=path.join(this.directory,'dual-run.lock'),fd=fs.openSync(lock,'wx');
  try{
   const store=new OfflineStore(this.directory),root=store.root(),old=root?store.get(root.sourceCursor.intent_hash):null,base=store.get(JSON.parse(fs.readFileSync(path.join(this.directory,'baseline.json'))).hash);
   const seal=load(barrierFile),binding={quote:quote.identity.binding,candle:candle.identity.binding};
   if(seal.contract!=='dual-feed-barrier-v1'||seal.gap||sha(seal.binding)!==sha(binding)||seal.trade_date!==quote.identity.trade_date||seal.trade_date!==candle.identity.trade_date||seal.owner!==this.control.id||seal.asOf!==asOf||!Number.isSafeInteger(seal.generation)||seal.generation<1)throw Error('BARRIER_IDENTITY');
   if(old?.dual&&sha(old.dual.binding)!==sha(binding))throw Error('DUAL_REBASE_REQUIRED');
   if(old?.dual&&seal.generation<old.dual.generation)throw Error('BARRIER_REGRESSION');
   if(old?.dual?.barrier_hash===sha(seal)){if(old.asOf!==asOf||digest(old.gate)!==digest(gate)||digest(old.plan)!==digest(plan))throw Error('REPLAY_CONTEXT');return {...await this.adapter.runIncremental(old),dual_ack:'REPLAY_DEDUP'};}
   if(old?.dual&&seal.generation===old.dual.generation)throw Error('BARRIER_CONFLICT');
   const pages={},cursors={},events=[];
   for(const kind of ['quote','candle']){
    const tail=kind==='quote'?quote:candle,start=old?.dual?.cursors[kind]||tail.cursor(),target=seal.targets[kind];
    if(!target||!Number.isSafeInteger(target.sequence)||target.sequence<start.sequence)throw Error('BARRIER_TARGET');
    const catBytes=read(catalogues[kind]),cat=JSON.parse(catBytes);if(sha(catBytes)!==seal.catalogue_hashes[kind]||cat.published_through!==target.sequence)throw Error('BARRIER_CATALOGUE');
    let cursor=start,count=0,bytes=0;pages[kind]=[];
    while(cursor.sequence<target.sequence){if(this.control.stopped())return {status:'STOPPED'};
     const view=Object.create(tail);view.cursor=()=>cursor;const p=view.poll(catalogues[kind]);
     if(p.status!=='PAGE')return {status:'WAIT_BOTH_FEEDS',feed:kind,reason:p.status};
     bytes+=p.page.bytes;if(++count>16||bytes>64*1048576||events.length+p.page.events.length>5000)return {status:'BACKPRESSURE'};
     pages[kind].push(p);cursor=p.page.next;for(const e of p.page.events)events.push({kind,event:e});
    }
    if(cursor.sequence!==target.sequence||cursor.commit_hash!==target.commit_hash)throw Error('BARRIER_COMMIT');cursors[kind]=cursor;
   }
   // Logical order only: quote before candle, then source sequence/ordinal as read.
   // No assertion that two independent provider channels have a global event-time order.
   const frame={epoch:base.binding.payload.epoch,trade_date:base.binding.payload.trade_date,status:'OFFLINE_FIXED_SEGMENT',sequence:(root?.sequence||0)+1,asOf,gate,plan,
    events:events.map(({kind,event:e})=>({type:kind==='quote'?'QUOTE':'CANDLE',symbol:String(e.payload.code||e.payload.symbol),payload:e.payload,payload_sha256:digest(e.payload)})),
    dual:{binding,generation:seal.generation,barrier_hash:sha(seal),cursors,order:'QUOTE_THEN_CANDLE_SOURCE_ORDER',page_ids:Object.fromEntries(Object.entries(pages).map(([k,v])=>[k,v.map(p=>p.id)]))}};
   for(const v of Object.values(pages))for(const p of v)for(const proof of p.page.proofs)if(sha(read(proof.file,8*1048576))!==proof.sha256)throw Error('SOURCE_CHANGED');
   if(this.control.stopped())return {status:'STOPPED'};
   const result=await this.adapter.runIncremental(frame,{fault});if(!result.root)return result;
   // Both source cursors live in the immutable frame referenced by the single Consumer root.
   const verified=store.root(),input=store.get(verified.sourceCursor.intent_hash);
   if(digest(input.dual)!==digest(frame.dual))throw Error('DUAL_READBACK');
   if(fault==='AFTER_DUAL_COMMIT')throw Error('CRASH_AFTER_DUAL_COMMIT');
   return {...result,dual_ack:'ATOMIC_ROOT_VERIFIED',watermark:input.dual,formal_verified:false};
  }finally{fs.closeSync(fd);fs.unlinkSync(lock);}
 }
}
module.exports={DualFeedConsumer};
