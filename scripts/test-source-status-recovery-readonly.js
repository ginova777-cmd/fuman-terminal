'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {prepare}=require('../lib/daytrade-source-status-journal'),{recover}=require('./recover-daytrade-source-status-ack-readonly');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'source-ack-recovery-'));
const base={source_name:'fugle_daytrade_source',trade_date:'2026-09-29',updated_at:'2026-09-29T01:00:00Z',payload:{trade_date:'2026-09-29',canonical_run_id:'canonical',writer_run_id:'writer',generation_id:'generation',data:[1,2]}};
(async()=>{
 let n=0;const checkpoint=()=>prepare(root,{...base,message:String(++n)});
 let calls=0,guarded=false;
 const cp=checkpoint(),expected=require('../lib/daytrade-source-status-journal').read(cp);
 const common={url:'https://example.supabase.co',key:'isolated-key',guard:async()=>{guarded=true;}};
 const result=await recover({...common,checkpoint:cp,fetchImpl:async(url,options)=>{
  calls++;assert.equal(guarded,true);assert.equal(options.method,'GET');assert.equal(options.redirect,'error');
  assert.equal(url.searchParams.get('payload->>writer_run_id'),'eq.writer');assert.equal(url.searchParams.get('limit'),'2');
  return {status:200,json:async()=>[expected]};
 }});
 assert.equal(calls,1);assert.equal(result.complete,false);assert.equal(result.scope,'source_status_write_only');
 await assert.rejects(recover({...common,checkpoint:cp}),/ACK_ALREADY_EXISTS/);
 const denied=checkpoint();await assert.rejects(recover({...common,checkpoint:denied,guard:async()=>{throw Error('GUARD_DENIED');},fetchImpl:async()=>{throw Error('UNEXPECTED_NETWORK');}}),/GUARD_DENIED/);
 for(const response of [{status:503},{status:200,json:async()=>[]},{status:200,json:async()=>[base]}]){
  const pending=checkpoint();await assert.rejects(recover({...common,checkpoint:pending,fetchImpl:async()=>response}));assert.equal(fs.existsSync(pending.file+'.ack.json'),false);
 }
 console.log('PASS explicit checkpoint recovery: guarded single GET, exact filters, no repeat read on ACK, no false ACK on HTTP/empty/content failure. Isolated; no network.');
})().catch(e=>{console.error(e);process.exitCode=1;});
