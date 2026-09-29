'use strict';
const assert=require('node:assert/strict'),{invoke}=require('../lib/daytrade-rpc-observation');
(async()=>{
 for(const phase of ['request','response_body','json_decode']) {
  let calls=0,event; const failure=new Error('private body must not enter diagnostic');failure.name='AbortError';
  await assert.rejects(invoke({resource:'lease',send:async()=>{calls++;if(phase==='request')throw failure;return {status:200,ok:true,headers:{get:k=>k==='sb-request-id'?'rid':null},text:async()=>{if(phase==='response_body')throw failure;return 'invalid JSON';}};},onFailure:e=>event=e}));
  assert.equal(calls,1);assert.equal(event.phase,phase);assert.equal(event.execution_outcome,'unknown');assert.equal(event.retry_performed,false);assert(!JSON.stringify(event).includes('private'));
 }
 let evidence;await assert.rejects(invoke({resource:'lease',send:async()=>({status:503,ok:false,headers:{get:()=>null},text:async()=>'{"code":"PGRST002"}'}),onFailure:e=>evidence=e}));assert.equal(evidence.http_status,503);
 assert.deepEqual(await invoke({resource:'read',send:async()=>({status:200,ok:true,text:async()=>'[{"ok":true}]'})}),[{ok:true}]);
 console.log('PASS RPC phase/status/request ID diagnostics; no state-changing retries or secret/body diagnostics');
})().catch(e=>{console.error(e);process.exitCode=1;});
