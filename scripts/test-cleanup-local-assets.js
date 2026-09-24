"use strict";
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict');
const L=require('./cleanup-local-assets');
const verify=p=>L.verify({ok:true,runId:'isolated',categories:Object.keys(L.policy.categories),inventory:[],preserved:[],protectedEvidence:[],errors:[],candidates:p.processed||[],...p});
const root=fs.mkdtempSync(path.join(os.tmpdir(),'cleanup-local-assets-')),now=Date.now(),old=new Date(now-60*86400000).toISOString();
let checks=0;
function fixture(category,name){const p=path.join(root,name);fs.writeFileSync(p,'test content '.repeat(80));fs.utimesSync(p,new Date(old),new Date(old));const e={contract:'cleanup-local-retirement-evidence-v1',type:L.policy.categories[category].evidenceType,path:p,retiredAt:old,status:'closed',formalEvidence:false,rollbackRequired:false,unresolvedWork:false,leasePaths:[],owner:'isolated-test',reason:'closed isolated job',checkedAt:new Date(now-1000).toISOString(),treeSha256:L.hash(JSON.stringify(L.fingerprint(p))),sealedAt:old,readerSupportsGzip:true,ownerPid:999999,terminatedAt:old};const ef=p+'.evidence.json';fs.writeFileSync(ef,JSON.stringify(e));return {path:p,category,retiredAt:old,evidenceFile:ef,evidenceSha256:L.hash(fs.readFileSync(ef))};}
const ctx={policy:{...L.policy,protectedRoots:[],allowedRoots:[root]},now,activity:{processes:[],tasks:[]},referenced:()=>false};
function reject(entry,context,pattern){assert.throws(()=>L.validate(entry,context),pattern);checks++;}
const item=fixture('test_artifact','closed.png');assert.equal(L.validate(item,ctx).bytes,1040);checks++;
reject(item,{...ctx,referenced:()=>true},/referenced/);
reject(item,{...ctx,activity:{processes:[{CommandLine:item.path}],tasks:[]}},/active/);
reject(item,{...ctx,activity:{processes:[],tasks:[{arguments:item.path}]}},/active/);
reject(item,{...ctx,policy:{...ctx.policy,protectedRoots:[root]}},/protected_root/);
reject({...item,retiredAt:new Date().toISOString()},ctx,/retirement_not_elapsed/);
reject({...item,evidenceSha256:'bad'},ctx,/hash_mismatch/);
fs.appendFileSync(item.path,'changed');fs.utimesSync(item.path,new Date(old),new Date(old));reject(item,ctx,/tree_hash_mismatch/);
const lock=fixture('interrupted_temp','job.lock');reject(lock,ctx,/protected_evidence_or_lock/);
const temp=fixture('interrupted_temp','job.tmp');reject(temp,{...ctx,activity:{processes:[{ProcessId:999999}],tasks:[]}},/active/);
const log=fixture('sealed_log','sealed.log');const planned=L.validate(log,ctx),done=L.applyOne(planned);assert.equal(fs.existsSync(log.path),false);checks++;assert.equal(verify({contract:L.policy.contract,applied:true,processed:[done],errors:[]}).ok,true);checks++;
fs.appendFileSync(done.archive,'corrupt');assert.equal(verify({contract:L.policy.contract,applied:true,processed:[done],errors:[]}).ok,false);checks++;
const image=fixture('test_artifact','removable.png');const removed=L.applyOne(L.validate(image,ctx));assert.equal(fs.existsSync(image.path),false);checks++;assert.equal(verify({contract:L.policy.contract,applied:true,processed:[removed],errors:[]}).ok,true);checks++;
assert.equal(verify({contract:L.policy.contract,applied:false,processed:[]}).ok,false);checks++;
const protectedFile=fixture('test_artifact','protected.png');assert.equal(verify({contract:L.policy.contract,applied:true,processed:[],protectedEvidence:[{path:protectedFile.path,sha256:'wrong'}]}).ok,false);checks++;
function update(entry,changes){const e=JSON.parse(fs.readFileSync(entry.evidenceFile));Object.assign(e,changes);fs.writeFileSync(entry.evidenceFile,JSON.stringify(e));entry.evidenceSha256=L.hash(fs.readFileSync(entry.evidenceFile));return entry;}
const lease=fixture('interrupted_temp','lease.tmp');update(lease,{leasePaths:[protectedFile.path]});reject(lease,ctx,/lease_inventory/);
const backup=fixture('retired_backup','retired.bak');reject(backup,ctx,/replacement_backup/);
const replacement=fixture('retired_backup','retained.bak'),replacementHash=L.hash(JSON.stringify(L.fingerprint(replacement.path))),restoreFile=path.join(root,'restore.json');
fs.writeFileSync(restoreFile,JSON.stringify({contract:'backup-restore-verification-v1',ok:true,backup:replacement.path,treeSha256:replacementHash,checkedAt:new Date(now-1000).toISOString()}));
update(backup,{replacementBackup:replacement.path,replacementTreeSha256:replacementHash,restoreReceiptFile:restoreFile,restoreReceiptSha256:L.hash(fs.readFileSync(restoreFile))});
L.applyOne(L.validate(backup,ctx));assert.equal(fs.existsSync(backup.path),false);assert.equal(fs.existsSync(replacement.path),true);checks++;
const cp=require('child_process');const git=(cwd,args)=>cp.execFileSync('git',['-c','maintenance.auto=false','-c','gc.auto=0','-C',cwd,...args],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();
const owner=path.join(root,'owner'),work=path.join(root,'retired-worktree');fs.mkdirSync(owner);git(owner,['init']);git(owner,['config','user.email','isolated@example.invalid']);git(owner,['config','user.name','Isolated']);fs.writeFileSync(path.join(owner,'.gitignore'),'node_modules/\n');git(owner,['add','.gitignore']);git(owner,['commit','-m','isolated base']);git(owner,['worktree','add','--detach',work]);
const commit=git(owner,['rev-parse','HEAD']);
const cache=path.join(work,'node_modules');fs.mkdirSync(cache);fs.writeFileSync(path.join(cache,'generated.js'),'regenerable');
function dirEntry(category,p){for(const f of L.files(p))fs.utimesSync(f,new Date(old),new Date(old));const seed=fixture(category,'seed-'+category+'.png');fs.unlinkSync(seed.path);seed.path=p;update(seed,{path:p,treeSha256:L.hash(JSON.stringify(L.fingerprint(p))),repository:work,integratedCommit:commit,retainedRollbackRoot:owner,worktreeOwner:owner});return seed;}
const cacheEntry=dirEntry('retired_cache',cache),gitCtx={...ctx,productionRoot:owner};
fs.writeFileSync(path.join(work,'uncommitted.txt'),'user work');reject(cacheEntry,gitCtx,/dirty/);fs.unlinkSync(path.join(work,'uncommitted.txt'));
L.applyOne(L.validate(cacheEntry,gitCtx));assert.equal(fs.existsSync(cache),false);checks++;
const workEntry=dirEntry('retired_worktree',work);L.applyOne(L.validate(workEntry,gitCtx));assert.equal(fs.existsSync(work),false);assert.equal(git(owner,['worktree','list','--porcelain']).includes('retired-worktree'),false);checks++;
console.log(JSON.stringify({ok:true,checks,scope:'isolated_filesystem_and_git',productionActions:false,fixture:root}));
