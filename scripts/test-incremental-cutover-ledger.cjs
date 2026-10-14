'use strict';
const assert=require('assert/strict'),{assess}=require('../research/release/incremental-cutover-ledger.cjs');
const sha='a'.repeat(40),now='2026-10-14T14:00:00Z';const batch=(id,dependencies=[])=>({id,dependencies,modules:[id],release_sha:sha,dependency_review_complete:true});
const manifest={contract:'incremental_cutover_dependencies_v1',batches:[batch('runtime'),batch('a',['runtime']),batch('b',['runtime']),batch('a-child',['a'])]};
const record=id=>({release_sha:sha,installed_sha:sha,enabled:true,independent_verified:true,natural_pass:true,approval:{release_sha:sha,modules:[id],reviewer_approved:true,starts_at:'2026-10-14T13:00:00Z',ends_at:'2026-10-14T15:00:00Z'}});
const records=Object.fromEntries(manifest.batches.map(b=>[b.id,record(b.id)]));let n=0;
function test(name,f){f();console.log('PASS '+name);n++;}
test('local failure preserves independent successful batch',()=>{const r=assess(manifest,records,['a'],now);assert.equal(r[2].preserve_success,true);assert.equal(r[2].can_continue,true);assert.equal(r[3].state,'BLOCKED');});
test('shared runtime failure blocks all descendants',()=>assert(assess(manifest,records,['runtime'],now).every(r=>r.state==='BLOCKED')));
test('different SHA cannot borrow successful receipt',()=>{const r=structuredClone(records);r.b.release_sha='b'.repeat(40);assert.equal(assess(manifest,r,[],now)[2].preserve_success,false);});
test('expired approval cannot continue',()=>assert(assess(manifest,records,[],'2026-10-14T15:00:00Z').every(r=>!r.can_continue)));
test('unknown dependency cannot imply independence',()=>assert.throws(()=>assess({...manifest,batches:[batch('a',['missing'])]},records,[],now),/UNKNOWN_DEPENDENCY/));
test('cyclic dependencies fail closed',()=>assert.throws(()=>assess({...manifest,batches:[batch('a',['b']),batch('b',['a'])]},records,[],now),/CYCLE/));
test('unreviewed dependencies cannot authorize execution',()=>{const m=structuredClone(manifest);m.batches[2].dependency_review_complete=false;assert.equal(assess(m,records,[],now)[2].can_continue,false);});
test('deployed is not natural acceptance',()=>{const r=structuredClone(records);r.a.natural_pass=false;assert.equal(assess(manifest,r,[],now)[1].state,'ENABLED_NATURAL_PENDING');});
console.log(JSON.stringify({passed:n,formal_execution:false,scope:'Pure ledger decision logic only; not deployment or formal evidence verification'}));
