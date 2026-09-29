'use strict';
const assert=require('assert/strict'),crypto=require('crypto');
const {receipt}=require('./test-morning-raw-evidence'),{collect,verify}=require('../lib/mother-pool-morning-module');
const source={};
for(const stage of ['us_0820','asia_0850']){const h=JSON.parse(JSON.stringify(receipt).replaceAll('us_0820',stage).replaceAll('AAPL',stage==='us_0820'?'AAPL':'7203.T').replaceAll('08:20',stage==='us_0820'?'08:20':'08:50').replaceAll('00:21:00','00:51:00'));
 h.source_evidence.rows_sha256=require('../lib/mother-pool-module-write-set').hash(h.source_evidence.rows);
 const readback=structuredClone(h);readback.checked_at='2026-09-08T01:00:00Z';
 source[stage]={handoff:h,readback,persistence:{contract:'opening-report-0830-mother-pool-persistence-ack-v1',complete:true,exitCode:0,trade_date:h.trade_date,report_run_id:h.report_run_id,checked_at:'2026-09-08T01:00:01Z'},refresh_files:[1,2].map(i=>{const text=JSON.stringify({contract:'opening-report-writer-pool-refresh-v1',trade_date:h.trade_date,operation:'priority_pool_upsert_and_prune',write_complete:true,writer_run_id:'w'+i,generation_id:'g'+i,completed_at:'2026-09-08T00:5'+(i+1)+':00Z',symbols:['2049','2308'],symbol_count:2});return {text,expected_sha256:crypto.createHash('sha256').update(text).digest('hex')};})};}
const identity={trade_date:'2026-09-08',canonical_run_id:'c',writer_run_id:'w',generation_id:'g',mother_pool_run_id:'m',snapshot_generation:'s',snapshot_sequence:1};
const build=s=>collect({identity,symbols:['2049','2308'],asOf:'2026-09-08T01:01:00Z',sourceEvidence:s});
const plans=build(source);for(const p of plans){assert(p.rows.every(r=>r.status==='READY'),JSON.stringify(p.rows[0].data_gap_reason));const round={...identity,observed_at:p.created_at,writer_write_set:{plan:{requested_symbols:p.requested_symbols,source_evidence:p.source_evidence}}};assert.equal(verify(p.module_id,p.rows,round),true);const altered=structuredClone(p.rows);altered[0].source_hash='bad';assert.equal(verify(p.module_id,altered,round),false);}
for(const mutate of [s=>delete s.us_0820.handoff.source_evidence,s=>s.asia_0850.refresh_files.pop(),s=>s.us_0820.refresh_files[0].expected_sha256='bad',s=>s.asia_0850.readback.accepted_symbols=['2049']]){const s=structuredClone(source);mutate(s);assert(build(s).find(p=>p.module_id==='A12').rows.every(r=>r.status==='DATA_GAP'));}
console.log('PASS morning fixed-module producers and verifier: both stages, two rounds, full symbol set, corrupt/missing evidence fail closed');
for(const value of [null,{},42,'2049']) {
 const s=structuredClone(source);s.us_0820.readback.accepted_symbols=value;
 assert(build(s).find(p=>p.module_id==='A12').rows.every(r=>r.status==='DATA_GAP'));
 const t=structuredClone(source);t.asia_0850.refresh_files=value;
 assert(build(t).find(p=>p.module_id==='A12').rows.every(r=>r.status==='DATA_GAP'));
 assert(build(t).find(p=>p.module_id==='A11').rows.every(r=>r.status==='READY'));
}
console.log('PASS malformed persistence arrays preserve A11 and record A12 DATA_GAP without crashing Writer');