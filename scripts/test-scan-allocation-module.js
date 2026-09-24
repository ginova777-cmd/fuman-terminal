'use strict';
const assert=require('node:assert/strict');
const {allocate,apply}=require('../lib/mother-pool-scan-allocation');
const {collect}=require('../lib/mother-pool-allocation-producer');
const {verify}=require('../lib/verify-mother-pool-allocation');
const identity={trade_date:'2026-09-18',canonical_run_id:'fugle_daytrade_source:20260918:canonical',writer_run_id:'allocation:1',generation_id:'a1',mother_pool_run_id:'snapshot:1',snapshot_generation:'snapshot:1',snapshot_sequence:1};
const asOf='2026-09-18T10:00:00+08:00';
const universe=n=>Array.from({length:n},(_,i)=>({symbol:String(1000+i),payload:{formal_pool_eligible:true,warming_pending:false,hot_burst_fast_path:false,upgrade_score:n-i}}));
const envelope=(plan,id)=>({...id,observed_at:plan.created_at,writer_write_set:{plan:{source_evidence:plan.source_evidence}}});
let checks=0;
for(const n of [1,5,10,59,60,61,200]){
 const rows=universe(n),a=apply(rows,{identity,asOf,limit:999}),snapshot={symbols:rows.map(r=>r.symbol)};
 assert(a.selected_symbols.length<=60);assert(a.fair_numerator>=Math.ceil(a.selected_symbols.length/10));assert.equal(rows.filter(r=>r.payload.deep_scan_eligible).length,a.selected_symbols.length);
 assert.equal(a.selected_symbols.length+a.queued_symbols.length,n);assert.deepEqual(rows.slice(0,a.selected_symbols.length).map(r=>r.symbol),a.selected_symbols);checks++;
 const p=collect({identity,allocation:a,snapshot,asOf});assert(verify(p.rows,envelope(p,identity)));checks++;
 for(const mutate of [p=>{p.rows[0].deep_scan=!p.rows[0].deep_scan;},p=>{p.rows[0].fair_scan=!p.rows[0].fair_scan;},p=>{p.source_evidence.allocation.capacity=61;},p=>{p.source_evidence.allocation.fair_numerator=0;},p=>{p.rows[0].queue_rank=999;}]){const bad=structuredClone(p);mutate(bad);assert(!verify(bad.rows,envelope(bad,identity)));checks++;}
}
const rows=universe(100);rows[90].payload.hot_burst_fast_path=true;rows[91].payload.warming_pending=true;rows[92].payload.formal_pool_eligible=false;
const first=allocate(rows,{identity,asOf});assert(first.selected_symbols.includes(rows[90].symbol));assert(!first.selected_symbols.includes(rows[91].symbol));assert(!first.selected_symbols.includes(rows[92].symbol));checks++;
const second=allocate(rows,{identity:{...identity,writer_run_id:'allocation:2',generation_id:'a2'},previous:first,asOf:'2026-09-18T10:01:00+08:00'});
assert.notDeepEqual(second.fair_symbols,first.fair_symbols);assert.equal(second.cursor_before,first.cursor_after);checks++;
const retry=allocate(rows,{identity,previous:first,asOf});assert.deepEqual(retry.fair_symbols,first.fair_symbols);checks++;
const nextDay=allocate(rows,{identity:{...identity,trade_date:'2026-09-21',canonical_run_id:'fugle_daytrade_source:20260921:canonical'},previous:first,asOf:'2026-09-21T10:00:00+08:00'});assert.equal(nextDay.cursor_before,'');checks++;
const none=universe(3);none.forEach(r=>r.payload.formal_pool_eligible=false);const empty=allocate(none,{identity,asOf});assert.equal(empty.fair_denominator,0);assert.equal(empty.fair_numerator,0);checks++;
console.log(JSON.stringify({status:'passed',checks,scope:'isolated_B10_actual_allocator_and_verifier',production_complete:false}));
module.exports={universe};
