'use strict';
const assert=require('node:assert/strict'),{inspect,MODULES}=require('../lib/mother-pool-combination-sources');
const {hash,identityFields}=require('../lib/mother-pool-module-write-set');
const registry=require('../data/contracts/mother-pool-a01-b24-module-registry-v1.json');
const f=require('./fixtures/minute-side-r4-plan.json').rounds[0];
const side=require('../lib/mother-pool-minute-side-persistence').buildPlan(f.result,f.snapshot);
Object.assign(side,{status:'written',written_symbols:side.source_rows.map(r=>r.symbol),round_written_symbols:[...side.requested_symbols]});
const identity=Object.fromEntries(identityFields.map(k=>[k,side[k]])),symbols=side.requested_symbols,asOf=new Date(Date.parse(side.observed_at)+1000).toISOString();
const parents={};
for(const id of MODULES.filter(x=>!['B14','B20'].includes(x))){const plan={created_at:side.observed_at,requested_symbols:symbols,data_gap_symbols:[],rows:symbols.map(symbol=>({symbol,status:'READY',data_gap_reason:null,is_synthetic:false,replay:false,look_ahead:false}))};const plan_hash=hash(plan);parents[id]={...identity,contract:'mother_pool_module_write_set_v1',module_id:id,module_contract:registry.modules[id],plan,plan_hash,ack:{...identity,module_id:id,committed:true,committed_at:side.observed_at,plan_hash,written_symbols:symbols}};}
const input={identity,symbols,asOf,parents,side},good=inspect(input);assert(good.rows.every(r=>r.status==='SOURCE_ROWS_AVAILABLE'));assert.equal(good.complete,false);let checks=2;
for(const change of [x=>delete x.parents.B12,x=>x.parents.B13.ack.committed=false,x=>x.parents.B19.writer_run_id='old',x=>x.parents.B21.plan.rows.pop(),x=>x.side.writer_run_id='old',x=>x.side.source_rows[0].source_hash='wrong',x=>x.side.round_written_symbols.pop(),x=>x.side.observed_at='2099-01-01T00:00:00Z']){const bad=structuredClone(input);change(bad);assert(inspect(bad).rows.some(r=>r.status==='DATA_GAP'));checks++;}
console.log(JSON.stringify({status:'passed',checks,scope:'isolated_B24_source_coverage_only',production_complete:false}));
