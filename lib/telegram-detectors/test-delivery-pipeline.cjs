'use strict';
const assert = require('assert/strict');
const {run,digest}=require('./delivery-pipeline.cjs');
const {verify}=require('./verify-delivery-closure.cjs');
const batch={run_id:'test-only',source_run_id:'captured-source',trade_date:'2026-09-16',mode:'live'};
const events=[{stock_id:'3450',trade_date:batch.trade_date,timestamp:'2026-09-16T09:58:00+08:00',side_volume_timestamp:'2026-09-16T09:58:59+08:00',event_type:'RAW_OUTSIDE_STRENGTH_EVENT',raw_outside_strength:2,data_gap:false}];
const proof={run_id:batch.run_id,trade_date:batch.trade_date,complete:true,live_point_in_time_proven:true,events_sha256:digest(events),failed_checks:[],ready_counts:{volume:1,price:1,outside:1}};
async function fixture(overrides={}){let db=null,sends=0;const result=await run({batch,events,now:'2026-09-16T09:59:00+08:00',verifySource:async()=>proof,store:async(k,p)=>{db=JSON.parse(JSON.stringify(p));},readback:async()=>db,targetCount:2,send:async()=>{sends++;return[{sent:true,target_hash:'a',message_id:1},{sent:true,target_hash:'b',message_id:2}];},...overrides});return{result,db,sends};}
(async()=>{
 let f=await fixture();assert.equal(f.result.integration_complete,true);assert.equal(f.result.complete,false);assert.equal(f.result.deliveries[0].confirmed_count,2);
 f=await fixture({batch:{...batch,mode:'replay'}});assert.equal(f.sends,0);assert.equal(f.result.notification_status,'replay_not_sent');
 f=await fixture({verifySource:async()=>({...proof,events_sha256:'wrong'})});assert.equal(f.sends,0);assert.equal(f.result.integration_complete,false);
 f=await fixture({readback:async()=>({wrong:true})});assert.equal(f.sends,0);assert.equal(f.result.db_readback_ok,false);
 f=await fixture({targetCount:0});assert.equal(f.sends,0);assert(f.result.failed_checks.includes('NO_DELIVERY_TARGETS'));
 f=await fixture({send:async()=>[{sent:true},{sent:false,reason:'duplicate'}]});assert.equal(f.result.integration_complete,false);assert.equal(f.result.notifications_sent,0);
 f=await fixture({now:'2026-09-16T12:31:00+08:00'});assert.equal(f.sends,0);
 f=await fixture({now:'2026-09-16T10:05:00+08:00'});assert.equal(f.sends,0);assert(f.result.failed_checks.includes('EVENT_REJECTED_BY_NOTIFIER'));
 f=await fixture();const s={rendered:true,run_id:batch.run_id,trade_date:batch.trade_date,events_sha256:digest(events),event_count:1,screenshot_sha256:'test-screenshot',url:'http://localhost/test'};
 const input={record:f.result,db:f.db,sourceProof:proof,surfaces:{desktop:s,mobile:s,scorecard:s},expectedDate:batch.trade_date,expectedRunId:batch.run_id};
 assert.equal(verify(input).complete,true);
 assert.equal(verify({...input,surfaces:{}}).complete,false);
 assert.equal(verify({...input,expectedDate:'2026-09-17'}).complete,false);
 assert.equal(verify({...input,record:{...f.result,mode:'replay',complete:true}}).complete,false);
 assert.equal(verify({...input,record:{...f.result,deliveries:[]}}).complete,false);
 assert.equal(verify({...input,sourceProof:{...proof,live_point_in_time_proven:false}}).complete,false);
 console.log('PASS 14 delivery/DB/replay/stale/target/tri-surface/independent-closure scenarios; no network');
})().catch(e=>{console.error(e);process.exitCode=1;});
