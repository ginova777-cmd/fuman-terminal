'use strict';
const assert=require('node:assert/strict'),{runBatch}=require('../lib/mother-pool-history-batch');
const symbols=['2303','2317','2330'],id='fixture';
const snapshot={contract:'daytrade_mother_pool_snapshot_v1',contract_version:'4.1.0',trade_date:'2026-09-17',canonical_run_id:'fugle_daytrade_source:20260917:canonical',
 mother_pool_run_id:id,snapshot_sequence:1,snapshot_type:'OPENING_SNAPSHOT',effective_at:'2026-09-17T01:00:00Z',complete:true,status:'complete',exit_code:0,first_blocker:null,
 symbols,symbol_count:3,removed_symbols:[],symbol_membership:symbols.map(symbol=>({symbol,mother_pool_run_id:id,mother_pool_snapshot_sequence:1,membership_status:'ACTIVE',membership_effective_at:'2026-09-17T01:00:00Z'}))};
(async()=>{
 const calls=[];const options={snapshot,asOf:'2026-09-17T09:00:00Z',maxRequests:1,fetchSymbol:async s=>{calls.push(s);return {status:'HISTORY_FETCHED'};}};
 const r=await runBatch({...options,readCached:async s=>s==='2303'?{status:'HISTORY_FETCHED'}:null});
 assert.deepEqual(calls,['2317']);assert.equal(r.reused,1);assert.equal(r.fetched,1);assert.equal(r.rows[2].status,'PENDING');assert.equal(r.complete,false);
 let count=0;const limited=await runBatch({...options,maxRequests:3,fetchSymbol:async()=>{count++;return {status:'DATA_GAP',reason:'HISTORY_RATE_LIMITED',http_status:429};}});
 assert.equal(count,1);assert.equal(limited.rows[1].reason,'UPSTREAM_BLOCKED');
 const corrupt=await runBatch({...options,readCached:async()=>{throw Error('corrupt');}});
 assert.equal(corrupt.attempted,0);assert(corrupt.rows.every(r=>r.reason==='CACHED_HISTORY_INVALID'));
 console.log('PASS history supply: validated cache skips requests, advances pending list, bounded limit, 429 stop and invalid cache isolation');
})().catch(e=>{console.error(e);process.exitCode=1;});
