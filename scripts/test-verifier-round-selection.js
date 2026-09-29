'use strict';
const assert=require('node:assert/strict'),{select}=require('../lib/mother-pool-select-verifier-rounds');
const row=(id,minute)=>({file:id,value:{writer_run_id:id,generation_id:'g'+id,snapshot_generation:'s'+id,mother_pool_run_id:'m'+id,observed_at:`2026-09-29T00:${minute}:00Z`}});
const a=row('a','00'),b=row('b','01'),c=row('c','02');
assert.deepEqual(select([a,b,c]).map(x=>x.file),['b','c']);
assert.deepEqual(select([a,b,c],'a').map(x=>x.file),['a','c']);
assert.deepEqual(select([a,b,c],'missing'),[]);
for(const field of ['generation_id','snapshot_generation','mother_pool_run_id']){
 const copy=structuredClone(b);copy.value[field]=a.value[field];
 assert.deepEqual(select([a,copy],'a').map(x=>x.file),['a']);
}
assert.deepEqual(select([a,structuredClone(a)],'a').map(x=>x.file),['a']);
console.log('PASS verifier selection: recovered Writer must participate, two distinct rounds, chronological order, no older-pair substitution');
