'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),{collect}=require('../lib/mother-pool-minute-side-batch');
const file=process.argv.find(x=>x.startsWith('--plan='))?.slice(7);if(!file)throw Error('--plan required');
const snapshot=JSON.parse(fs.readFileSync(file,'utf8')).authoritative_candidate;
const options={runtimeRoot:'C:/fuman-runtime',snapshot,asOf:'2026-09-17T13:00:00+08:00'};
const exhausted=collect({...options,deadlineMs:0});
assert.equal(exhausted.evaluated,0);assert.equal(exhausted.details.length,snapshot.symbols.length);
assert.ok(exhausted.details.every(x=>x.reason==='WRITER_BUDGET_EXHAUSTED'));
const actual=collect({...options,deadlineMs:Date.now()+30000});
assert.equal(actual.requested,actual.details.length);assert.equal(actual.complete,false);assert.equal(actual.publish_allowed,false);
assert.equal(actual.source_ready,actual.details.filter(x=>x.latest&&x.side_event_age_seconds<=120&&x.side_event_age_seconds>=0).length);
for(const row of actual.details.filter(x=>x.latest)){
 assert.equal(row.rolling_20m_rows.length,row.rolling_20m_observed_count);
 assert.equal(row.rolling_20m_missing_count,20-row.rolling_20m_observed_count);
 const end=Date.parse(row.latest.timestamp);
 assert(row.rolling_20m_rows.every(x=>Date.parse(x.timestamp)>=end-20*60000&&Date.parse(x.timestamp)<end));
 assert.equal(row.baseline_verified,false);
}
assert.throws(()=>collect({...options,snapshot:{...snapshot,canonical_run_id:'wrong'}}),/SNAPSHOT_INVALID/);
// Exercise independent arithmetic against historical source output. The role
// context below is simulated and is not evidence of a real Supabase query.
const verdict=require('../lib/verify-mother-pool-minute-side-batch').verify(actual,structuredClone(actual),{role:'anon',dbReadback:true});
assert.equal(verdict.readback_verified,true,JSON.stringify(verdict.failed_checks));
assert.equal(verdict.complete,false);
console.log(JSON.stringify({historical_readonly:true,requested:actual.requested,evaluated:actual.evaluated,
 source_ready:actual.source_ready,budget_rejection_test:'PASS',independent_arithmetic:'PASS',anon_context_simulated:true,actual_db_readback:false,runtime_written:false,complete:false}));
