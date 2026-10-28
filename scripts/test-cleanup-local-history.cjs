'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),L=require('./cleanup-local-assets');
const root=fs.mkdtempSync(path.join(path.resolve(__dirname,'../..'),'history-fixture-'));
const now=Date.parse('2026-10-28T16:45:00+08:00'),old='2026-10-01T00:00:00+08:00';let checks=0;
const reference=path.join(root,'reference.json');fs.writeFileSync(reference,'{}');
const ctx={policy:{...L.policy,protectedRoots:[],intakeInventoryRoots:[],categories:JSON.parse(JSON.stringify(L.policy.categories)),engineeringArchiveRoot:path.join(root,'archive')},now,activity:{processes:[],tasks:[]},referenced:()=>false};
fs.mkdirSync(ctx.policy.engineeringArchiveRoot);
for(const rule of Object.values(ctx.policy.categories))rule.allowedRoots=[root];
function fixture(category,relative,payload){const file=path.join(root,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(payload||{contract:'fixture',tradeDate:'2026-10-01'}));fs.utimesSync(file,new Date(old),new Date(old));const treeSha256=L.hash(JSON.stringify(L.fingerprint(file))),closureFile=file+'.closure.json';fs.writeFileSync(closureFile,JSON.stringify({contract:'cleanup-local-closure-v1',status:'closed',complete:true,path:file,treeSha256,runId:'closed-isolated',owner:'test',closedAt:old,testPassed:true}));const e={contract:'cleanup-local-retirement-evidence-v1',type:ctx.policy.categories[category].evidenceType,path:file,retiredAt:old,status:'closed',formalEvidence:false,rollbackRequired:false,unresolvedWork:false,owner:'test',reason:'isolated closed artifact',checkedAt:new Date(now).toISOString(),leasePaths:[],treeSha256,closureFile,closureSha256:L.hash(fs.readFileSync(closureFile)),referenceAuditComplete:true,referenceSources:[{path:reference,sha256:L.hash(fs.readFileSync(reference))}],references:[],holds:[],consumerSafetyVerified:true,referenceReviewedAt:new Date(now).toISOString(),artifactKind:'simulated_database',tradeDate:'2026-10-01',sourceContract:'fixture',canonicalRunId:'fixture',historyClassification:'retired_history',warmupReferenced:false,strategyReferenced:false,terminatedAt:old,ownerPid:999999};const evidenceFile=file+'.retirement.json';fs.writeFileSync(evidenceFile,JSON.stringify(e));return {path:file,category,retiredAt:old,evidenceFile,evidenceSha256:L.hash(fs.readFileSync(evidenceFile))};}
function change(entry,delta){const e=JSON.parse(fs.readFileSync(entry.evidenceFile));Object.assign(e,delta);fs.writeFileSync(entry.evidenceFile,JSON.stringify(e));return {...entry,evidenceSha256:L.hash(fs.readFileSync(entry.evidenceFile))};}
function rejects(entry,regex){assert.throws(()=>L.validate(entry,ctx),regex);checks++;}
const good=fixture('engineering_test','closed-sim.sqlite');assert(L.validate(good,ctx));checks++;
rejects(change(good,{consumerSafetyVerified:false}),/consumer_reference/);
rejects(change(good,{consumerSafetyVerified:true,unresolvedWork:true}),/retirement_evidence/);
rejects(change(good,{unresolvedWork:false,referenceReviewedAt:old}),/review_not_current/);
rejects(change(good,{referenceReviewedAt:new Date(now).toISOString(),holds:['open-incident']}),/consumer_reference/);
rejects(fixture('engineering_test','checkpoint-20132.sqlite'),/protected_checkpoint/);
const t=fixture('telegram_history','2026-10-01/telegram-natural-fixture.json');assert(L.validate(t,ctx));checks++;
rejects(change(t,{tradeDate:'2026-10-02'}),/path_date_mismatch/);
const wrapped=fixture('telegram_history','2026-10-01/telegram-natural-wrapped.json',{result:{contract:'fixture',trade_date:'2026-10-01',run_id:'r',source_run_id:'s'},sourceProof:{contract:'three_detectors_natural_source_verifier_v1',trade_date:'2026-10-01',run_id:'r',source_run_id:'s'}});assert(L.validate(wrapped,ctx));checks++;
const wrong=fixture('telegram_history','2026-10-01/telegram-natural-wrong.json',{contract:'other',tradeDate:'2026-10-01'});rejects(wrong,/payload_identity/);
const plan=fixture('telegram_plan','2026-10-01/plan-evidence/hash.json');assert(L.validate(plan,ctx));checks++;
const mother=fixture('mother_pool_history','historical.json');assert(L.validate(mother,ctx));checks++;
rejects(change(mother,{warmupReferenced:true}),/mother_pool_history/);
const backup=fixture('engineering_backup','retired.bak');const item=L.validate(backup,ctx),done=L.applyOne(item);assert(!fs.existsSync(backup.path));assert.equal(L.hash(JSON.stringify(L.fingerprint(done.backupArchive))),item.treeSha256);checks++;
const receipt={contract:L.policy.contract,applied:true,ok:true,runId:'fixture',categories:Object.keys(L.policy.categories),inventory:[],candidates:[item],processed:[done],preserved:[],errors:[],protectedEvidence:[]};assert.equal(L.verify(receipt).ok,true);checks++;
fs.appendFileSync(done.backupArchive,'corrupt');assert.equal(L.verify(receipt).ok,false);checks++;
const denied=fixture('engineering_test','no-pass.sqlite'),c=JSON.parse(fs.readFileSync(denied.evidenceFile));fs.writeFileSync(c.closureFile,JSON.stringify({status:'closed'}));rejects(denied,/closure_proof_hash/);
console.log(JSON.stringify({ok:true,checks,fixture:root,productionActions:false}));
// Full local runner wiring with explicit isolated external reference/activity providers.
(async()=>{
const vm=require('vm'),{createRequire}=require('module');
const runtime=path.join(root,'runtime');fs.mkdirSync(path.join(runtime,'config'),{recursive:true});
const entries=[fixture('engineering_test','integration/simulated.sqlite'),fixture('telegram_history','2026-10-01/telegram-natural-integration.json'),fixture('telegram_plan','2026-10-01/plan-evidence/integration.json'),fixture('mother_pool_history','integration/history.json'),fixture('closed_execution','integration/stopped.tmp'),fixture('engineering_backup','integration/retired.bak')];
fs.writeFileSync(path.join(runtime,'config/cleanup-local-assets.json'),JSON.stringify({contract:'cleanup-local-assets-manifest-v1',entries}));
const file=path.join(__dirname,'run-cleanup-local-assets.js'),native=createRequire(file),auth={runId:'cleanup-history-isolated',sha256:'isolated'},testLib={...L,policy:ctx.policy,activity:()=>({processes:[],tasks:[]})};
const context={module:{exports:{}},__dirname,process:{env:{FUMAN_RUNTIME_DIR:runtime},execPath:process.execPath,pid:process.pid},require:n=>n==='./cleanup-local-assets'?testLib:n==='child_process'?{spawnSync:()=>({status:0})}:n==='./cleanup-maintenance-context'?{authorization:()=>auth}:n==='./cleanup-extended-retention'?{referenceInventory:async()=>({contains:()=>false,files:[]})}:native(n),console};
vm.createContext(context);vm.runInContext(fs.readFileSync(file,'utf8').split('if(require.main===module)')[0],context);
const result=await context.module.exports.run({apply:true,maintenanceAuthorization:'isolated-provider'});
assert.equal(result.ok,true,JSON.stringify(result.errors));assert.equal(result.processed.length,6);assert.equal(result.counts.deletedFiles,6);assert.equal(result.cleanupItems.length,5);for(const item of result.cleanupItems)assert.equal(require('./cleanup-item-observation').verify(item).status,'complete');assert.equal(L.verify(result).ok,true);
assert.equal(L.verify({...result,counts:{...result.counts,deletedFiles:999}}).ok,false);
console.log(JSON.stringify({ok:true,scope:'six new categories through real local runner and N01-N05 independent readback; external providers isolated',runId:result.runId,receipt:result.receiptFile,productionActions:false}));
})().catch(e=>{console.error(e);process.exitCode=1;});
