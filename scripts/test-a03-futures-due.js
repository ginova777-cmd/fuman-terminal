'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const s=fs.readFileSync(require.resolve('./run-daytrade-source-writer.js'),'utf8');
const {SOURCE_REGISTRY}=require('../lib/terminal-strategy-morning-handoff');
for(const key of ['scorecard88','watch_case','futures']) assert(Object.hasOwn(SOURCE_REGISTRY,key));
assert(!Object.hasOwn(SOURCE_REGISTRY,'strategy1'));
const a=s.indexOf('    const terminalGroups = Object.fromEntries(registeredKeys.map('),b=s.indexOf('    const terminalUnion =',a);
for(const minutes of [360,480,525]){
 const c={futuresCheck:require('../lib/mother-pool-futures-catalogue').inspect(null,'2026-09-29','2026-09-29T00:00:00Z'),registeredKeys:Object.keys(SOURCE_REGISTRY),groups:{},scorecardSource:{status:'BLOCKED',first_blocker:'SCORECARD_SNAPSHOT_NOT_READY',symbols:[],sources:[],failed_checks:['SCORECARD_SNAPSHOT_NOT_READY']},objectPayload:x=>x||{},taipeiDate:()=> '2026-09-29',taipeiMinutes:()=>minutes};
 vm.createContext(c);vm.runInContext(s.slice(a,b)+';globalThis.result=terminalGroups;',c);
 for(const key of ['scorecard88','watch_case','futures']) assert.equal(c.result[key].status,'BLOCKED');assert.equal(c.result.futures.reason,'FUTURES_CATALOGUE_IDENTITY_OR_TIME');
}
console.log('PASS A03 current futures catalogue missing evidence remains blocked at 06:00,08:00,08:45');

const ctx={registeredKeys:['scorecard88'],groups:{},scorecardSource:{status:'READY',first_blocker:null,source_trade_date:'2026-09-24',source_count:2,symbols:['2330'],sources:[{strategy_key:'strategy3',source_run_id:'s3'}],failed_checks:[],source_hash:'hash',contract:'mother_pool_scorecard_warmup_source_v1'},taipeiDate:()=> '2026-09-29'};
vm.createContext(ctx);vm.runInContext(s.slice(a,b)+';globalThis.result=terminalGroups;',ctx);
assert.equal(ctx.result.scorecard88.status,'READY');assert.equal(ctx.result.scorecard88.run_id,null);assert.equal(ctx.result.scorecard88.source_runs[0].source_run_id,'s3');assert.equal(ctx.result.scorecard88.deduplicated_count,1);
console.log('PASS A03 scorecard adapter preserves source run list and deduplicated union');
