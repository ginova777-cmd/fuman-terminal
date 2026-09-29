'use strict';
const assert=require('node:assert/strict');
const {writeWithAcknowledgement}=require('../lib/daytrade-source-status-ack');
const base={source_name:'fugle_daytrade_source',trade_date:'2026-09-29',updated_at:'2026-09-29T00:00:00.000Z',status:'ok',payload:{trade_date:'2026-09-29',canonical_run_id:'c',writer_run_id:'w',generation_id:'g',nested:{a:1,b:[2,3]}}};
const clone=x=>JSON.parse(JSON.stringify(x));
async function main(){
 let writes=0,reads=0;
 const good=await writeWithAcknowledgement({row:base,write:async()=>writes++,read:async()=>{reads++;return[];}});
 assert.equal(good.mode,'write_response');assert.equal(writes,1);assert.equal(reads,0);
 const timeout=async()=>{writes++;throw Object.assign(Error('timeout'),{name:'TimeoutError'});};
 for(const change of [r=>r,r=>{r.updated_at='2026-09-29T00:00:00+00:00';return r;},r=>{r.payload.nested={b:[2,3],a:1};return r;}]){
  writes=0;reads=0;
  const ack=await writeWithAcknowledgement({row:base,write:timeout,read:async()=>{reads++;return[change(clone(base))];}});
  assert.equal(ack.verified_after_timeout,true);assert.equal(writes,1);assert.equal(reads,1);
 }
 for(const change of [r=>{r.payload.writer_run_id='old';},r=>{r.payload.nested.a=9;},r=>{delete r.status;},r=>{r.updated_at='2026-09-28T00:00:00Z';}]){
  const bad=clone(base);change(bad);writes=0;
  await assert.rejects(writeWithAcknowledgement({row:base,write:timeout,read:async()=>[bad]}),/CONTENT_MISMATCH/);assert.equal(writes,1);
 }
 let diagnostic;
 const old=clone(base);old.payload.writer_run_id='older-round';old.payload.secret='must-not-log';
 await assert.rejects(writeWithAcknowledgement({row:base,write:timeout,read:async()=>[old],onMismatch:e=>{diagnostic=e;}}),/CONTENT_MISMATCH/);
 assert.equal(diagnostic.identity_matches,false);assert.equal(diagnostic.actual_identity.writer_run_id,'older-round');
 assert(!JSON.stringify(diagnostic).includes('must-not-log'));
 const same=clone(base);same.payload.nested.a=10;
 await assert.rejects(writeWithAcknowledgement({row:base,write:timeout,read:async()=>[same],onMismatch:e=>{diagnostic=e;}}),/CONTENT_MISMATCH/);
 assert.equal(diagnostic.identity_matches,true);
 const previous=clone(base);previous.payload.writer_run_id='previous';previous.payload.generation_id='previous-g';previous.updated_at='2026-09-28T23:59:50Z';
 writes=0;reads=0;const delays=[];
 const settled=await writeWithAcknowledgement({row:base,write:timeout,read:async()=>[++reads<3?previous:clone(base)],retryDelaysMs:[5000,10000],sleep:async ms=>delays.push(ms)});
 assert.equal(settled.verified_after_timeout,true);assert.equal(writes,1);assert.equal(reads,3);assert.deepEqual(delays,[5000,10000]);
 writes=0;reads=0;
 await assert.rejects(writeWithAcknowledgement({row:base,write:timeout,read:async()=>{reads++;return[previous];},retryDelaysMs:[0,0],sleep:async()=>{}}),/CONTENT_MISMATCH/);
 assert.equal(writes,1);assert.equal(reads,3);
 for(const bad of [same,{...previous,updated_at:'2026-09-29T00:00:01Z'},{...previous,trade_date:'2026-09-28'}]){
  reads=0;await assert.rejects(writeWithAcknowledgement({row:base,write:timeout,read:async()=>{reads++;return[bad];},retryDelaysMs:[0,0],sleep:async()=>{throw Error('must not wait');}}),/CONTENT_MISMATCH/);assert.equal(reads,1);
 }
 await assert.rejects(writeWithAcknowledgement({row:base,write:timeout,read:async()=>[],retryDelaysMs:[1,2,3]}),/RETRY_BUDGET_INVALID/);
 for(const rows of [[],[base,base]])await assert.rejects(writeWithAcknowledgement({row:base,write:timeout,read:async()=>rows}),/ROW_COUNT/);
 await assert.rejects(writeWithAcknowledgement({row:base,write:timeout,read:async()=>{throw Error('offline');}}),/READ_FAILED/);
 reads=0;await assert.rejects(writeWithAcknowledgement({row:base,write:async()=>{throw Error('HTTP 403');},read:async()=>{reads++;}}),/403/);assert.equal(reads,0);
 const missing=clone(base);delete missing.payload.generation_id;writes=0;
 await assert.rejects(writeWithAcknowledgement({row:missing,write:timeout,read:async()=>[base]}),/IDENTITY_MISSING/);assert.equal(writes,0);
 console.log('PASS: write success, exact timeout acknowledgement, identity/content mismatch, missing/duplicate/read failure, non-timeout and no write replay');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
