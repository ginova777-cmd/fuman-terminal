'use strict';
const fs=require('fs'),path=require('path');
const {ProductionAdapter}=require('./production-adapter.cjs'),{OfflineStore}=require('../integration/offline-store.cjs'),{digest}=require('../integration/coordinator.cjs');
const {sha}=require('./producer-handoff.cjs');
class TailConsumer {
 constructor({directory,env={},stop=()=>false}){this.directory=directory;this.stop=stop;this.adapter=new ProductionAdapter({directory,env,stop,port:{scope:'ISOLATED',contract:'phase234-file-port-v1',version:'live-tail-review-v1'}});}
 async run(tail,catalogue,{asOf,gate,plan=null,fault}={}){
  if(!this.adapter.enabled.some(Boolean))return {status:'OFF'};if(this.stop())return {status:'STOPPED'};
  const store=new OfflineStore(this.directory),lock=path.join(this.directory,'tail-run.lock'),fd=fs.openSync(lock,'wx');
  try{const page=tail.poll(catalogue);if(page.status!=='PAGE')return page;
   const root=store.root(),base=store.get(JSON.parse(fs.readFileSync(path.join(this.directory,'baseline.json'))).hash),old=root?store.get(root.sourceCursor.intent_hash):null;
   const events=page.page.rows.map(payload=>({type:tail.identity.kind==='candle'?'CANDLE':'QUOTE',symbol:String(payload.code||payload.symbol),payload,payload_sha256:digest(payload)}));
   if(events.length>5000)return {status:'BACKPRESSURE',reason:'CONSUMER_FRAME_EVENT_LIMIT',cursor_advanced:false};
   let frame={epoch:base.binding.payload.epoch,trade_date:base.binding.payload.trade_date,status:'OFFLINE_FIXED_SEGMENT',sequence:(root?.sequence||0)+1,asOf,events,gate,plan,feed_pages:[page.id],feed_binding:tail.identity.binding,feed_cursor:page.page.next};
   if(old?.feed_pages?.includes(page.id)){if(old.asOf!==asOf||digest(old.gate)!==digest(gate)||digest(old.plan)!==digest(plan))throw Error('TAIL_REPLAY_CONTEXT_CONFLICT');frame=old;}
   if(old?.feed_binding&&old.feed_binding!==tail.identity.binding)throw Error('TAIL_SOURCE_REBASE_REQUIRED');
   const result=await this.adapter.runIncremental(frame,{fault});if(!result.root)return result;
   if(fault==='AFTER_CONSUMER_BEFORE_ACK')throw Error('CRASH_AFTER_CONSUMER_BEFORE_ACK');
   const rootFile=path.join(this.directory,'root.json'),frameFile=path.join(this.directory,'objects',result.root.sourceCursor.intent_hash+'.json');
   const ack=tail.ack(page,{page_id:page.id,root_file:rootFile,frame_file:frameFile,root_hash:sha(fs.readFileSync(rootFile)),independent_readback:true},{fault});
   return {...result,tail_ack:ack,page_id:page.id,formal_verified:false};
  }finally{fs.closeSync(fd);fs.unlinkSync(lock);}
 }
 rollback(){return this.adapter.rollback();}
}
module.exports={TailConsumer};
