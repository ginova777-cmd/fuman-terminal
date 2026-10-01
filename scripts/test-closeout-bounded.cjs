'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const inputs=require('../lib/mother-pool-closeout-inputs.cjs');
const registry={modules:{B01:'b01',B18:'b18'}},identity={trade_date:'2026-10-01',release_sha:'a'.repeat(40)};
const policy={contract:'daytrade_module_recovery_policy_v1',...identity,restored:[],probe:null};
assert.equal(inputs.permission(policy,registry,identity).allowed,false);
assert.equal(inputs.permission({...policy,probe:'B01'},registry,identity).allowed,false);
assert.equal(inputs.permission({...policy,probe:'B18'},registry,identity).allowed,true);
assert.equal(inputs.permission({...policy,probe:'B18'},registry,{...identity,release_sha:'b'.repeat(40)}).allowed,false);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'closeout-input-test-'));
try {
 const canonical='canonical';
 for(const file of ['b01-20260930-old.json','a01-20261001-large.json','b01-verified-20261001-old.json']) fs.writeFileSync(path.join(dir,file),'invalid unrelated JSON');
 const file=path.join(dir,'b01-20261001-round.json');
 fs.writeFileSync(file,JSON.stringify({module_id:'B01',trade_date:identity.trade_date,canonical_run_id:canonical,db_readback:{},observed_at:'2026-10-01T05:00:00Z'}));
 assert.equal(inputs.rounds(dir,identity.trade_date,canonical).length,1);
 const fd=fs.openSync(file,'w');fs.ftruncateSync(fd,inputs.MAX_BYTES+1);fs.closeSync(fd);
 assert.throws(()=>inputs.rounds(dir,identity.trade_date,canonical),/SIZE_LIMIT/);
} finally { fs.rmSync(dir,{recursive:true,force:true}); }
// Run the actual entry with paused policy. Any calendar, DB, or receipt scan fails this test.
const logs=[],fakeProcess={env:{FUMAN_RUNTIME:'fixture'},argv:['node','closeout','--apply'],execPath:process.execPath,exitCode:0};
const RealDate=Date;class TestDate extends RealDate {constructor(...args){super(...(args.length?args:['2026-10-01T05:31:00Z']));}}
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'run-mother-pool-closeout.js'),'utf8'),{
 __dirname,process:fakeProcess,Date:TestDate,Intl,console:{log:x=>logs.push(JSON.parse(x)),error:x=>{throw Error(x);}},
 require:id=>{
  if(id==='node:fs')return new Proxy({}, {get(){throw Error('unexpected filesystem work');}});
  if(id==='node:child_process')return {spawnSync:command=>{assert.equal(command,'git');return {status:0,stdout:identity.release_sha};}};
  if(id.includes('closeout-inputs'))return {...inputs,readBounded:()=>policy};
  if(id.includes('module-registry'))return registry;
  if(id.includes('closeout-producer')||id.includes('persist-mother'))return {};
  return require(id);
 }
});
assert.equal(fakeProcess.exitCode,3);assert.equal(logs[0].status,'paused');assert.equal(logs[0].complete,false);
console.log('PASS closeout pause guard, identity, scoped reads and size cap; no network or receipt scan while paused');
