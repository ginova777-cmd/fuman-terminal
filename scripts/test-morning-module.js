'use strict';
// Artificial handoff inputs combined with retained terminals produced by real isolated Writer rounds.
// Fixture provenance is retained; this is not natural-market or current-candidate whole-round acceptance.
const assert=require('assert/strict');
const {collect,verify}=require('../lib/mother-pool-morning-module');
const source=require('./fixtures/morning/retained-writer-source.json').source;
const identity={trade_date:'2026-10-12',canonical_run_id:'c',writer_run_id:'w',generation_id:'g',mother_pool_run_id:'m',snapshot_generation:'s',snapshot_sequence:1};
const build=s=>collect({identity,symbols:['2049','2308'],asOf:'2026-10-12T02:06:00Z',sourceEvidence:s});
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
for(const mutate of [s=>s.us_0820.writer_terminals.pop(),s=>s.us_0820.writer_terminals[1]=structuredClone(s.us_0820.writer_terminals[0]),s=>s.us_0820.writer_terminals[0].receipt.hash='bad',s=>s.us_0820.writer_terminals[0].input.status='FAILED']){const s=structuredClone(source);mutate(s);assert(build(s).find(p=>p.module_id==='A12').rows.every(r=>r.status==='DATA_GAP'));}
console.log('PASS missing/duplicate/corrupt/failed real-terminal derivatives reject A12');
