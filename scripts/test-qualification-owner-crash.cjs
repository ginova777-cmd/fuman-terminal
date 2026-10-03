'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {fork}=require('node:child_process'),{once}=require('node:events');
const {openQualificationStore:open}=require('../lib/shared-stock-qualification-store.cjs');
if(process.argv[2]==='--child'){
 process.on('message',()=>{});
 (async()=>{
  const store=await open(process.argv[3]);
  await store.refresh({symbols:['3163'],tradeDate:'2026-10-02',fetchTicker:async()=>{
   process.send({ready:true});return new Promise(()=>{});
  }});
 })().catch(error=>{process.send({error:error.message});process.exitCode=1;});
}else{
 (async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'fuman-owner-crash-test-'));
  let child,store;
  try{
   child=fork(__filename,['--child',root],{stdio:['ignore','ignore','pipe','ipc'],windowsHide:true});
   await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('CHILD_READY_TIMEOUT')),5000);
    const fail=error=>{clearTimeout(timer);reject(error);};
    child.once('error',fail);child.once('exit',()=>fail(Error('CHILD_EXITED_BEFORE_READY')));
    child.once('message',message=>{clearTimeout(timer);if(message.ready)resolve();else reject(Error(message.error||'CHILD_NOT_READY'));});
   });
   await assert.rejects(open(root),/OWNER_BUSY/);
   const reserved=JSON.parse(fs.readFileSync(path.join(root,'control.json')));
   assert.equal(reserved.inflight_symbol,'3163');
   const exited=once(child,'exit');assert.equal(child.kill('SIGKILL'),true);await exited;
   assert.ok(fs.existsSync(path.join(root,'owner.lock')),'abrupt exit leaves diagnostic file');
   store=await open(root);
   let calls=0;
   const clock=()=>Date.parse(reserved.next_request_at)-1000;
   const result=await store.refresh({symbols:['3163'],tradeDate:'2026-10-02',clock,fetchTicker:async()=>{calls++;throw Error('must remain in backoff');}});
   assert.equal(result.status,'BACKOFF');assert.equal(calls,0);
   assert.equal(JSON.parse(fs.readFileSync(path.join(root,'owner.lock'))).pid,process.pid);
   await store.close();store=null;
   console.log('PASS: second process excluded; abrupt child exit releases OS ownership; stale diagnostic file recovered; persisted request reservation prevents a restart retry.');
  }finally{
   if(child&&child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill('SIGKILL');await exited;}
   if(store)await store.close();
   for(const name of fs.readdirSync(root))fs.unlinkSync(path.join(root,name));fs.rmdirSync(root);
  }
 })().catch(error=>{console.error(error);process.exitCode=1;});
}
