'use strict';
// Explicit isolated compatibility probes; no Collector flags or subscriptions.
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'mp-worker-profiles-'));
const limits={maxBatchEvents:128,maxBatchBytes:524288,maxEvents:1024,maxBytes:2097152,maxAgeMs:10000,minFreeBytes:1073741824,maxDiskBytes:16777216};
const {createBridge}=require('../../lib/mother-evidence-bridge.cjs');
const {createParentBridge}=require('../../lib/mother-evidence-parent.cjs');
const {createSink}=require('../../lib/mother-shadow-telemetry.cjs');
async function main(){
 const q=createBridge({dir:path.join(root,'quote'),kind:'quote',epoch:'isolated-quote',producerVersion:'ISOLATED',limits});
 const p=createParentBridge({dir:path.join(root,'parent'),epoch:'isolated-parent',producerVersion:'ISOLATED',limits});
 const sink=createSink({file:path.join(root,'telemetry.jsonl')});
 sink.write({event:'ISOLATED_PROFILE_CHECK'});
 const deadline=Date.now()+7000;
 while(Date.now()<deadline&&(q.status().state==='RUNNING'||q.status().state==='STOPPING'||p.status().state==='RUNNING'||!p.status().last_receipt))await new Promise(r=>setTimeout(r,50));
 const quote=await q.stop(),parent=await p.stop(),telemetry=await sink.close();
 assert.equal(quote.state,'BLOCKED');assert.equal(quote.stop_receipt_saved,true);
 assert.equal(parent.state,'BLOCKED');assert(parent.last_receipt);assert.equal(telemetry.monitor_gap,false);
 const result={status:'ISOLATED_COMPATIBILITY_PASS',root,quote,parent,telemetry,coverage:['evidence-worker missing recovery rejected','parent-worker missing recovery rejected','parent stop-only worker receipt','telemetry-worker append/close'],formal_enabled:false,natural:false};
 fs.writeFileSync(path.join(root,'receipt.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({status:result.status,root}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
