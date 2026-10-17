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
 fs.mkdirSync(path.join(runtime,'state'),{recursive:true});fs.mkdirSync(path.join(runtime,'config'));
 const nowMs=Date.now(),old=new Date(nowMs-40*86400000),records=[];
 for(const [name,incidentState]of [['success','none'],['incident','open']]){const file=path.join(runtime,'state',`daytrade-unattended-gate-watchdog-evidence-${name}.json`);fs.writeFileSync(file,JSON.stringify({ok:incidentState==='none',fixture:true}));fs.utimesSync(file,old,old);records.push({...good,path:file,incidentState,completedAt:old.toISOString(),reviewedAt:new Date().toISOString(),sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')});}
 fs.writeFileSync(path.join(runtime,'config','cleanup-evidence-protection.json'),JSON.stringify({contract:'cleanup-evidence-protection-v1',entries:records}));
 const file=path.join(__dirname,'cleanup-runtime-retention.js'),native=createRequire(file);const ctx={require:n=>n==='./run-cleanup-local-assets'?{run:async()=>({ok:true,candidates:[],processed:[]})}:native(n),__dirname,process:{env:{FUMAN_RUNTIME_DIR:runtime},argv:['node','fixture','--apply','--json']},console:{log:()=>{}}};vm.createContext(ctx);vm.runInContext(fs.readFileSync(file,'utf8').split('main().catch(')[0],ctx);await vm.runInContext('main()',ctx);
 assert.equal(fs.existsSync(records[0].path),false);assert.equal(crypto.createHash('sha256').update(fs.readFileSync(records[1].path)).digest('hex'),records[1].sha256);
 const receipt=JSON.parse(fs.readFileSync(path.join(runtime,'status',fs.readdirSync(path.join(runtime,'status'))[0])));assert.equal(receipt.deleted,1);assert.equal(receipt.evidenceReviewComplete,true);assert.equal(receipt.ok,true);
});
test('C16 apply blocked before any legacy RPC (which writes even in dry-run)',async()=>{let calls=0;const ctx=load('cleanup-daytrade-intraday-retention.js',async()=>{calls++;throw Error('network forbidden');});await assert.rejects(vm.runInContext('main()',ctx),/C16_RESTORE_NO_GO/);assert.equal(calls,0);});
test('stage receipt does not overwrite final day receipt',()=>{const s=fs.readFileSync(path.join(__dirname,'verify-daily-retention-maintenance.js'),'utf8');assert(s.includes('phase === "stage" ? "stage" : "verifier"'));assert(s.includes('waiting_dependency'));});
test('existing nine-step orchestrator stops at C16 and preserves failure journal',async()=>{
 const os=require('os'),crypto=require('crypto');const runtime=fs.mkdtempSync(path.join(os.tmpdir(),'cleanup-chain-'));
 fs.mkdirSync(path.join(runtime,'data','scan-receipts'),{recursive:true});
 const journalFile=path.join(runtime,'status','journal.json'),calls=[];
 const auth={runId:'isolated-chain-negative',sha256:'fixture',file:'fixture-only',date:'2026-10-16',journalFile};
 const context={ROOT:runtime,RUNTIME:runtime,authorization:()=>auth,receipts:()=>({retired:[],history:[],intraday:[]}),hash:f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'),verifyJournal:()=>{throw Error('must_not_finalize_failed_chain');}};
 const file=path.join(__dirname,'run-cleanup-maintenance.js'),native=createRequire(file);
 const ctx={require:n=>n==='./cleanup-maintenance-context'?context:n==='./twse-trading-day'?{isTwseTradingDay:async()=>({isTradingDay:true,date:'2026-10-16',source:'fixture'})}:n==='child_process'?{spawn:()=>{throw Error('real_child_forbidden');}}:native(n),process:{argv:['node','fixture','--apply','--authorization=fixture'],env:{},execPath:process.execPath},console,setTimeout,clearTimeout,calls,fs};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(file,'utf8').split('main().catch(')[0],ctx);
 vm.runInContext(`command=async(file,args,log)=>{calls.push(args.join(' '));fs.writeFileSync(log,'isolated fixture');return {exitCode:args.some(a=>a.includes('cleanup-daytrade-intraday-retention'))?1:0};}`,ctx);
 await assert.rejects(vm.runInContext('main()',ctx),/cleanup_stage_failed:intraday/);
 const journal=JSON.parse(fs.readFileSync(journalFile));assert.equal(journal.firstFailure.step,'intraday');assert.deepEqual(journal.steps.map(x=>x.name),['retired','history','intraday']);assert.equal(journal.protection.ok,true);assert(journal.finishedAt);assert.equal(fs.existsSync(path.join(runtime,'locks','cleanup-maintenance.lock')),false);assert.equal(calls.some(x=>x.includes('cleanup-runtime-retention')),false);
});

