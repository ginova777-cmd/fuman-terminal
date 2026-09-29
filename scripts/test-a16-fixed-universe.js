'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const source=fs.readFileSync(require.resolve('../lib/mother-pool-a16-writer'),'utf8');
const hash=require('../lib/mother-pool-a16-io').hash;
const universe={trade_date:'2026-09-29',canonical_run_id:'fugle_daytrade_source:20260929:canonical',symbols:['2330'],scope:'writer_active_symbols'};
for(const [scenario,reason] of [['changed','A16_UNIVERSE_CHANGED'],['damaged-universe','A16_UNIVERSE_UNREADABLE'],['damaged-summary','A16_SUMMARY_UNREADABLE'],['same','WARMUP_RUNNING'],['empty','A16_UNIVERSE_EMPTY']]){
 let writes=0,spawns=0;const module={exports:{}};
 const read=p=>{
  if(p.endsWith('requested-symbols.json')){if(scenario==='damaged-universe')throw SyntaxError('damaged');return scenario==='changed'?{...universe,symbols:['1101']}:universe;}
  if(p.endsWith('writer-summary.json')){if(scenario==='damaged-summary')throw SyntaxError('damaged');throw Object.assign(Error('absent'),{code:'ENOENT'});}
  if(p.endsWith('launch.json'))return {pid:123,started_at:'2020-01-01T00:00:00Z'};
  throw Error('unexpected read');
 };
 const req=id=>id==='node:child_process'?{spawn:()=>{spawns++;throw Error('unexpected spawn')}}:id==='./mother-pool-a16-io'?{read,hash,atomic:()=>{writes++;}}:id==='./a16-attempts-settled'?{settled:()=>false}:id==='./a16-process-probe'?{probe:()=>({state:'running'})}:require(id);
 vm.runInNewContext(source,{require:req,module,process,Date,console});
 const result=module.exports.ensureWarmup({runtime:'isolated',root:'isolated',tradeDate:'2026-09-29',symbols:scenario==='empty'?[]:['2330'],apply:true,now:new Date('2026-09-29T07:00:00+08:00')});
 assert.equal(result.reason,reason,scenario);assert.equal(result.started,false);assert.equal(writes,0,scenario);assert.equal(spawns,0,scenario);
}
console.log('PASS actual A16 entry preserves fixed universe and damaged progress; no overwrite or duplicate spawn');
