'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const {verify}=require('./verify-mother-pool-history-supply');
const arg=n=>process.argv.find(x=>x.startsWith('--'+n+'='))?.slice(n.length+3);
const source=JSON.parse(fs.readFileSync(arg('snapshot'),'utf8')),snapshot=source.authoritative_candidate||source;
const receipt=JSON.parse(fs.readFileSync(arg('receipt'),'utf8'));
assert.equal(verify(receipt,snapshot).exit_code,0);
for(const mutate of [r=>r.snapshot_sequence++,r=>r.rows.pop(),r=>r.rows[0].sha256='0'.repeat(64),r=>r.fetched++,r=>r.rows[0].rows++,r=>r.rows[0].symbol='9999',r=>r.rows[0].http_status=500]){
 const bad=structuredClone(receipt);mutate(bad);assert.equal(verify(bad,snapshot).exit_code,1);
}
assert.equal(verify(receipt,snapshot,{readFile:()=>{throw Error('unreadable');}}).exit_code,1);
assert.equal(verify(receipt,snapshot).complete,false);
console.log('PASS independent historical readback rejects mixed snapshot, truncation, hash/count/symbol/HTTP corruption and unreadable artifacts');
