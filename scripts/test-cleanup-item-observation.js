'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),os=require('os'),vm=require('vm'),crypto=require('crypto'),{createRequire}=require('module');
const proof=require('./cleanup-item-observation');
const evidenceRoot=path.resolve(__dirname,'../../../outputs/TOM-CLEANUP-FIRST-COMPLETE-20261017/item-evidence-20261017/fixtures');fs.mkdirSync(evidenceRoot,{recursive:true});
const base=fs.mkdtempSync(path.join(evidenceRoot,'cleanup-29-evidence-')); 
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function put(file,content,old=true){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,content);if(old){const d=new Date(Date.now()-90*86400000);fs.utimesSync(file,d,d);}return file;}
function load(name,runtime,auth,overrides={}){const file=path.join(__dirname,name),native=createRequire(file);const ctx={module:{exports:{}},__dirname,require:n=>n in overrides?overrides[n]:n==='./cleanup-maintenance-context'?{authorization:()=>auth}:native(n),process:{argv:['node',name,'--apply','--json','--maintenance-authorization=fixture','--root',path.join(runtime,'mirror'),'--runtime-root',runtime],env:{FUMAN_RUNTIME_DIR:runtime},execPath:process.execPath},console:{log:()=>{}},Date,Intl,Buffer,URL,URLSearchParams,AbortSignal,setTimeout,clearTimeout};vm.createContext(ctx);vm.runInContext(fs.readFileSync(file,'utf8').split('main().catch(')[0].replace(/if\s*\(require.main\s*===\s*module\)\s*$/,''),ctx);return ctx;}
test('C01-C08 real isolated runner writes eight independently reconciled observations',async()=>{
 const runtime=path.join(base,'retired'),auth={runId:'isolated-retired-'+crypto.randomUUID(),sha256:'fixture',issuedAt:new Date().toISOString()};fs.mkdirSync(path.join(runtime,'mirror'),{recursive:true});
 const files=['mirror/scan-strategy4.js','archive/strategy2-intraday/static-latest/old.json','archive/strategy2-intraday/history/old.json','cache/fugle/historical-legacy-mixed-units-old/old.json','data/retired/old.json','data/scan-receipts/scan-20200101.json','data/old.bak'];for(const file of files)put(path.join(runtime,file),'{}');
 const protectedFile=put(path.join(runtime,'data/scan-receipts/latest.json'),'protected'),protectedHash=sha(fs.readFileSync(protectedFile));
 const ctx=load('cleanup-api-only-retired-artifacts.js',runtime,auth),front=vm.runInContext('RUNTIME_STALE_FRONT_PAGE_FILES[0]',ctx);put(path.join(runtime,front),'{}');
 await vm.runInContext('main()',ctx);
 const r=JSON.parse(fs.readFileSync(path.join(runtime,'status/api-only-retired-cleanup-status.json')));assert.equal(r.ok,true);assert.equal(r.cleanupItems.length,8);
 for(const item of r.cleanupItems){assert.equal(proof.verify(item).status,'complete');if(['C06','C07','C08'].includes(item.id)){assert.equal(item.deleted,0);assert(item.protectedExclusions.length>0);}else assert(item.deleted>=1,item.id+' had no positive deletion');assert.equal(item.remaining,0);}
 assert.equal(sha(fs.readFileSync(protectedFile)),protectedHash);
 console.log(JSON.stringify({scope:'C01-C08 isolated execution',receipt:path.join(runtime,'status/api-only-retired-cleanup-status.json')}));
});
test('raw observation detects retained-data corruption, missing candidates and fabricated totals',()=>{
 const h=sha('a'),p={contract:'cleanup-item-observation-v1',id:'C01',runId:'isolation',inventoryComplete:true,readbackComplete:true,before:[{key:'old',sha256:h},{key:'protected',sha256:h}],after:[{key:'protected',sha256:h}],candidates:['old']};
 assert.equal(proof.reconcile(p).deleted,1);assert.throws(()=>proof.reconcile({...p,after:[]}),/protected_changed/);assert.throws(()=>proof.reconcile({...p,candidates:['unknown']}),/candidates_invalid/);
 const item=proof.persist(path.join(base,'raw.json'),p);assert.equal(proof.verify(item).deleted,1);assert.throws(()=>proof.verify({...item,deleted:900}),/summary_mismatch/);
 assert.throws(()=>proof.reconcile({...p,protectedExclusions:[{key:'old',reason:'claimed hold'}]}),/exclusions_invalid/);
 assert.throws(()=>proof.reconcile({...p,protectedExclusions:[{key:'not-in-inventory',reason:'unknown'}]}),/exclusions_invalid/);
 assert.throws(()=>proof.verify({...item,scanned:0}),/summary_mismatch/);
});
test('C17 C18 runner protects held evidence and independently reads eligible file removal',async()=>{
 const runtime=path.join(base,'runtime'),auth={runId:'isolated-runtime-'+crypto.randomUUID(),sha256:'fixture',issuedAt:new Date().toISOString()};
 put(path.join(runtime,'locks/supabase-rest-pool-incident.json'),JSON.stringify({status:'resolved',id:'old',resolvedAt:'2020-01-01'}));
 const old=new Date(Date.now()-40*86400000).toISOString();
 put(path.join(runtime,'state/daytrade-unattended-gate-watchdog-evidence-old.json'),JSON.stringify({ok:true,checkedAt:old,formalAcceptance:false,rollbackRequired:false}));
 put(path.join(runtime,'state/daytrade-unattended-gate-watchdog-evidence-hold.json'),JSON.stringify({ok:true,checkedAt:old,formalAcceptance:true,rollbackRequired:false}));
 put(path.join(runtime,'cache/fugle/expired.json'),'{}');put(path.join(runtime,'cache/fugle/current.json'),'current',false);
 const ctx=load('cleanup-runtime-retention.js',runtime,auth,{'./run-cleanup-local-assets':{run:async()=>({ok:true,candidates:[],processed:[]})},'./cleanup-extended-retention':{referenceInventory:async()=>({files:[],contains:()=>false})}});
 await vm.runInContext('main()',ctx);const file=fs.readdirSync(path.join(runtime,'status')).find(f=>f.startsWith('runtime-retention-'));const receipt=JSON.parse(fs.readFileSync(path.join(runtime,'status',file)));
 assert.equal(receipt.ok,true);assert.deepEqual(receipt.cleanupItems.map(i=>[i.id,proof.verify(i).deleted]),[['C17',1],['C18',0]]);
 const cache=proof.verify(receipt.cleanupItems.find(i=>i.id==='C18'));assert.equal(cache.scanned,2);assert.equal(cache.protectedExclusions.length,1);assert.equal(cache.protectedSet.length,2);assert.equal(cache.protectedExclusions[0].reason,'lab_reference_or_safety_unverified');
 console.log(JSON.stringify({scope:'C17 C18 isolated execution; local-assets excluded',receipt:path.join(runtime,'status',file)}));
});
test('C09-C15 actual history runner with paginated isolated service and independent readback',async()=>{
 const runtime=path.join(base,'history'),auth={runId:'isolated-history-'+crypto.randomUUID(),sha256:'fixture',issuedAt:new Date().toISOString()};fs.mkdirSync(runtime,{recursive:true});
 const referenceContext=load('cleanup-extended-retention.js',runtime,auth);
 const ctx=load('cleanup-supabase-vercel-history.js',runtime,auth,{'./cleanup-extended-retention':referenceContext.module.exports,'../lib/server-supabase-key':{serviceRoleKey:()=> 'isolation',terminalSupabaseUrl:()=> 'https://isolation.invalid'}});
 // This script has a guarded main; remove the dangling guard in this VM.
 const configs=JSON.parse(vm.runInContext('JSON.stringify({runs:RUN_TABLES,events:EVENT_TABLES,snapshots:SNAPSHOT_TABLES,dates:DATE_RETENTION_TABLES})',ctx));
 const db=new Map();let reads=0,deletes=0;
 for(const c of configs.runs){const rows=Array.from({length:c.key==='strategy2'?63:23},(_,i)=>({run_id:c.key+'-'+i,strategy:c.strategy,status:'complete',complete:true,[c.dateColumn]:new Date(Date.now()-(90+i)*86400000).toISOString()}));db.set(c.runsTable,rows);db.set(c.resultsTable,rows.map((r,i)=>({id:i,run_id:r.run_id,strategy:c.strategy,symbol:'2330',price:123})));}
 for(const c of [...configs.events,...configs.snapshots,...configs.dates])db.set(c.table,[{id:1,symbol:'__fuman_old',[c.dateColumn]:'2020-01-01'},{id:2,symbol:'__fuman_current',[c.dateColumn]:c.dateColumn==='trade_date'?new Date().toISOString().slice(0,10):new Date().toISOString()}]);
 ctx.fetch=async(url,options)=>{assert(url.startsWith('https://isolation.invalid/rest/v1/'));const u=new URL(url),table=u.pathname.split('/').at(-1);
  if(table==='fuman_cleanup_history_recovery_bound_v1'){
   const body=JSON.parse(options.body),rows=db.get(body.p_table),column=body.p_table==='mobile_update_events'?'created_at':body.p_table==='market_snapshots'?'updated_at':'trade_date';
   const selected=rows.filter(r=>r[column]!=null&&String(r[column])<body.p_cutoff&&(body.p_table!=='market_snapshots'||String(r.symbol).startsWith('__fuman_')));
   assert(selected.every(r=>body.p_archived_rows.some(a=>JSON.stringify(a)===JSON.stringify(r))));deletes++;db.set(body.p_table,rows.filter(r=>!selected.includes(r)));
   return {ok:true,status:200,text:async()=>JSON.stringify({ok:true,contract:'history-recovery-bound-v1',table:body.p_table,deleted:selected.length,deletedRows:selected})};
  }
  const rows=db.get(table);assert(rows,'unexpected table '+table);const selected=rows.filter(row=>[...u.searchParams].every(([key,v])=>{if(['select','limit','offset','order'].includes(key))return true;if(v.startsWith('lt.'))return row[key]!=null&&String(row[key])<v.slice(3);if(v.startsWith('eq.'))return row[key]===v.slice(3);if(v.startsWith('in.'))return [...v.matchAll(/"([^\"]+)"/g)].some(m=>m[1]===row[key]);if(v.startsWith('like.'))return String(row[key]).startsWith('__fuman_');throw Error('unsupported fixture filter '+v);}));
 let returned;if(options.method==='DELETE'){deletes++;db.set(table,rows.filter(r=>!selected.includes(r)));returned=selected;}else{reads++;const offset=Number(u.searchParams.get('offset')||0);returned=selected.slice(offset,offset+Math.min(3,Number(u.searchParams.get('limit')||3)));}
 return {ok:true,status:200,text:async()=>JSON.stringify(returned),headers:{get:()=>`0-0/${selected.length}`}};
 };
 ctx.process.env.VERCEL_TOKEN='isolation';ctx.process.argv=['node','fixture','--apply','--json','--maintenance-authorization=fixture'];
 ctx.deployments=Array.from({length:12},(_,i)=>({uid:'preview-'+i,target:'preview',createdAt:Date.now()-(50+i)*86400000,url:'fixture-'+i,alias:[],state:'READY'}));ctx.deployments.push({uid:'production',target:'production',createdAt:Date.now()-100*86400000,url:'production',alias:['fuman-terminal.vercel.app'],state:'READY'});
 require('./cleanup-deployment-fixture.cjs').seed(runtime,ctx.deployments.filter(d=>d.target==='preview'),auth.issuedAt);
 vm.runInContext(`vercelProject=()=>({projectId:'fixture',orgId:'fixture'});vercelRequest=async(route,token,method)=>{if(method==='DELETE'){const id=route.split('/').at(-1);deployments=deployments.filter(d=>d.uid!==id);return {};}if(route.startsWith('/v13/'))return deployments.find(d=>d.uid===route.split('/').at(-1).split('?')[0]);const u=new URL('https://isolation.invalid'+route),i=Number(u.searchParams.get('until')||0);return {deployments:deployments.slice(i,i+2),pagination:{next:i+2<deployments.length?i+2:null}};};`,ctx);
 await vm.runInContext('main()',ctx);
 const file=path.join(runtime,'status/supabase-vercel-history-cleanup-status.json'),receipt=JSON.parse(fs.readFileSync(file));assert.equal(receipt.ok,true,JSON.stringify(receipt));assert.equal(receipt.cleanupItems.length,7);for(const item of receipt.cleanupItems){assert.equal(proof.verify(item).status,'complete');if(['C09','C10'].includes(item.id)){assert.equal(item.deleted,0);assert(item.protectedExclusions.length>0);}else assert(item.deleted>0,item.id);}
 assert(reads>100);assert(deletes>0);console.log(JSON.stringify({scope:'C09-C15 isolated service; not formal DB',receipt:file,reads,deletes}));
});
test('N01-N05 actual local-assets runner verifies delete gzip and Git retirement',async()=>{
 const runtime=path.join(base,'local'),mirror=path.join(runtime,'mirror'),cp=require('child_process'),L=require('./cleanup-local-assets');fs.mkdirSync(mirror,{recursive:true});
 const git=(cwd,args)=>cp.execFileSync('git',['-c','maintenance.auto=false','-c','gc.auto=0','-C',cwd,...args],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();
 git(mirror,['init']);git(mirror,['config','user.email','isolated@example.invalid']);git(mirror,['config','user.name','Isolated']);put(path.join(mirror,'.gitignore'),'node_modules/\n',false);git(mirror,['add','.gitignore']);git(mirror,['commit','-m','isolated']);
 const cacheRepo=path.join(runtime,'cache-repo'),worktree=path.join(runtime,'old-worktree');git(mirror,['worktree','add','--detach',cacheRepo]);git(mirror,['worktree','add','--detach',worktree]);const head=git(mirror,['rev-parse','HEAD']);
 const auth={runId:'isolated-local-'+crypto.randomUUID(),sha256:'fixture',issuedAt:new Date().toISOString()},old=new Date(Date.now()-90*86400000).toISOString(),entries=[];
 function entry(category,p,extra={}){for(const f of L.files(p))fs.utimesSync(f,new Date(old),new Date(old));const evidence={contract:'cleanup-local-retirement-evidence-v1',type:L.policy.categories[category].evidenceType,path:p,retiredAt:old,status:'closed',formalEvidence:false,rollbackRequired:false,unresolvedWork:false,leasePaths:[],owner:'isolated-test',reason:'fixture retirement',checkedAt:new Date().toISOString(),treeSha256:L.hash(JSON.stringify(L.fingerprint(p))),sealedAt:old,readerSupportsGzip:true,ownerPid:999999,terminatedAt:old,...extra};const evidenceFile=put(path.join(runtime,'evidence',category+'.json'),JSON.stringify(evidence),false);entries.push({path:p,category,retiredAt:old,evidenceFile,evidenceSha256:L.hash(fs.readFileSync(evidenceFile))});}
 const cache=put(path.join(cacheRepo,'node_modules/generated.js'),'generated');entry('retired_cache',path.dirname(cache),{repository:cacheRepo,integratedCommit:head,retainedRollbackRoot:mirror});
 entry('test_artifact',put(path.join(runtime,'outputs/closed.png'),'image'));
 entry('sealed_log',put(path.join(runtime,'logs/sealed.log'),'log'));
 entry('retired_worktree',worktree,{repository:worktree,integratedCommit:head,retainedRollbackRoot:mirror,worktreeOwner:mirror});
 entry('interrupted_temp',put(path.join(runtime,'tmp/abandoned.tmp'),'partial'));
 const held=put(path.join(runtime,'outputs/held.png'),'preserve');entries.push({path:held,category:'test_artifact',retiredAt:old,evidenceFile:'absent',evidenceSha256:'absent'});
 put(path.join(runtime,'config/cleanup-local-assets.json'),JSON.stringify({contract:'cleanup-local-assets-manifest-v1',entries}),false);
 const policy={...L.policy,protectedRoots:[mirror],allowedRoots:[runtime]};const native=createRequire(path.join(__dirname,'run-cleanup-local-assets.js'));
 const realFs={...fs,readFileSync:(file,...args)=>String(file).endsWith('release_root_authority_v1.json')?JSON.stringify({productionRoot:mirror}):fs.readFileSync(file,...args)};
 const ctx=load('run-cleanup-local-assets.js',runtime,auth,{'fs':realFs,'./cleanup-local-assets':{...L,policy,activity:()=>({processes:[],tasks:[]})},'child_process':{spawnSync:()=>({status:0})},'./cleanup-extended-retention':{referenceInventory:async()=>({files:[],contains:()=>false})}});
 // Import path does not invoke CLI; explicit call executes the actual existing run function.
 const receipt=await vm.runInContext("module.exports.run({apply:true,maintenanceAuthorization:'fixture'})",ctx);
 assert.equal(receipt.ok,true,JSON.stringify(receipt.errors));assert.equal(receipt.cleanupItems.length,5);
 for(const item of receipt.cleanupItems){assert.equal(proof.verify(item).status,'complete');if(['N01','N04'].includes(item.id)){assert.equal(item.deleted,0);assert.equal(item.protectedExclusions.length,1);assert.equal(item.scanned,1);}else assert(item.deleted>0,item.id);}
 assert.equal(fs.readFileSync(held,'utf8'),'preserve');assert.equal(git(mirror,['worktree','list','--porcelain']).includes(worktree.replaceAll('\\','/')),true);
 assert.equal(L.verify(receipt).ok,true);fs.writeFileSync(held,'damaged');assert.equal(L.verify(receipt).ok,false);fs.writeFileSync(held,'preserve');
 console.log(JSON.stringify({scope:'N01-N05 isolated filesystem and Git',receipt:receipt.receiptFile}));
});
test('C19 cache runner removes invalid entries and preserves every other cache field',()=>{
 const runtime=path.join(base,'priority'),auth={runId:'isolated-priority-'+crypto.randomUUID(),sha256:'fixture'},date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 put(path.join(runtime,'cache/intraday/fugle-daytrade-ws-priority-symbols.json'),JSON.stringify({tradeDate:date,daytradePrioritySymbols:['1111','2330'],priceBySymbol:{'1111':20,'2330':100},readerState:{keep:'unchanged'}}),false);
 const ctx=load('cleanup-daytrade-stale-priority-cache.js',runtime,auth);const receipt=JSON.parse(fs.readFileSync(path.join(runtime,'status',fs.readdirSync(path.join(runtime,'status')).find(n=>n.startsWith('daytrade-stale-')))));
 assert.equal(receipt.ok,true);assert.equal(proof.verify(receipt.cleanupItems[0]).deleted,1);assert.equal(receipt.cleanupItems[0].remaining,0);
 console.log(JSON.stringify({scope:'C19 isolated cache',receipt:receipt.receiptFile}));
});
test('C24 compaction preserves pending failed unreadable claims and every non-body field',()=>{
 const runtime=path.join(base,'notifications'),auth={runId:'isolated-notification-'+crypto.randomUUID(),sha256:'fixture'},dir=path.join(runtime,'state/notification-guard/claims');
 for(const status of ['sent','pending','failed'])put(path.join(dir,status+'.json'),JSON.stringify({status,idempotencyKey:status,payloadHash:'original',recordedAt:'2020-01-01',body:'message',extraEvidence:'keep'}));put(path.join(dir,'unreadable.json'),'not JSON');
 const ctx=load('cleanup-extended-retention.js',runtime,auth);ctx.fixtureAuth=auth;
 const r=vm.runInContext('notificationCleanup(true,{contains:()=>false},undefined,fixtureAuth)',ctx);assert.equal(r.compacted,1);assert.equal(proof.verify(r.itemEvidence).deleted,1);assert(r.itemEvidence.protectedSet.length>10);
 console.log(JSON.stringify({scope:'C24 isolated claims',evidence:r.itemEvidence.evidence[0].file}));
});
for(const fault of ['calendar','old_date','partial'])test('Root independent entry refuses '+fault,async()=>{
 const runtime=path.join(base,'root-'+fault),auth={},today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const file=path.join(runtime,'status','cleanup-total-'+today.replaceAll('-','')+'.json');put(file,JSON.stringify({contract:'cleanup-total-v1',tradeDate:fault==='old_date'?'2000-01-01':today,complete:false,status:'failed',exitCode:1}),false);
 const ctx=load('verify-daily-retention-maintenance.js',runtime,auth,{'child_process':{spawnSync:()=>({status:0,stdout:'',stderr:''})},'./twse-trading-day':{isTwseTradingDay:async()=>fault==='calendar'?{error:'unavailable'}:{isTradingDay:true,source:'isolated-calendar'}},'./cleanup-maintenance-context':require('./cleanup-maintenance-context')});ctx.process.argv=['node','fixture','--single-start'];
 await assert.rejects(vm.runInContext('main()',ctx),fault==='calendar'?/calendar_unverified/:/scoped_total_not_complete/);
 assert.equal(fs.existsSync(path.join(runtime,'status','daily-retention-maintenance-verifier-'+today.replaceAll('-','')+'.json')),false);
});
