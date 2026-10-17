'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('fs'),path=require('path'),vm=require('vm');
const {createRequire}=require('module');
const {classifyEvidence}=require('./cleanup-evidence-protection');
const {allCursorPages}=require('./cleanup-history-pagination');
const now=Date.parse('2026-10-17T00:00:00Z');
const good={sha256:'hash',referenceScanComplete:true,references:[],holds:[],reviewedAt:'2026-10-17T00:00:00Z',formalAcceptance:false,rollback:false,incidentState:'none',success:true,completedAt:'2026-09-01T00:00:00Z'};
test('C17 successful unreferenced evidence expires after 15 days',()=>assert.equal(classifyEvidence(good,now,'hash').eligible,true));
for(const [name,patch] of Object.entries({open:{incidentState:'open'},referenced:{references:['root']},formal:{formalAcceptance:true},rollback:{rollback:true},hold:{holds:['incident']},missingScan:{referenceScanComplete:false},failed:{success:false},missingClosure:{incidentState:'closed'},hash:{sha256:'changed'},staleReview:{reviewedAt:'2026-09-01'}}))test('C17 protects '+name,()=>assert.equal(classifyEvidence({...good,...patch},now,'hash').eligible,false));
test('C17 closure age uses closure, not original file age',()=>{assert.equal(classifyEvidence({...good,incidentState:'closed',closedAt:'2026-10-10'},now,'hash').eligible,false);assert.equal(classifyEvidence({...good,incidentState:'closed',closedAt:'2026-09-01'},now,'hash').eligible,true);});
test('C17 exact 15 day boundary preserved',()=>assert.equal(classifyEvidence({...good,completedAt:'2026-10-02T00:00:00Z'},now,'hash').eligible,false));
test('Vercel missing terminal cursor rejected',async()=>assert.rejects(allCursorPages(async()=>({deployments:[],pagination:{}})),/pagination_missing/));
test('Vercel multi-page full collection accepted',async()=>{const r=await allCursorPages(async c=>c?{deployments:[{uid:'b'}],pagination:{next:null}}:{deployments:[{uid:'a'}],pagination:{next:1}});assert.equal(r.rows.length,2);assert.equal(r.complete,true);});
function load(file,fetch){const full=path.join(__dirname,file);const source=fs.readFileSync(full,'utf8').split('main().catch(')[0].replace(/if \(require.main === module\)\s*$/,'');const ctx={module:{exports:{}},require:n=>n==='../lib/server-supabase-key'?{serverSupabaseKey:()=>'',serverSupabaseUrl:()=>'',terminalSupabaseUrl:()=> 'https://invalid.example',serviceRoleKey:()=> 'fixture'}:createRequire(full)(n),__dirname,process:{env:{},argv:[]},console,fetch,AbortSignal,URL,URLSearchParams,setTimeout,clearTimeout};vm.createContext(ctx);vm.runInContext(source,ctx);return ctx;}
test('Supabase missing exact count is not a short-page success',async()=>{const c=load('cleanup-supabase-vercel-history.js',async()=>({ok:true,status:200,text:async()=>'[]',headers:{get:()=>null}}));await assert.rejects(vm.runInContext("supabaseFetch('fixture')",c),/exact_count_missing/);});
test('Supabase malformed rows fail closed',async()=>{const c=load('cleanup-supabase-vercel-history.js',async()=>({ok:true,status:200,text:async()=>'{}',headers:{get:()=> '0-0/0'}}));await assert.rejects(vm.runInContext("supabaseFetch('fixture')",c),/rows_missing/);});
test('C16 missing hasOldRows is rejected before deletion',()=>{const c=load('cleanup-daytrade-intraday-retention.js');assert.throws(()=>vm.runInContext("assertProtectedWindow({ok:true,table:'fugle_daytrade_intraday_1m',keepDays:15,latestTradeDate:'2026-10-16',protectedRows:1},'before')",c),/status_incomplete/);});


test('C17 real isolated file deletion preserves incident evidence',async()=>{
 const os=require('os'),crypto=require('crypto');const runtime=fs.mkdtempSync(path.join(os.tmpdir(),'c17-isolated-'));
 fs.mkdirSync(path.join(runtime,'state'),{recursive:true});fs.mkdirSync(path.join(runtime,'config'));fs.mkdirSync(path.join(runtime,'locks'));fs.writeFileSync(path.join(runtime,'locks','supabase-rest-pool-incident.json'),JSON.stringify({status:'resolved',id:'old-fixture',resolvedAt:'2026-09-01'}));
 const nowMs=Date.now(),old=new Date(nowMs-40*86400000),records=[];
 for(const [name,incidentState]of [['success','none'],['incident','open']]){const file=path.join(runtime,'state',`daytrade-unattended-gate-watchdog-evidence-${name}.json`);fs.writeFileSync(file,JSON.stringify({ok:incidentState==='none',fixture:true,checkedAt:old.toISOString(),formalAcceptance:false,rollbackRequired:false,incidentId:incidentState==='open'?'unresolved-fixture':undefined}));fs.utimesSync(file,old,old);records.push({...good,path:file,incidentState,completedAt:old.toISOString(),reviewedAt:new Date().toISOString(),sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')});}
 fs.writeFileSync(path.join(runtime,'config','cleanup-evidence-protection.json'),JSON.stringify({contract:'cleanup-evidence-protection-v1',entries:records}));
 const file=path.join(__dirname,'cleanup-runtime-retention.js'),native=createRequire(file);const ctx={require:n=>n==='./run-cleanup-local-assets'?{run:async()=>({ok:true,candidates:[],processed:[]})}:n==='./cleanup-extended-retention'?{referenceInventory:async()=>({files:[],contains:()=>false})}:native(n),__dirname,process:{env:{FUMAN_RUNTIME_DIR:runtime},argv:['node','fixture','--apply','--json']},console:{log:()=>{}}};vm.createContext(ctx);vm.runInContext(fs.readFileSync(file,'utf8').split('main().catch(')[0],ctx);await vm.runInContext('main()',ctx);
 assert.equal(fs.existsSync(records[0].path),false);assert.equal(crypto.createHash('sha256').update(fs.readFileSync(records[1].path)).digest('hex'),records[1].sha256);
 const receipt=JSON.parse(fs.readFileSync(path.join(runtime,'status',fs.readdirSync(path.join(runtime,'status'))[0])));assert.equal(receipt.deleted,1);assert.equal(receipt.evidenceReviewComplete,false);assert.equal(receipt.ok,false);
});
test('C16 apply blocked before any legacy RPC (which writes even in dry-run)',async()=>{let calls=0;const ctx=load('cleanup-daytrade-intraday-retention.js',async()=>{calls++;throw Error('network forbidden');});await assert.rejects(vm.runInContext('main()',ctx),/C16_RESTORE_NO_GO/);assert.equal(calls,0);});
test('stage receipt does not overwrite final day receipt',()=>{const s=fs.readFileSync(path.join(__dirname,'verify-daily-retention-maintenance.js'),'utf8');assert(s.includes('phase === "stage" ? "stage" : "verifier"'));assert(s.includes('waiting_dependency'));});
test('existing nine-step orchestrator stops at C16 and preserves failure journal',async()=>{
 const os=require('os'),crypto=require('crypto');const runtime=fs.mkdtempSync(path.join(os.tmpdir(),'cleanup-chain-'));
 fs.mkdirSync(path.join(runtime,'data','scan-receipts'),{recursive:true});
 const journalFile=path.join(runtime,'status','journal.json'),calls=[];
 const auth={runId:'isolated-chain-negative',sha256:'fixture',file:'fixture-only',date:'2026-10-16',expiresAt:new Date(Date.now()+60000).toISOString(),journalFile};
 const context={ROOT:runtime,RUNTIME:runtime,authorization:()=>auth,receipts:()=>({retired:[],history:[],intraday:[]}),hash:f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'),verifyJournal:()=>{throw Error('must_not_finalize_failed_chain');}};
 const file=path.join(__dirname,'run-cleanup-maintenance.js'),native=createRequire(file);
 const ctx={require:n=>n==='./cleanup-maintenance-context'?context:n==='./twse-trading-day'?{isTwseTradingDay:async()=>({isTradingDay:true,date:'2026-10-16',source:'fixture'})}:n==='child_process'?{spawn:()=>{throw Error('real_child_forbidden');}}:native(n),process:{argv:['node','fixture','--apply','--authorization=fixture'],env:{},execPath:process.execPath},console,setTimeout,clearTimeout,calls,fs};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(file,'utf8').split('main().catch(')[0],ctx);
 vm.runInContext(`command=async(file,args,log)=>{calls.push(args.join(' '));fs.writeFileSync(log,'isolated fixture');return {exitCode:args.some(a=>a.includes('cleanup-daytrade-intraday-retention'))?1:0};}`,ctx);
 await assert.rejects(vm.runInContext('main()',ctx),/cleanup_stage_failed:intraday/);
 const journal=JSON.parse(fs.readFileSync(journalFile));assert.equal(journal.firstFailure.step,'intraday');assert.deepEqual(journal.steps.map(x=>x.name),['retired','history','intraday']);assert.equal(journal.protection.ok,true);assert(journal.finishedAt);assert.equal(fs.existsSync(path.join(runtime,'locks','cleanup-maintenance.lock')),false);assert.equal(calls.some(x=>x.includes('cleanup-runtime-retention')),false);
});

const {allOffsetPages,storageInventory}=require('./cleanup-history-pagination');
test('offset inventory continues past short server page until empty',async()=>{const data=[{id:'a'},{id:'b'},{id:'c'}];const r=await allOffsetPages(async o=>({rows:data.slice(o,o+1),total:3}),{id:r=>r.id});assert.equal(r.rows.length,3);assert.equal(r.pageCount,4);});
for(const [name,pages,error]of [
 ['count drift',[{rows:[{id:'a'}],total:2},{rows:[],total:1}],/count_drift/],
 ['early empty',[{rows:[{id:'a'}],total:2},{rows:[],total:2}],/missing_rows/],
 ['duplicate',[{rows:[{id:'a'}]},{rows:[{id:'a'}]}],/duplicate/],
 ['malformed',[{}],/rows_missing/]
])test('offset rejects '+name,async()=>{let n=0;await assert.rejects(allOffsetPages(async()=>pages[n++],{id:r=>r.id}),error);});
const object=(name,id)=>({name,id,metadata:{size:7},updated_at:'2026-10-01T00:00:00Z'});
test('storage scans every bucket folder and short page',async()=>{const data={'one/':[{name:'dir',id:null,metadata:null},object('a','1')],'one/dir':[object('b','2')],'two/':[object('c','3')]};const r=await storageInventory([{id:'one'},{id:'two'}],async(id,a)=>data[id+'/'+a.prefix].slice(a.offset,a.offset+1));assert.equal(r.objects.length,3);assert.equal(r.folders.length,3);assert.equal(r.pages,7);assert.deepEqual(r.objects.map(o=>o.path),['a','dir/b','c']);});
test('storage rejects missing modification identity',async()=>{await assert.rejects(storageInventory([{id:'one'}],async(_,a)=>a.offset?[]:[{name:'a',id:'1',metadata:{size:1}}]),/fields_missing/);});
test('storage rejects escaping object name',async()=>{await assert.rejects(storageInventory([{id:'one'}],async(_,a)=>a.offset?[]:[object('../a','1')]),/path_invalid/);});
test('storage rejects duplicate buckets',async()=>{await assert.rejects(storageInventory([{id:'one'},{id:'one'}],async()=>[]),/bucket_identity/);});
test('storage bounded traversal fails closed',async()=>{await assert.rejects(storageInventory([{id:'one'}],async(_,a)=>a.offset?[]:[{name:'dir',id:null,metadata:null}],{maxFolders:2}),/bound/);});
function journalFixture(){
 const full=path.join(__dirname,'cleanup-maintenance-context.js');const native=createRequire(full),files=new Map();const start='2026-10-17T00:00:00Z',finish='2026-10-17T00:01:00Z';
 const ctx={module:{exports:{}},require:n=>n==='fs'?{readFileSync:f=>{if(!files.has(f))throw Error('unexpected_read:'+f);return files.get(f);}}:native(n),process,console,Intl,Date};vm.createContext(ctx);vm.runInContext(fs.readFileSync(full,'utf8'),ctx);
 const c=ctx.module.exports,auth={runId:'fixture-nine-stages',sha256:'auth',issuedAt:start,journalFile:'isolated-journal'};
 const journal={contract:'cleanup-maintenance-execution-v1',runId:auth.runId,authorizationSha256:'auth',startedAt:start,finishedAt:finish,protection:{ok:true},steps:[]};
 for(const name of c.steps){const row={name,startedAt:start,finishedAt:finish,exitCode:0,receipts:[]};for(const file of c.receipts()[name]){const payload={ok:true,checkedAt:finish,applied:true,maintenanceRunId:auth.runId,maintenanceAuthorizationSha256:'auth',retentionReferenceTime:start};files.set(file,JSON.stringify(payload));row.receipts.push({file,sha256:c.hash(file)});}journal.steps.push(row);}
 return {c,files,auth,journal,save:()=>files.set(auth.journalFile,JSON.stringify(journal))};
}
test('nine-step journal verifier accepts complete isolated receipt collection only',()=>{const f=journalFixture();f.save();assert.equal(f.c.verifyJournal(f.auth).steps.length,9);});
for(const fault of ['missing_time','invalid_time','duplicate_stage','missing_receipt','changed_hash','failure_flag'])test('journal rejects '+fault,()=>{const f=journalFixture();if(fault==='duplicate_stage')f.journal.steps[8]=f.journal.steps[0];else if(fault==='failure_flag')f.journal.firstFailure={step:'history'};else if(fault==='missing_receipt')f.journal.steps[3].receipts.pop();else{const e=f.journal.steps[3].receipts[0],p=JSON.parse(f.files.get(e.file));if(fault==='missing_time')delete p.checkedAt;else if(fault==='invalid_time')p.checkedAt='not-a-date';else p.ok=false;f.files.set(e.file,JSON.stringify(p));if(fault!=='changed_hash')e.sha256=f.c.hash(e.file);}f.save();assert.throws(()=>f.c.verifyJournal(f.auth));});
async function cloudFixture({damage=false,missingMetadata=false}={}){
 const os=require('os'),runtime=fs.mkdtempSync(path.join(os.tmpdir(),'cleanup-cloud-isolated-'));
 for(const dir of ['secrets','config'])fs.mkdirSync(path.join(runtime,dir));fs.writeFileSync(path.join(runtime,'secrets','vercel-blob-read-write-token.txt'),'isolated-fixture-token');
 const old='2020-01-01T00:00:00Z';let blobs=[{pathname:'tests/expired',url:'https://fixture.invalid/expired',size:5,uploadedAt:old},{pathname:'scorecard88/current.json',url:'https://fixture.invalid/protected',size:8,uploadedAt:old}],deleted=[],reads=0;
 fs.writeFileSync(path.join(runtime,'config','cleanup-retired-assets.json'),JSON.stringify({entries:[{...blobs[0],owner:'cleanup-managed-test-assets',status:'retired',formalEvidence:false,rollbackRequired:false,referenceAuditComplete:true,retiredAt:old}]}));
 const sdk={list:async({cursor})=>{if(missingMetadata)return {blobs:[]};if(damage&&deleted.length)blobs=blobs.map(b=>({...b,size:999}));const i=Number(cursor||0);return {blobs:blobs.slice(i,i+1),hasMore:i+1<blobs.length,cursor:String(i+1)};},head:async url=>blobs.find(b=>b.url===url),del:async url=>{deleted.push(url);blobs=blobs.filter(b=>b.url!==url);}};
 const file=path.join(__dirname,'cleanup-extended-retention.js'),native=createRequire(file);
 const ctx={module:{exports:{}},require:n=>n==='@vercel/blob'?sdk:n==='../lib/server-supabase-key'?{serviceRoleKey:()=> 'fixture',terminalSupabaseUrl:()=> 'https://fixture.invalid'}:native(n),__dirname,process:{env:{FUMAN_RUNTIME_DIR:runtime},argv:[]},console,AbortSignal,fetch:async(url,options)=>{assert(url.startsWith('https://fixture.invalid/storage/v1/'));reads++;const data=url.endsWith('/bucket')?[{id:'test'}]:JSON.parse(options.body).offset?[]:[object('protected','id-1')];return {ok:true,text:async()=>JSON.stringify(data)};}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(file,'utf8'),ctx);const result=await vm.runInContext('cloudCleanup(true,{contains:()=>false})',ctx);return {result,deleted,reads};
}
test('cloud runner isolated inventory deletion and independent protected readback',async()=>{const f=await cloudFixture();assert.equal(f.result.ok,true);assert.equal(f.deleted.length,1);assert.equal(f.result.storage.independentReadback,true);assert.equal(f.result.storage.readbackObjects,1);assert.equal(f.reads,6);});
test('cloud runner detects protected Blob change after deletion',async()=>assert.rejects(cloudFixture({damage:true}),/protected_readback_failed/));
test('cloud runner rejects missing Blob pagination before deletion',async()=>assert.rejects(cloudFixture({missingMetadata:true}),/pagination_metadata_missing/));

test('history runner rejects missing retention reference instead of reporting zero candidates',async()=>{const c=load('cleanup-supabase-vercel-history.js');await assert.rejects(vm.runInContext("cleanupRunPair({}, {})",c),/retention_reference_missing/);});
test('scoped 29 policy excludes only C16 from existing stage plan',()=>{const c=require('./cleanup-maintenance-context');assert.equal(c.scopedPolicy.requiredItems.length,29);assert.equal(c.requiredSteps({scope:c.scopedPolicy.scope}).includes('intraday'),false);assert.equal(c.requiredSteps({scope:'five-stage-cleanup'}).includes('intraday'),true);assert.deepEqual(c.scopedPolicy.deferredItems.map(i=>i.id),['C16']);});
test('29 scope journal accepts deferred C16 without pretending full suite',()=>{const f=journalFixture();f.auth.scope=f.c.scopedPolicy.scope;f.journal.completionScope=f.auth.scope;f.journal.deferredItems=f.c.scopedPolicy.deferredItems;f.journal.steps=f.journal.steps.filter(s=>s.name!=='intraday');f.save();assert.equal(f.c.verifyJournal(f.auth).steps.length,8);});
test('missing any of 29 item proofs blocks total completion',()=>{const f=journalFixture();assert.throws(()=>f.c.verifyScopedItems(f.journal),/item_set_incomplete/);});
test('full explicit item set requires run identity and evidence hashes',()=>{const f=journalFixture();const file='item-proof';f.files.set(file,'fixture evidence');f.journal.items=f.c.scopedPolicy.requiredItems.map(id=>({id,runId:f.journal.runId,status:'complete',inventoryComplete:true,readbackVerified:true,protectedReadbackVerified:true,deleted:0,remaining:0,protectedSet:[],evidence:[{file,sha256:f.c.hash(file)}]}));assert.equal(f.c.verifyScopedItems(f.journal).length,29);f.journal.items[0].remaining=1;assert.throws(()=>f.c.verifyScopedItems(f.journal),/evidence_incomplete/);f.journal.items[0].remaining=0;f.files.set(file,'changed');assert.throws(()=>f.c.verifyScopedItems(f.journal),/evidence_changed/);});
function cleanupOrigin(){const script='C:/fuman-release-owner/prod81/run-api-only-retired-cleanup.ps1',task='\\Fuman API-Only Retired Artifact Cleanup 1535',exe='pwsh.exe',instance='fixture-cleanup';return {strategy:'cleanup',formalComplete:true,recovery:false,release:{ok:true,scriptPath:script},scan:{runId:'cleanup-20261017-fixture',tradeDate:'2026-10-17',startedAt:'2026-10-17T09:10:02Z'},observation:{ok:true,runnerPid:123,parentPid:123,runnerOwnerSid:'sid',taskPrincipalSid:'sid',executablePath:exe,runnerStartedAt:'2026-10-17T09:10:01Z',commandLine:`pwsh -File "${script}"`,taskName:task,actions:[{Execute:exe,Arguments:`-File "${script}"`}],events:[{id:107,recordId:1,time:'2026-10-17T09:10:00Z',fields:{TaskName:task,InstanceId:instance}},{id:200,recordId:2,time:'2026-10-17T09:10:01Z',fields:{TaskName:task,TaskInstanceId:instance,EnginePID:'123',ActionName:exe}}]}};}
test('cleanup natural origin binds 17:10 task and process',()=>assert.equal(require('../lib/strategy-natural-evidence').assess(cleanupOrigin()).naturalSlotComplete,true));
test('pre-cleanup trigger evidence never claims completed cleanup',()=>{const x=cleanupOrigin();x.originOnly=true;x.formalComplete=false;const r=require('../lib/strategy-natural-evidence').assess(x);assert.equal(r.naturalSlotComplete,false);assert.equal(r.naturalTriggerVerified,true);});
for(const change of ['manual','owner','pid','time'])test('cleanup trigger rejects '+change,()=>{const x=cleanupOrigin();if(change==='manual')x.observation.events[0].id=110;if(change==='owner')x.observation.runnerOwnerSid='other';if(change==='pid')x.observation.events[1].fields.EnginePID='999';if(change==='time')x.observation.events[0].time='2026-10-17T09:11:00Z';assert.equal(require('../lib/strategy-natural-evidence').assess(x).naturalSlotComplete,false);});

test('single-start dispatch continues all eight stages with C16 deferred and rejects absent item proof',async()=>{
 const os=require('os'),crypto=require('crypto');const runtime=fs.mkdtempSync(path.join(os.tmpdir(),'cleanup-chain-'));
 fs.mkdirSync(path.join(runtime,'data','scan-receipts'),{recursive:true});
 const journalFile=path.join(runtime,'status','journal.json'),calls=[];
 const auth={runId:'isolated-chain-negative',sha256:'fixture',file:'fixture-only',date:'2026-10-16',expiresAt:new Date(Date.now()+60000).toISOString(),journalFile};
 auth.scope='cleanup-29-c16-deferred';
 const real=require('./cleanup-maintenance-context');
 const context={scopedPolicy:real.scopedPolicy,requiredSteps:real.requiredSteps,verifyScopedItems:real.verifyScopedItems,ROOT:runtime,RUNTIME:runtime,authorization:()=>auth,receipts:()=>({retired:[],history:[],intraday:[]}),hash:f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'),verifyJournal:()=>true};
 const file=path.join(__dirname,'run-cleanup-maintenance.js'),native=createRequire(file);
 const ctx={require:n=>n==='./cleanup-maintenance-context'?context:n==='./twse-trading-day'?{isTwseTradingDay:async()=>({isTradingDay:true,date:'2026-10-16',source:'fixture'})}:n==='child_process'?{spawn:()=>{throw Error('real_child_forbidden');}}:native(n),process:{argv:['node','fixture','--apply','--authorization=fixture'],env:{},execPath:process.execPath},console,setTimeout,clearTimeout,calls,fs};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(file,'utf8').split('main().catch(')[0],ctx);
 vm.runInContext(`command=async(file,args,log)=>{calls.push(args.join(' '));fs.writeFileSync(log,'isolated fixture');return {exitCode:args.some(a=>a.includes('cleanup-daytrade-intraday-retention'))?1:0};}`,ctx);
 await assert.rejects(vm.runInContext('main()',ctx),/cleanup_item_set_incomplete/);
 const journal=JSON.parse(fs.readFileSync(journalFile));assert.equal(journal.firstFailure.reason,'cleanup_item_set_incomplete');assert.equal(journal.steps.length,8);assert.equal(journal.steps.some(x=>x.name==='intraday'),false);assert.equal(journal.protection.ok,true);assert(journal.finishedAt);assert.equal(fs.existsSync(path.join(runtime,'locks','cleanup-maintenance.lock')),false);assert.equal(calls.some(x=>x.includes('cleanup-runtime-retention')),true);
});
