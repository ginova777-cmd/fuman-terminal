'use strict';
// Test-only provider adapters. Existing fixture setup is reused BEFORE execution;
// no old receipt is loaded, relabelled, or aggregated. All item observations are
// emitted by the real runners using the caller's one runtime and authorization.
const fs=require('fs'),path=require('path'),vm=require('vm'),crypto=require('crypto'),assert=require('node:assert/strict'),{createRequire}=require('module');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const source=name=>fs.readFileSync(path.join(__dirname,name),'utf8').replaceAll('\r\n','\n');
const itemSource=source('test-cleanup-item-observation.js'),dbSource=source('test-cleanup-database-observation.js');
const prelude=itemSource.slice(itemSource.indexOf('const sha='),itemSource.indexOf("test('C01"));
function between(text,start,end){const a=text.indexOf(start);assert(a>=0,'fixture marker missing: '+start);const b=text.indexOf(end,a+start.length);assert(b>=0,'fixture marker missing: '+end);return text.slice(a+start.length,b);}
function body(text,title){return between(text,"test('"+title+"',async()=>{",'\n});');}
function compile(code){return new AsyncFunction('require','__dirname','runtime','auth','shared',`const fs=require('fs'),path=require('path'),vm=require('vm'),crypto=require('crypto'),assert=require('node:assert/strict'),{createRequire}=require('module'),proof=require('./cleanup-item-observation');const base=runtime;\n${prelude}\n${code}`);}
async function execute(code,runtime,auth,shared){
 const result=await compile(code)(require,__dirname,runtime,auth,shared);
 if(result?.process?.exitCode!==undefined&&result.process.exitCode!==0)throw Error('isolated_runner_nonzero_exit:'+result.process.exitCode);
 if(result?.ok===false)throw Error('isolated_runner_failed:'+JSON.stringify(result.errors||result.issues||[]));
 return result;
}
function trimAt(code,marker){const i=code.indexOf(marker);assert(i>=0,'fixture execution marker missing '+marker);return code.slice(0,i);}
function itemBody(title){return body(itemSource,title);}

async function retired(runtime,auth,shared){let c=itemBody('C01-C08 real isolated runner writes eight independently reconciled observations');c=c.replace(/ const runtime=.*?;fs.mkdirSync/,' fs.mkdirSync');c=trimAt(c,' await vm.runInContext');return execute(c+" await vm.runInContext('main()',ctx);return ctx;",runtime,auth,shared);}
async function history(runtime,auth,shared){let c=itemBody('C09-C15 actual history runner with paginated isolated service and independent readback');c=c.replace(/ const runtime=.*?;fs.mkdirSync/,' fs.mkdirSync');c=trimAt(c,' await vm.runInContext');return execute(c+" await vm.runInContext('main()',ctx);fs.writeFileSync(path.join(runtime,'history-provider-readback.json'),JSON.stringify(Object.fromEntries(db)));return ctx;",runtime,auth,shared);}
async function local(runtime,auth,shared){let c=itemBody('N01-N05 actual local-assets runner verifies delete gzip and Git retirement');c=c.replace(/const runtime=path.join\(base,'local'\),mirror=/,'const mirror=');c=c.replace(/const auth=\{.*?\},old=/,'const old=');c=trimAt(c,' assert.equal(receipt.ok');return execute(c+' return receipt;',runtime,auth,shared);}
async function runtimeStage(runtime,auth,shared){const localReceipt=await local(runtime,auth,shared);let c=itemBody('C17 C18 runner protects held evidence and independently reads eligible file removal');c=c.replace(/ const runtime=.*?;\n/,'\n');c=c.replace("run:async()=>({ok:true,candidates:[],processed:[]})","run:async()=>shared.localReceipt");c=trimAt(c," await vm.runInContext('main()',ctx)");return execute(c+" await vm.runInContext('main()',ctx);return ctx;",runtime,auth,{...shared,localReceipt});}
async function priority(runtime,auth,shared){let c=between(itemSource,"test('C19 cache runner removes invalid entries and preserves every other cache field',()=>{",'\n});');c=c.replace(/ const runtime=.*?,date=/,' const date=');c=trimAt(c,'const receipt=JSON.parse');return execute(c+' return ctx;',runtime,auth,shared);}
async function observability(runtime,auth,shared){let c=body(dbSource,'C20 actual runner binds full PostgreSQL inventory deletion and protected readback to its run');c=c.replace("const db=new PGlite();const runtime=fs.mkdtempSync(path.join(output,'c20-observation-'));","const db=new PGlite();");c=c.replace(/,auth=\{runId:'isolated-c20-'.*?\};/,';');c=trimAt(c,' const receiptFile=');c+=' return ctx; }finally{await db.close();}';return execute(c,runtime,auth,shared);}

async function extended(runtime,auth,shared){
 let c=body(dbSource,'C21-C23 candidate SQL and runner emit same-run full row protection proofs');
 c=c.replace("const db=new PGlite(),runtime=fs.mkdtempSync(path.join(output,'extended-observation-'));","const db=new PGlite();");
 c=c.replace(/,auth=\{runId:'isolated-extended-'.*?\};/,';');
 c=trimAt(c," vm.createContext(ctx)");
 c+=` const verifyHistory=await shared.importHistory(db,runtime,prefixes);await shared.installExtendedProviders(ctx, runtime, auth);vm.createContext(ctx);vm.runInContext(fs.readFileSync(file,'utf8'),ctx);await vm.runInContext('main()',ctx);await verifyHistory();return ctx; }finally{await db.close();}`;
 return execute(c,runtime,auth,{...shared,installExtendedProviders,importHistory});
}
async function importHistory(db,runtime,prefixes){
 const file=path.join(runtime,'history-provider-readback.json');assert(fs.existsSync(file),'history stage readback required before extended stage');
 const history=JSON.parse(fs.readFileSync(file)),expected={};
 for(const prefix of prefixes){
  const runs=prefix+'_runs',results=prefix+'_results';
  await db.exec(`alter table ${runs} add column strategy text;alter table ${runs} add column updated_at timestamptz;alter table ${results} add column strategy text;alter table ${results} add column symbol text;alter table ${results} add column price numeric;update ${results} set id=id+10000;`);
  for(const table of [runs,results]){expected[table]=history[table];assert(Array.isArray(expected[table]));for(const row of expected[table])await db.query(`insert into ${table} select * from jsonb_populate_record(null::${table},$1::jsonb)`,[JSON.stringify(row)]);}
 }
 const normalize=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(v)&&Number.isFinite(Date.parse(v))?new Date(v).toISOString():v;
 return async()=>{let count=0;const hashes=[];for(const [table,rows]of Object.entries(expected)){const actual=(await db.query(`select to_jsonb(t) row from ${table} t`)).rows.map(v=>v.row);for(const row of rows){const found=actual.find(v=>table.endsWith('_runs')?v.run_id===row.run_id:v.id===row.id);assert(found,'prior stage protected row lost '+table);const projected=Object.fromEntries(Object.keys(row).map(k=>[k,normalize(found[k])]));const before=Object.fromEntries(Object.entries(row).map(([k,v])=>[k,normalize(v)]));assert.deepEqual(projected,before,'prior stage protected fields changed '+table);hashes.push({table,key:row.run_id||row.id,sha256:crypto.createHash('sha256').update(JSON.stringify(before)).digest('hex')});count++;}}
  fs.writeFileSync(path.join(runtime,'history-extended-protection-readback.json'),JSON.stringify({scope:'isolated-provider-transfer-and-PostgreSQL-independent-readback',ok:true,rows:count,protected:hashes},null,2));};
}
async function installExtendedProviders(ctx,runtime,auth){
 ctx.Buffer=Buffer;ctx.console={log:()=>{},error:console.error};
 const put=(f,v)=>{fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,v);};
 const old='2020-01-01T00:00:00Z';let blobs=[{pathname:'tests/expired',url:'https://fixture.invalid/expired',size:5,uploadedAt:old},{pathname:'scorecard88/current.json',url:'https://fixture.invalid/protected',size:8,uploadedAt:old}];
 put(path.join(runtime,'secrets/vercel-blob-read-write-token.txt'),'isolated-fixture-token');
 put(path.join(runtime,'config/cleanup-retired-assets.json'),JSON.stringify({entries:[{...blobs[0],owner:'cleanup-managed-test-assets',status:'retired',formalEvidence:false,rollbackRequired:false,referenceAuditComplete:true,retiredAt:old}]}));
 for(const status of ['sent','pending','failed'])put(path.join(runtime,'state/notification-guard/claims',status+'.json'),JSON.stringify({status,idempotencyKey:status,payloadHash:'original',recordedAt:old,body:'message',extraEvidence:'keep'}));
 put(path.join(runtime,'state/notification-guard/claims/unreadable.json'),'not JSON');
 const sdk={list:async({cursor})=>{const i=Number(cursor||0);return {blobs:blobs.slice(i,i+1),hasMore:i+1<blobs.length,cursor:String(i+1)};},head:async url=>blobs.find(b=>b.url===url),del:async url=>{assert(blobs.some(b=>b.url===url));blobs=blobs.filter(b=>b.url!==url);}};
 const originalFetch=ctx.fetch,originalRequire=ctx.require;
 const guardFile=path.join(__dirname,'supabase-incident-guard.js');
 const command=(file,args)=>{
  const script=args?.find(a=>String(a).includes('supabase-incident-guard.js'));
  if(script){const cp=require('child_process');return cp.spawnSync(process.execPath,[guardFile,...args.slice(args.indexOf(script)+1)],{cwd:path.resolve(__dirname,'..'),encoding:'utf8',windowsHide:true,env:{...process.env,FUMAN_RUNTIME_DIR:runtime,FUMAN_RUNTIME_ROOT:runtime}});}
  if(args?.includes('-Command'))return {status:0,stdout:JSON.stringify([{name:'isolated-main',actions:['isolated-runner'],triggers:['17:10']}])};
  if(args?.includes('usage'))return {status:0,stdout:JSON.stringify({pricingUnit:'USD',period:{from:'2026-10-01',to:'2026-10-31'},groupBy:{data:[{name:'fuman-terminal',effectiveCost:0,billedCost:0}]}})};
  if(args?.some(a=>String(a).endsWith('cleanup-duplicate-indexes.cjs')))return {status:0,stdout:JSON.stringify(duplicateResult)};
  throw Error('unmapped isolated command '+JSON.stringify({file,args}));
 };
 // Real duplicate-index runner executes against an isolated stateful RPC fixture.
 let indexes=[{name:'fixture_duplicate',restoreSql:'CREATE INDEX fixture_duplicate ON fixture(id)'}];
 const duplicateFile=path.join(__dirname,'cleanup-duplicate-indexes.cjs'),native=createRequire(duplicateFile);
 const duplicateContext={module:{exports:{}},__dirname,require:n=>n==='node:child_process'?{spawnSync:command}:n==='../lib/server-supabase-key'?{serviceRoleKey:()=> 'fixture',terminalSupabaseUrl:()=> 'https://fixture.invalid'}:native(n),process:{argv:['node','fixture','--apply'],env:{FUMAN_RUNTIME_DIR:runtime},execPath:process.execPath,pid:process.pid},console:{log:()=>{}},AbortSignal,fetch:async(url,options)=>{assert.equal(url,'https://fixture.invalid/rest/v1/rpc/fuman_cleanup_duplicate_indexes_v1');const before=[...indexes];if(JSON.parse(options.body).p_apply)indexes=[];return {ok:true,json:async()=>({ok:true,contract:'duplicate-index-cleanup-v1',count:before.length,indexes:before})};}};
 vm.createContext(duplicateContext);vm.runInContext(source('cleanup-duplicate-indexes.cjs'),duplicateContext);await vm.runInContext('main()',duplicateContext);
 const duplicateResult=JSON.parse(fs.readFileSync(path.join(runtime,'status/duplicate-index-cleanup-status.json')));assert.equal(duplicateResult.ok,true,JSON.stringify(duplicateResult));
 ctx.require=n=>n==='@vercel/blob'?sdk:n==='child_process'?{spawnSync:command}:n==='./cleanup-maintenance-context'?{authorization:()=>auth}:originalRequire(n);
 ctx.process.argv=['node','fixture','--apply','--maintenance-authorization=fixture'];ctx.process.execPath=process.execPath;
 ctx.fetch=async(url,options)=>{
  if(url.startsWith('https://fixture.invalid/storage/v1/')){const data=url.endsWith('/bucket')?[{id:'test'}]:JSON.parse(options.body).offset?[]:[{name:'protected',id:'id-1',metadata:{size:7},updated_at:old}];return {ok:true,text:async()=>JSON.stringify(data)};}
  if(url.endsWith('/rpc/fuman_cleanup_space_readback_v1'))return {ok:true,text:async()=>JSON.stringify({autovacuum:'on',scope:'isolated-provider-fixture',tables:[]})};
  return originalFetch(url,options);
 };
}
function assertIsolatedRuntime(runtime,auth){
 const allowed=path.resolve(__dirname,'../../../outputs/TOM-CLEANUP-FIRST-COMPLETE-20261017'),resolved=path.resolve(runtime),relative=path.relative(allowed,resolved);
 if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||path.dirname(relative)!=='.'||! /^(?:cleanup-parent-run-|shared-adapter-)[a-zA-Z0-9_-]+$/.test(relative))throw Error('isolated_runtime_outside_evidence_root');
 const actualRoot=fs.realpathSync(allowed),actualRuntime=fs.realpathSync(resolved);
 if(fs.lstatSync(resolved).isSymbolicLink()||!fs.statSync(resolved).isDirectory()||path.relative(actualRoot,actualRuntime)!==relative)throw Error('isolated_runtime_link_or_escape');
 if(!auth||! /^[a-z0-9-]{8,90}$/.test(auth.runId)||auth.runtimeRoot&&path.resolve(auth.runtimeRoot)!==resolved)throw Error('isolated_runtime_authorization_mismatch');
}
module.exports=Object.fromEntries(Object.entries({retired,history,runtime:runtimeStage,priority,observability,extended}).map(([stage,run])=>[stage,async(runtime,auth,shared={})=>{assertIsolatedRuntime(runtime,auth);return run(runtime,auth,shared);}])) ;
