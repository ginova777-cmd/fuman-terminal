'use strict';
// Called only by the independent PowerShell owner. No top-level runtime mutation
// until the sealed package, release approval and live owner identity all pass.
const fs=require('fs'),path=require('path'),cp=require('child_process'),crypto=require('crypto');
const {run,git,text,hash}=require('./release-package/deploy-core.cjs');
const {guardOwner}=require('./OwnerAuthorization.cjs');
function ps(code){const r=cp.spawnSync('pwsh',['-NoProfile','-Command',code],{encoding:'utf8',windowsHide:true,timeout:120000});if(r.status!==0||r.error)throw Error('OWNER_OS_CHECK_FAILED');return r.stdout.trim();}
const q=s=>"'"+s.replaceAll("'","''")+"'";
function atomic(file,bytes){const tmp=file+'.tmp-'+crypto.randomUUID();const f=fs.openSync(tmp,'wx');try{fs.writeFileSync(f,bytes);fs.fsyncSync(f);}finally{fs.closeSync(f);}fs.renameSync(tmp,file);}
function execute(c,action,out,dep){
 const manifestBytes=fs.readFileSync(c.manifestPath),diff=fs.readFileSync(c.diffPath);
 if(hash(manifestBytes)!==c.manifest_sha256||hash(diff)!==c.diff_sha256)throw Error('SEALED_RELEASE_PACKAGE_DRIFT');
 dep.guard();
 const verifier=()=>dep.verify();
 if(action==='apply'){
  return run({...c,out,manifest:JSON.parse(manifestBytes),diffHash:c.diff_sha256,apply:true}, {
   isAdmin:()=>dep.admin(),evidenceOff:()=>dep.evidenceOff(),freeBytes:()=>dep.freeBytes(),remoteMain:()=>dep.remoteMain(),verifier,
   fault:stage=>{if(stage==='IMPORT_TARGET'||stage==='UPDATE_PRODUCTION'||stage==='ROLLBACK'){dep.guard();dep.noUsers();}}
  });
 }
 if(action!=='rollback')throw Error('UNKNOWN_RELEASE_OPERATION');
 const original=fs.readFileSync(path.join(out,'authority-before.bin'));
 const before=JSON.parse(fs.readFileSync(path.join(out,'production-before.json')));
 if(hash(original)!==before.authority_sha256)throw Error('ROLLBACK_BACKUP_DRIFT');
 const current=fs.readFileSync(c.authority),auth=JSON.parse(original);auth.approvedProductionSha=c.target;
 if(!current.equals(original)&&!current.equals(Buffer.from(JSON.stringify(auth,null,2))))throw Error('ROLLBACK_AUTHORITY_DRIFT');
 if(text(c.prod,'status','--porcelain','--untracked-files=all')||![c.expected,c.target].includes(text(c.prod,'rev-parse','HEAD')))throw Error('ROLLBACK_PRODUCTION_DRIFT');
 dep.noUsers();const fd=fs.openSync(c.lock,'wx');let pass=false;
 try{
  fs.writeFileSync(fd,JSON.stringify({pid:process.pid,action:'rollback'}));fs.fsyncSync(fd);
  dep.noUsers();git(c.prod,'checkout','--detach',c.expected);
  if(!fs.readFileSync(c.authority).equals(current))throw Error('ROLLBACK_CONCURRENT_AUTHORITY_CHANGE');
  atomic(c.authority,original);dep.verify();
  if(text(c.prod,'rev-parse','HEAD')!==c.expected||text(c.prod,'status','--porcelain','--untracked-files=all')||!fs.readFileSync(c.authority).equals(original))throw Error('ROLLBACK_READBACK_FAILED');
  pass=true;return {status:'RESTORED',sha:c.expected};
 }finally{fs.closeSync(fd);if(pass)fs.unlinkSync(c.lock);}
}
if(require.main===module){
 const [action,out,ownerFile]=process.argv.slice(2),c=JSON.parse(fs.readFileSync(path.join(__dirname,'release-config.json')));
 if(!c.release_approved||!c.formal_apply_authorized||!c.final_sha_after_merge||c.target!==c.final_sha_after_merge)throw Error('OWNER_FINAL_RELEASE_APPROVAL_REQUIRED');
 const owner=JSON.parse(fs.readFileSync(ownerFile));
 if(owner.owner_pid!==process.ppid||owner.target!==c.target||!owner.token||owner.maintenance_verified!==true||typeof owner.creation_ticks!=='string'||!/^\d+$/.test(owner.creation_ticks))throw Error('INDEPENDENT_OWNER_REQUIRED');
 c.manifestPath=path.join(__dirname,'release-package/manifest.json');c.diffPath=path.join(__dirname,'release-package/exact.diff');
 c.lock='C:/fuman-release-owner/final-release-deployment.lock';c.minFreeBytes=1073741824;c.conflictingLocks=['C:/fuman-runtime/locks/fuman-vercel-deploy.lock'];
 const common=`. ${q(path.join(__dirname,'ProductionMaintenanceBinding.ps1'))}; . ${q(path.join(__dirname,'ProductionRuntimePorts.ps1'))}; $c=Get-Content ${q(path.join(__dirname,'release-config.json'))} -Raw|ConvertFrom-Json;`;
 const dep={
  guard:()=>guardOwner(__dirname,c,ownerFile,action),
  noUsers:()=>ps(common+'Assert-OnlyBoundFuture $c $null'),
  admin:()=>ps('[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)')==='True',
  evidenceOff:()=>{ps(common+'Test-EvidenceOff $c');return true;},
  freeBytes:()=>Number(ps('(Get-PSDrive C).Free')),
  remoteMain:()=>cp.execFileSync('gh',['api','repos/ginova777-cmd/fuman-terminal/git/ref/heads/main','--jq','.object.sha'],{encoding:'utf8',timeout:30000,windowsHide:true}).trim(),
  verify:()=>{const r=cp.spawnSync(process.execPath,[c.verifier,'--require-production-root'],{encoding:'utf8',windowsHide:true,timeout:120000});if(r.status!==0||r.error||!JSON.parse(r.stdout).ok)throw Error('FORMAL_AUTHORITY_VERIFIER_FAILED');}
 };
 const result=execute(c,action,out,dep);console.log(JSON.stringify(result));if(!['CODE_DEPLOYMENT_VERIFIED_RUNTIME_PENDING','RESTORED'].includes(result.status))process.exitCode=1;
}
module.exports={execute};
