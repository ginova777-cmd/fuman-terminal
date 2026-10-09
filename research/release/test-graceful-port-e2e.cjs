'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process'),assert=require('node:assert/strict');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'txf-stop-windows-'));
const runtime=path.join(root,'runtime');fs.mkdirSync(path.join(runtime,'secrets'),{recursive:true});fs.writeFileSync(path.join(runtime,'secrets','fugle-api-key.txt'),'offline-fixture-only');
const env={...process.env,FUMAN_RUNTIME_DIR:runtime,FUMAN_CACHE_DIR:path.join(runtime,'cache'),FUMAN_STATE_DIR:path.join(runtime,'state'),FUGLE_FUTOPT_STREAMING_AFTER_HOURS:'false'};
const child=cp.spawn(process.execPath,['--use-system-ca','--require',path.join(__dirname,'../../scripts/fixtures/futopt-shutdown-preload.cjs'),path.join(__dirname,'../../scripts/fugle-futopt-websocket-collector.js')],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
let stdout='',stderr='',exited=null;child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.on('exit',(code,signal)=>exited={code,signal});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{try{
 const cache=path.join(runtime,'cache/intraday/fugle-futopt-ws-candles.json');const started=Date.now();while(!fs.existsSync(cache)){if(exited||Date.now()-started>15000)throw Error('FIXTURE_COLLECTOR_NOT_READY:'+stderr);await delay(50);}
 const owner=JSON.parse(fs.readFileSync(path.join(runtime,'state/futopt-shutdown/owner.json')));assert.equal(owner.pid,child.pid);
 const controllerArgs=['-NoProfile','-File',path.join(__dirname,'../../ops/Request-FutoptGracefulStop.ps1'),'-RuntimeDir',runtime];
 const preflight=cp.spawnSync('C:\\Program Files\\PowerShell\\7\\pwsh.exe',controllerArgs,{encoding:'utf8',windowsHide:true,timeout:15000});
 assert.equal(preflight.status,0,preflight.stderr);assert.equal(JSON.parse(preflight.stdout).status,'STOP_PREFLIGHT_ONLY');
 assert(!fs.existsSync(path.join(owner.control_root,'request.json')));
 const bad={...owner,creation_time:'2000-01-01T00:00:00.000Z'};
 fs.writeFileSync(path.join(runtime,'state/futopt-shutdown/owner.json'),JSON.stringify(bad));
 fs.writeFileSync(path.join(owner.control_root,'identity.json'),JSON.stringify(bad));
 const rejected=cp.spawnSync('C:\\Program Files\\PowerShell\\7\\pwsh.exe',controllerArgs,{encoding:'utf8',windowsHide:true,timeout:15000});
 assert.notEqual(rejected.status,0);assert.match(rejected.stderr,/STOP_PROCESS_CREATION_MISMATCH/);
 assert(!fs.existsSync(path.join(owner.control_root,'request.json')));
 fs.writeFileSync(path.join(runtime,'state/futopt-shutdown/owner.json'),JSON.stringify(owner));
 fs.writeFileSync(path.join(owner.control_root,'identity.json'),JSON.stringify(owner));
 const proofFile=path.join(root,'quiescence.json');const proof={scope:'ISOLATED_REVIEW',inventory_complete:true,unknown_pids:[],locks_verified:true,writer_lease_released:true,writer_exited:true,stock_exited:true,supervisor_exited:true,maintenance_fence_owned:true,checked_at:new Date().toISOString(),future:owner};
const adapter=path.join(__dirname,'windows-bound/Invoke-IsolatedGracefulPort.ps1');
const args=['-NoProfile','-File',adapter,'-RuntimeDir',runtime,'-Repository',path.resolve(__dirname,'../..'),'-ProofFile',proofFile];
const cases=[];for(const [field,value,reason]of [['inventory_complete',false,'UNKNOWN_PID'],['locks_verified',false,'UNKNOWN_LOCK'],['writer_lease_released',false,'WRITER_NOT_QUIESCENT'],['writer_exited',false,'WRITER_NOT_QUIESCENT'],['stock_exited',false,'STOCK_SUPERVISOR_NOT_QUIESCENT'],['supervisor_exited',false,'STOCK_SUPERVISOR_NOT_QUIESCENT'],['maintenance_fence_owned',false,'MAINTENANCE_OWNER_UNKNOWN']]){fs.writeFileSync(proofFile,JSON.stringify({...proof,[field]:value,checked_at:new Date().toISOString()}));const r=cp.spawnSync('pwsh',args,{encoding:'utf8',windowsHide:true,timeout:15000});assert.notEqual(r.status,0);assert(r.stderr.includes(reason));assert(!fs.existsSync(path.join(owner.control_root,'request.json')));cases.push(field);}
fs.writeFileSync(proofFile,JSON.stringify({...proof,checked_at:new Date().toISOString()}));
const result=cp.spawnSync('C:\\Program Files\\PowerShell\\7\\pwsh.exe',[...args,'-Request'],{encoding:'utf8',windowsHide:true,timeout:30000});
 fs.writeFileSync(path.join(root,'controller.stdout.txt'),result.stdout||'');fs.writeFileSync(path.join(root,'controller.stderr.txt'),result.stderr||'');
 assert.equal(result.status,0,result.stderr);const report=JSON.parse(result.stdout);assert.equal(report.status,'STOP_VERIFIED');
 const receipt=JSON.parse(fs.readFileSync(report.receipt));assert(receipt.safe_to_stop);assert.equal(receipt.boundary.quotes,1);assert.equal(receipt.boundary.candles,1);assert.equal(receipt.proof.files.length,1);assert.equal(receipt.proof.caches.length,2);
 await delay(100);assert.equal(exited.code,0);
 fs.writeFileSync(path.join(root,'acceptance.json'),JSON.stringify({status:'PASS',scope:'ACTUAL_CANDIDATE_ENTRY_WITH_MOCK_PROVIDER_WINDOWS_CONTROL',root,receipt,exit:exited,network_calls:0,adapter_rejections:cases,stock_supervisor_and_lease_proofs:'ISOLATED_FIXTURE_NOT_FORMAL_READBACK'},null,2));console.log(JSON.stringify({status:'PASS',root,receipt:report.receipt}));
 }finally{if(!exited){child.kill();await delay(100);}fs.writeFileSync(path.join(root,'collector.stdout.txt'),stdout);fs.writeFileSync(path.join(root,'collector.stderr.txt'),stderr);}
})().catch(e=>{console.error(e);process.exitCode=1;});
