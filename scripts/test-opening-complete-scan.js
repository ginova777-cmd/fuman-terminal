"use strict";
const assert=require('node:assert/strict');
const {extract,validateCache}=require('./read-opening-complete-scan');
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
assert.throws(()=>extract(truncated,receipt),/truncated/);
const stale=clone(snapshot);stale.tradeDate='20260910';
assert.throws(()=>extract(stale,receipt),/date mismatch/);
const empty=clone(snapshot);for(const p of Object.values(empty.payload.endpoints)){p.count=0;p.rows=[];}
assert.equal(extract(empty,receipt).strategy3.rows.length,0);
console.log('PASS date/run/cache/partial/truncation rejection and completed zero-result');
