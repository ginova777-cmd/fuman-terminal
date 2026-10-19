'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('fs'),path=require('path'),os=require('os'),vm=require('vm'),crypto=require('crypto');
const file=path.join(__dirname,'run-cleanup-maintenance.js');
function isolated({lock=true,protectError=false}={}){
 const runtime=fs.mkdtempSync(path.join(os.tmpdir(),'cleanup-startup-test-'));
 const runId='cleanup-isolated-startup-'+crypto.randomUUID();
 const auth={runId,date:'2026-10-19',executionMode:'authorized_maintenance',scope:'cleanup-29-c16-deferred',expiresAt:new Date(Date.now()+60000).toISOString(),journalFile:path.join(runtime,'status',runId+'.json'),file:path.join(runtime,'context.json'),sha256:'isolated-context'};
 fs.writeFileSync(auth.file,JSON.stringify({isolated:true}));
 fs.mkdirSync(path.join(runtime,'locks')); const lockFile=path.join(runtime,'locks/cleanup-maintenance.lock');
 if(lock)fs.writeFileSync(lockFile,'');
 if(protectError){fs.mkdirSync(path.join(runtime,'cache/intraday'),{recursive:true});fs.writeFileSync(path.join(runtime,'cache/intraday/fugle-daytrade-ws-candles.json'),'protected');}
 let spawnCount=0;
 const context={RUNTIME:runtime,ROOT:runtime,authorization:()=>auth,hash:()=>{throw Error('isolated_protection_read_failed');}};
 const sandbox={__dirname,process:{argv:['node',file,'--apply','--authorization='+auth.file],env:{},execPath:process.execPath},console,Buffer,setTimeout,clearTimeout,require:n=>n==='./cleanup-maintenance-context'?context:n==='child_process'?{spawn:()=>{spawnCount++;throw Error('unexpected_stage');}}:require(n)};
 vm.createContext(sandbox);vm.runInContext(fs.readFileSync(file,'utf8').split('main().catch(')[0],sandbox);
 return {runtime,auth,lockFile,sandbox,spawnCount:()=>spawnCount};
}
test('existing empty lock blocks all stages, preserves lock, records same-run failure without fake total',async()=>{
 const t=isolated();const before=fs.statSync(t.lockFile).mtimeMs;
 await assert.rejects(vm.runInContext('main()',t.sandbox),/cleanup_maintenance_lock_exists_owner_review_required/);
 vm.runInContext("recordStartupFailure(Object.assign(Error('cleanup_maintenance_lock_exists_owner_review_required'),{code:'EEXIST'}))",t.sandbox);
 const p=path.join(t.runtime,'status/cleanup-startup-failures',t.auth.runId+'.json'),r=JSON.parse(fs.readFileSync(p));
 assert.equal(r.runId,t.auth.runId);assert.equal(r.complete,false);assert.equal(r.stageExecutionStarted,false);assert.equal(r.errorCode,'EEXIST');assert.equal(t.spawnCount(),0);
 assert.equal(fs.statSync(t.lockFile).mtimeMs,before);assert.equal(fs.readFileSync(t.lockFile).length,0);assert(!fs.existsSync(t.auth.journalFile));assert(!fs.existsSync(path.join(t.runtime,'status/cleanup-total-20261019.json')));
 assert.throws(()=>vm.runInContext("recordStartupFailure(Error('second'))",t.sandbox),/EEXIST/);assert.equal(JSON.parse(fs.readFileSync(p)).first_blocker,r.first_blocker);
});
test('protected read failure before lock preserves protected bytes and is recorded',async()=>{
 const t=isolated({lock:false,protectError:true});await assert.rejects(vm.runInContext('main()',t.sandbox),/isolated_protection_read_failed/);
 vm.runInContext("recordStartupFailure(Error('isolated_protection_read_failed'))",t.sandbox);
 assert.equal(t.spawnCount(),0);assert(!fs.existsSync(t.lockFile));assert.equal(fs.readFileSync(path.join(t.runtime,'cache/intraday/fugle-daytrade-ws-candles.json'),'utf8'),'protected');
});
test('failure recorder does not overwrite journal-backed execution evidence',()=>{
 const t=isolated();fs.mkdirSync(path.dirname(t.auth.journalFile),{recursive:true});fs.writeFileSync(t.auth.journalFile,'existing');
 t.sandbox.testAuth=t.auth;vm.runInContext('startupAuth=testAuth',t.sandbox);
 vm.runInContext("recordStartupFailure(Error('late_failure'))",t.sandbox);assert.equal(fs.readFileSync(t.auth.journalFile,'utf8'),'existing');assert(!fs.existsSync(path.join(t.runtime,'status/cleanup-startup-failures')));
});
