'use strict';
const assert=require('assert/strict'),{fixture}=require('./test-combination-independent'),{collect}=require('../lib/mother-pool-combination-producer'),{verify,verifySurfaces}=require('../lib/verify-mother-pool-combinations');
const f=fixture(),plan=collect(f),r={...f.identity,observed_at:f.asOf,writer_write_set:{plan}},db=plan.rows;
assert(verifySurfaces(db,structuredClone(db),r));let checked=1;
for(const mutate of [x=>x[0].events.pop(),x=>x[0].combinations.pop(),x=>x[0].event_count++,x=>x[0].combination_count++,x=>x[0].status='DATA_GAP',x=>x[0].data_gap_reason='missing',x=>x[0].data_gaps.push('gap'),x=>x[0].publish_allowed=true,x=>x[0].formal_candidate_allowed=true,x=>x[0].symbol='9999',x=>x.push(x[0])]){
 const anon=structuredClone(db);mutate(anon);assert.equal(verifySurfaces(db,anon,r),verify(db,r)&&verify(anon,r));assert(!verifySurfaces(db,anon,r));checked++;
}
const corrupt=structuredClone(r);delete corrupt.writer_write_set.plan.source_evidence.parents.B12;assert(!verifySurfaces(db,db,corrupt));checked++;
console.log(JSON.stringify({status:'PASS',checked,scope:'Both surfaces compared; independent parent recalculation retained once'}));
