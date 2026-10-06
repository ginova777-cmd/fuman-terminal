'use strict';
const assert=require('node:assert/strict'),{confirm}=require('../lib/mother-pool-publication-confirmation.cjs');
(async()=>{
 const row={verification_run_id:'r1',trade_date:'2026-10-06',canonical_run_id:'c',mother_pool_run_id:'m',generation:'g',snapshot_sequence:1,verified_at:'2026-10-06T03:00:00Z',complete:true,symbols_sha256:'a',snapshot_sha256:'b',snapshot_readback_sha256:'c',receipt_generation_verified:true,failed_checks:[],first_blocker:null};
 let reads=0;const ok=await confirm(row,async()=>{reads++;return [{...row,verified_at:'2026-10-06T11:00:00+08:00'}]});assert.equal(ok.status,'COMMITTED');assert.equal(reads,1);assert.equal(ok.resend_allowed,false);
 assert.equal((await confirm(row,async()=>[])).status,'NOT_FOUND_AT_READ_TIME');
 for(const patch of [{generation:'g2'},{snapshot_readback_sha256:'different'},{complete:false},{failed_checks:['x']},{verification_run_id:'other'}])assert.equal((await confirm(row,async()=>[{...row,...patch}])).status,'MISMATCH');
 assert.equal((await confirm(row,async()=>[row,row])).status,'MISMATCH');
 assert.equal((await confirm(row,async()=>{throw new Error('transport')})).status,'UNKNOWN');
 console.log('PASS publication confirmation: commit, empty, mismatch, duplicate, transport; no resend');
})().catch(e=>{console.error(e);process.exitCode=1});
