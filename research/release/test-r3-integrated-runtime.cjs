'use strict';
const fs=require('fs'),path=require('path'),cp=require('child_process'),crypto=require('crypto'),assert=require('assert/strict');
const {create}=require('./r3-stock-runtime.cjs'),{assertBoundary}=require('./r3-lease-reader.cjs');
const control=path.resolve(process.argv[4]);
if(!control.includes('r3-integrated-')||/fuman-runtime|fuman-release-owner/i.test(control))throw Error('ISOLATED_ONLY');
const write=(name,x)=>{const f=path.join(control,name),t=f+'.tmp';fs.writeFileSync(t,JSON.stringify(x));fs.renameSync(t,f);};
const read=f=>JSON.parse(fs.readFileSync(f,'utf8').replace(/^\uFEFF/,''));
const r=create(process.argv[2],process.argv[3]);
const events=[];let current,future;
async function owner(action){if(action==='HANDBACK'){write('runtime-handoff.json',{stock:current.ready,future:future.identity,checked_at:new Date().toISOString()});}const id=crypto.randomUUID();write('owner-request.json',{id,action});const end=Date.now()+25000;while(Date.now()<end){const f=path.join(control,'owner-response.json');if(fs.existsSync(f)){const x=read(f);if(x.id===id){assert.equal(x.status,'PASS',JSON.stringify(x));events.push({stage:action,owner:x});return x;}}await r.wait(100);}throw Error('OWNER_TIMEOUT:'+action);}
async function startFuture(){
 const runtime=path.join(r.root,'future-'+crypto.randomUUID());fs.mkdirSync(path.join(runtime,'secrets'),{recursive:true});fs.writeFileSync(path.join(runtime,'secrets/fugle-api-key.txt'),'offline-fixture-only');
 const p=cp.spawn(process.execPath,['--use-system-ca','--require',path.join(__dirname,'../../scripts/fixtures/futopt-shutdown-preload.cjs'),path.join(__dirname,'../../scripts/fugle-futopt-websocket-collector.js')],{windowsHide:true,env:{SystemRoot:process.env.SystemRoot,PATH:process.env.PATH,FUMAN_RUNTIME_DIR:runtime,FUMAN_CACHE_DIR:path.join(runtime,'cache'),FUMAN_STATE_DIR:path.join(runtime,'state'),FUGLE_FUTOPT_STREAMING_AFTER_HOURS:'false',FUMAN_CHANGE_EVIDENCE_PHASE1:'0'},stdio:['ignore','pipe','pipe']});
 let error='';p.stdout.resume();p.stderr.on('data',b=>error=(error+b).slice(-4000));const result={p,runtime,exited:false};p.on('exit',code=>{result.exited=true;result.code=code;});
 const file=path.join(runtime,'state/futopt-shutdown/owner.json'),end=Date.now()+20000;while(!fs.existsSync(file)){if(result.exited||Date.now()>end)throw Error('FUTURE_START:'+error);await r.wait(100);}result.identity=read(file);assert.equal(result.identity.pid,p.pid);events.push({stage:'FUTURE_START',identity:result.identity});return result;
}
async function boundary(){const lease=await r.readLease();const b={lease,inventory:{complete:true,unknown_pids:[]},locks:{verified:true,owner_verified:true},writerExited:!fs.existsSync(path.join(control,'writer-alive.json'))};assertBoundary(b);return b;}
async function stopFuture(){
 const b=await boundary();assert(current.exited);assert.deepEqual(r.osRows([current.ready.collector.pid,current.ready.supervisor.pid]),[]);
 const proof={scope:'ISOLATED_REVIEW',inventory_complete:true,unknown_pids:[],locks_verified:b.locks.verified,writer_lease_released:b.lease.status==='RELEASED',writer_exited:b.writerExited,stock_exited:true,supervisor_exited:true,maintenance_fence_owned:true,checked_at:new Date().toISOString(),future:future.identity};
 const file=path.join(r.root,'future-quiescence.json');fs.writeFileSync(file,JSON.stringify(proof));
 const x=cp.spawnSync('pwsh',['-NoProfile','-File',path.join(__dirname,'windows-bound/Invoke-IsolatedGracefulPort.ps1'),'-RuntimeDir',future.runtime,'-Repository',path.resolve(__dirname,'../..'),'-ProofFile',file,'-Request'],{windowsHide:true,encoding:'utf8',timeout:30000});
 assert.equal(x.status,0,x.stderr);const result=JSON.parse(x.stdout);assert.equal(result.status,'STOP_VERIFIED');const end=Date.now()+5000;while(!future.exited){if(Date.now()>end)throw Error('FUTURE_EXIT_TIMEOUT');await r.wait(50);}assert.equal(future.code,0);assert.deepEqual(r.osRows([future.p.pid]),[]);events.push({stage:'FUTURE_STOP_VERIFIED',result});
}
async function stopAll(){await r.stop(current,await boundary());await stopFuture();}
async function main(){
 await new Promise(res=>r.server.listen(0,'127.0.0.1',res));const release=await require('./r3-isolated-release.cjs').create();
 const proof=await owner('VERIFY_FENCE');assert.equal(proof.fenced,true);
 current=await r.launch('A');future=await startFuture();
 r.setLeaseMode('active');await assert.rejects(()=>boundary(),/LEASE_NOT_RELEASED/);r.setLeaseMode('released');events.push({stage:'ACTIVE_LEASE_BLOCKED'});
 await stopAll();await release.apply(release.target);await release.verify(release.target);
 current=await r.launch('B');future=await startFuture();
 const collectorPid=current.ready.collector.pid;const ack=await owner('HANDBACK');assert.equal(ack.writer_rounds>=3,true);assert(!current.exited&&!future.exited);assert(r.osRows([collectorPid]).length!==0);events.push({stage:'LIVE_COLLECTOR_WRITER_HANDBACK',collector:current.ready,writer:ack});
 await owner('REFENCE');await stopAll();
 // Deployment verification failure after new runtime launch: stop before rollback.
 current=await r.launch('B');future=await startFuture();events.push({stage:'INJECT_POST_DEPLOY_RUNTIME_FAILURE'});await stopAll();await release.apply(release.base);await release.verify(release.base);
 current=await r.launch('A');future=await startFuture();const recovery=await owner('HANDBACK');assert(recovery.writer_rounds>=3&&!current.exited&&!future.exited);events.push({stage:'ROLLBACK_RECOVERY_LIVE',recovery});
 await owner('REFENCE');await stopAll();
 const drift=await owner('RESTORE_FAILURE');assert(drift.blocked&&drift.recovered);
 await release.verify(release.base);
 write('result.json',{status:'INTEGRATED_ISOLATED_PASS',events,stock_events:r.events,release:{base:release.base,target:release.target,receipts:release.receipts,verifier_sha256:release.verifier_sha256},formal_mutations:0,provider:'FIXTURE',lease:'LOOPBACK_OFFICIAL_SCHEMA',writer:'ISOLATED_ROUND_PROBE_NOT_FORMAL_WRITER'});
}
main().catch(e=>{write('result.json',{status:'BLOCKED',error:e.stack,events,stock_events:r.events,owned:{stock:current?.ready,future:future?.identity},automatic_kill:false});process.exitCode=1;}).finally(()=>r.server.close());
