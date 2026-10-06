'use strict';
const assert=require('node:assert/strict');
const {expectedFromSource}=require('../lib/mother-shared-water-consumer.cjs');
const {freezeScope}=require('../lib/mother-shared-water-priority-scope.cjs');
const date='2026-10-06',version='a'.repeat(40);
function input(){return {tradeDate:date,producerVersion:version,sourceStatus:{source_name:'fugle_daytrade_source',payload:{trade_date:date,canonical_run_id:'c',mother_pool_run_id:'m',mother_pool_snapshot_sequence:2,writer_run_id:'w',priority_pool_symbols:2,shared_water_priority_scope:freezeScope(['2330','1216'],{tradeDate:date,writerRunId:'w',freshSymbols:[]})}},snapshotBytes:Buffer.from(JSON.stringify({trade_date:date,canonical_run_id:'c',mother_pool_run_id:'m',generation:'m',snapshot_sequence:2,status:'complete',complete:true,symbol_count:1,symbols:['1216']}))};}
const expected=expectedFromSource(input());
assert.deepEqual(expected.requested_symbols,['1216','2330']);assert.equal(expected.verification_run_id,undefined);assert.notEqual(expected.requested_symbols_sha256,expected.snapshot_symbols_sha256);
for(const change of [x=>x.tradeDate='2026-10-05',x=>x.producerVersion='unknown',x=>x.sourceStatus.payload.writer_run_id='other',x=>x.sourceStatus.payload.mother_pool_snapshot_sequence=3,x=>x.sourceStatus.payload.priority_pool_symbols=1,x=>x.sourceStatus.payload.shared_water_priority_scope.symbols.pop()]){const x=input();change(x);assert.throws(()=>expectedFromSource(x));}
for(const change of [s=>s.complete=false,s=>s.generation='other',s=>s.symbol_count=2,s=>s.symbols=['1216','1216']]){const x=input(),s=JSON.parse(x.snapshotBytes);change(s);x.snapshotBytes=Buffer.from(JSON.stringify(s));assert.throws(()=>expectedFromSource(x));}
console.log(JSON.stringify({ok:true,cases:11,mode:'independent_source_snapshot_mapping',deployed:false}));
