'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const text=fs.readFileSync(require.resolve('../lib/mother-pool-a16-writer'),'utf8');
for(const scenario of ['EPERM','EACCES','running','corrupt','invalid']) {
 let spawned=0;
 const module={exports:{}};
 const read=p=>{if(!p.endsWith('launch.json'))throw Object.assign(Error(),{code:'ENOENT'});if(scenario==='corrupt')throw SyntaxError('bad json');return {pid:123,started_at:scenario==='invalid'?'bad':'2020-01-01T00:00:00Z'};};
 const req=id=>id==='node:fs'?fs:id==='node:path'?path:id==='node:child_process'?{spawn:()=>{spawned++;throw Error('unexpected spawn')}}:id==='./mother-pool-a16-io'?{read,atomic:()=>{},hash:()=>''}:id==='./a16-attempts-settled'?{settled:()=>false}:id==='./a16-process-probe'?{probe:()=>({state:scenario==='running'?'running':'unknown',reason:'PROCESS_ACCESS_DENIED'})}:require(id);
 vm.runInNewContext(text,{require:req,module,process,Date,console});
 const result=module.exports.ensureWarmup({runtime:'isolated',root:'isolated',tradeDate:'2026-09-29',symbols:['2330'],apply:true,now:new Date('2026-09-29T07:00:00+08:00')});
 assert.equal(result.started,false);assert.equal(spawned,0);assert.equal(result.reason,scenario==='corrupt'?'LAUNCH_STATE_UNREADABLE':scenario==='invalid'?'LAUNCH_STATE_INVALID':scenario==='running'?'WARMUP_RUNNING':'PROCESS_ACCESS_DENIED');
}
console.log('PASS actual A16 entry: access denied, live process, corrupt launch JSON and invalid time cannot launch duplicate warmup');
