'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const guardModule=process.env.GATE_GUARD_MODULE || '../lib/daytrade-gate-read-guard.cjs';
const {createGateReadGuard,fileStore}=require(guardModule);
const req={target:'v_fugle_daytrade_canonical_gate',url:'https://test.invalid/rest/v1/v_fugle_daytrade_canonical_gate?select=*&limit=1',credential:'test-secret'};
const transient=()=>Object.assign(new Error('test HTTP 503'),{status:503});
(async()=>{
 let now=1000,calls=0;const run=createGateReadGuard({now:()=>now});
 const bad=async()=>{calls++;throw transient();};
 for(const delay of [60000,120000,240000,300000,300000]){
   await assert.rejects(run(req,bad),e=>e.retry_at===now+delay);
   const before=calls;
   await assert.rejects(run(req,bad),e=>e.code==='GATE_READ_BACKOFF');assert.equal(calls,before);
   now+=delay;
 }
 await run(req,async()=>[{ready:true}]);
 await assert.rejects(run(req,bad),e=>e.retry_at===now+60000);
 now+=60000;
 let finish;const pending=new Promise(resolve=>finish=resolve);
 const first=run(req,()=>{calls++;return pending;});
 const second=run(req,()=>{throw Error('duplicate request');});
 finish([{ready:true}]);const [a,b]=await Promise.all([first,second]);
 a[0].ready=false;assert.equal(b[0].ready,true);
 assert.deepEqual(await run(req,async()=>[{ready:false}]),[{ready:false}]);
 // Credentials and unrelated endpoints are isolated; permanent errors retain meaning.
 for(const status of [401,403,400]){
  for(let i=0;i<2;i++)await assert.rejects(run(req,async()=>{throw Object.assign(new Error('permanent'),{status});}),e=>e.status===status);
 }
 await assert.rejects(run(req,bad));
 assert.deepEqual(await run({...req,credential:'other'},async()=>[1]),[1]);
 assert.deepEqual(await run({...req,target:'source_status'},async()=>[2]),[2]);
 // Persisted cooldown also blocks a fresh process; local files contain no credentials.
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gate-backoff-test-'));
 const durable=createGateReadGuard({now:()=>now,store:fileStore(dir)});
 await assert.rejects(durable(req,bad));
 const persisted=fs.readdirSync(dir);assert.equal(persisted.length,1);
 assert(!fs.readFileSync(path.join(dir,persisted[0]),'utf8').includes(req.credential));
 const script=`const {createGateReadGuard,fileStore}=require(process.env.GATE_MODULE);createGateReadGuard({now:()=>Number(process.env.TEST_NOW),store:fileStore(process.env.TEST_DIR)})(JSON.parse(process.env.TEST_REQ),async()=>{throw Error('NETWORK_MUST_NOT_RUN');}).then(()=>process.exit(2),e=>{if(e.code!=='GATE_READ_BACKOFF'){console.error(e);process.exit(3);}});`;
 const child=spawnSync(process.execPath,['-e',script],{encoding:'utf8',env:{...process.env,GATE_MODULE:require.resolve(guardModule),TEST_NOW:String(now),TEST_DIR:dir,TEST_REQ:JSON.stringify(req)},timeout:5000});
 assert.equal(child.status,0,child.stderr);
 now+=60000;
 let release;const hold=new Promise(r=>release=r);
 const active=durable(req,()=>hold);await Promise.resolve();
 const separate=createGateReadGuard({now:()=>now,store:fileStore(dir)});
 await assert.rejects(separate(req,async()=>{throw Error('must not call');}),e=>e.code==='GATE_READ_IN_PROGRESS');
 release([3]);await active;
 assert.deepEqual(await separate(req,async()=>[4]),[4]);
 fs.writeFileSync(path.join(dir,persisted[0]),'{broken');
 await assert.rejects(separate(req,async()=>{throw Error('must not call');}),e=>e.code==='GATE_BACKOFF_STATE_INVALID');
 assert(!fs.readdirSync(dir).some(n=>n.endsWith('.lock')));
 for(const file of fs.readdirSync(dir))fs.unlinkSync(path.join(dir,file));fs.rmdirSync(dir);
 console.log('PASS: one request; 1/2/4/5 minute cooldown; success reset; in-flight sharing; credential isolation; no positive cache; cross-process persistence/exclusion; corrupt state fails closed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
