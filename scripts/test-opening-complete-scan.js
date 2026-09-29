"use strict";
const assert=require('node:assert/strict');
const {extract,validateCache,validateStrategy4FullRun}=require('./read-opening-complete-scan');
const snapshot={tradeDate:'20260911',payload:{endpoints:{}}};
const receipt={ok:true,partial:false,write:{ok:true,tradeDate:'20260911'},summary:{}};
for(const key of ['strategy3','strategy4','strategy5','institution']){
 const endpoint=`/api/${key}-latest?limit=2000`;
 snapshot.payload.endpoints[endpoint]={ok:true,complete:true,publishAllowed:true,tradeDate:'20260911',runId:`${key}-run`,count:1,rows:[{code:'2330'}]};
 receipt.summary[endpoint]={ok:true,runId:`${key}-run`};
}
const sources=extract(snapshot,receipt);
validateCache({contract:'opening_complete_scan_readback_v1',sources},receipt);
const clone=x=>JSON.parse(JSON.stringify(x));
const wrong=clone(receipt);wrong.summary['/api/strategy3-latest?limit=2000'].runId='wrong';
assert.throws(()=>extract(snapshot,wrong),/run ID/);
assert.throws(()=>validateCache({contract:'opening_complete_scan_readback_v1',sources},wrong),/run ID/);
const partial=clone(snapshot);partial.payload.partial=true;
assert.throws(()=>extract(partial,receipt),/partial/);
const truncated=clone(snapshot);truncated.payload.endpoints['/api/strategy4-latest?limit=2000'].count=2001;
const truncatedSources=extract(truncated,receipt);
assert.equal(truncatedSources.strategy4.snapshotTruncated,true);
assert.equal(truncatedSources.strategy4.fullExport,false);
assert.throws(()=>validateCache({contract:'opening_complete_scan_readback_v1',sources:truncatedSources},receipt),/full export incomplete/);
const fullRows=[{run_id:'strategy4-run',scan_date:'2026-09-11',complete:true,code:'2330',rank:1,payload:{code:'2330',name:'台積電'}}];
assert.equal(validateStrategy4FullRun({run_id:'strategy4-run',status:'complete',complete:true,scan_date:'2026-09-11',result_count:1,expected_total:1,scanned_count:1,error_count:0},fullRows,'strategy4-run','20260911',1),true);
assert.throws(()=>validateStrategy4FullRun({run_id:'strategy4-run',status:'complete',complete:true,scan_date:'2026-09-11',result_count:2,expected_total:1,scanned_count:1,error_count:0},fullRows,'strategy4-run','20260911',2),/count mismatch/);
const stale=clone(snapshot);stale.tradeDate='20260910';
assert.throws(()=>extract(stale,receipt),/date mismatch/);
const empty=clone(snapshot);for(const p of Object.values(empty.payload.endpoints)){p.count=0;p.rows=[];}
assert.equal(extract(empty,receipt).strategy3.rows.length,0);
console.log('PASS date/run/cache/partial/truncation rejection and completed zero-result');
