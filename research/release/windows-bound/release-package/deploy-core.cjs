'use strict';
const fs=require('node:fs'), path=require('node:path'), cp=require('node:child_process'), crypto=require('node:crypto');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function command(exe,args,cwd){const r=cp.spawnSync(exe,args,{cwd,encoding:null,windowsHide:true,maxBuffer:64*1024*1024,timeout:120000});if(r.error||r.status!==0)throw Error(`COMMAND_FAILED:${path.basename(exe)}:${r.error?.code||r.status}`);return r.stdout;}
function git(root,...args){return command('git',['-c',`safe.directory=${root.replace(/\\/g,'/')}`,'-c','core.fsmonitor=false','-C',root,...args]);}
const text=(root,...args)=>git(root,...args).toString('utf8').trim();
function json(file,data){atomic(file,Buffer.from(JSON.stringify(data,null,2)));}
function atomic(file,bytes){const tmp=file+'.release-tmp-'+crypto.randomUUID();const fd=fs.openSync(tmp,'wx');try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(tmp,file);}
function check(ok,reason){if(!ok)throw Error(reason);}
function inspect(root){return {head:text(root,'rev-parse','HEAD'),tree:text(root,'rev-parse','HEAD^{tree}'),status:text(root,'status','--porcelain','--untracked-files=all')};}
function verifyManifest(c,root){
 const names=text(root,'diff','--name-only',c.expected,c.target).split(/\r?\n/).filter(Boolean).sort();
 const declared=c.manifest.files.map(f=>f.file).sort();
 check(new Set(declared).size===declared.length,'MANIFEST_DUPLICATES');
 check(JSON.stringify(names)===JSON.stringify(declared),'MANIFEST_SCOPE_MISMATCH');
 const files=c.manifest.files.map(f=>{check(!path.isAbsolute(f.file)&&!f.file.split(/[\\/]/).includes('..'),'MANIFEST_PATH_INVALID');const b=git(root,'show',c.target+':'+f.file);check(b.length===f.bytes&&hash(b)===f.sha256,'MANIFEST_HASH_MISMATCH:'+f.file);return f;});
 check(hash(git(root,'diff','--binary',c.expected,c.target))===c.diffHash,'EXACT_DIFF_MISMATCH');return files;
}
// Dependencies are injected only by the isolated test harness. The formal CLI has no fixture/fault switches.
function run(c,dep){
 fs.mkdirSync(c.out,{recursive:true});
 const r={status:'DEPLOYMENT_FAILED',started_at:new Date().toISOString(),target:c.target,expected:c.expected,apply:!!c.apply,events:[],production_changed:false,authority_changed:false};
 let fd,owner,original,updatedAuthority,before,changed=false,hold=false;
 const event=(stage)=>{r.stage=stage;r.events.push({stage,at:new Date().toISOString()});json(path.join(c.out,'deployment-receipt.json'),r);dep.fault?.(stage);};
 try{
  json(path.join(c.out,'manifest-verification.json'),{status:'NOT_RUN'});
  event('PREFLIGHT');check(dep.isAdmin(),'ADMIN_REQUIRED');check(dep.evidenceOff(),'EVIDENCE_NOT_PROVEN_OFF');check(dep.freeBytes(c.prod)>=c.minFreeBytes,'FREE_DISK_GUARD');
  check(c.expected===c.manifest.production_sha&&c.target===c.manifest.final_sha,'TARGET_MANIFEST_IDENTITY');
  for(const lock of c.conflictingLocks||[])check(!fs.existsSync(lock),'OTHER_DEPLOY_LOCK');
  try{fd=fs.openSync(c.lock,'wx');}catch(e){throw Error('DEPLOY_LOCK_CONTENTION');}
  owner={token:crypto.randomUUID(),pid:process.pid,host:require('os').hostname(),target:c.target,started_at:r.started_at};fs.writeFileSync(fd,JSON.stringify(owner));fs.fsyncSync(fd);
  r.lock_owner=owner;event('LOCKED');
  check(text(c.source,'branch','--show-current')==='main','SOURCE_NOT_MAIN');
  const src=inspect(c.source);check(!src.status,'SOURCE_DIRTY');check(src.head===c.target&&text(c.source,'rev-parse','origin/main')===c.target,'MAIN_TARGET_DRIFT');check(dep.remoteMain()===c.target,'REMOTE_MAIN_DRIFT');
  before=inspect(c.prod);check(before.head===c.expected,'WRONG_CURRENT_SHA');check(!before.status,'PRODUCTION_DIRTY');
  original=fs.readFileSync(c.authority);const auth=JSON.parse(original);check(auth.approvedProductionSha===c.expected,'AUTHORITY_MISMATCH');
  check(fs.realpathSync(auth.productionRoot)===fs.realpathSync(c.prod),'AUTHORITY_PRODUCTION_ROOT_MISMATCH');
  check(text(c.prod,'cat-file','-t',c.expected)==='commit','ROLLBACK_SOURCE_MISSING');
  dep.verifier('before');
  fs.writeFileSync(path.join(c.out,'authority-before.bin'),original);json(path.join(c.out,'production-before.json'),{...before,authority_sha256:hash(original)});
  const files=verifyManifest(c,c.source);json(path.join(c.out,'manifest-verification.json'),{status:'PASS',files,diff_sha256:c.diffHash});
  event('STAGING');const stage=path.join(c.out,'staging');check(!fs.existsSync(stage),'STAGING_ALREADY_EXISTS');
  command('git',['clone','--no-hardlinks','--no-checkout',c.source,stage]);git(stage,'checkout','--detach',c.target);check(inspect(stage).head===c.target&&!inspect(stage).status,'STAGING_INVALID');verifyManifest(c,stage);
  const hashes=files.map(f=>({file:f.file,sha256:hash(fs.readFileSync(path.join(stage,f.file)))}));json(path.join(c.out,'staging-working-hashes.json'),hashes);
  event('STAGING_VERIFIED');
  if(!c.apply){r.status='DRY_RUN_PASS';return r;}
  check(!inspect(c.prod).status&&inspect(c.prod).head===c.expected&&fs.readFileSync(c.authority).equals(original),'PRECOMMIT_DRIFT');
  check(dep.evidenceOff(),'EVIDENCE_CHANGED');check(dep.freeBytes(c.prod)>=c.minFreeBytes,'FREE_DISK_GUARD');
  // Same paired update/rollback model as existing release-owner tools; never edits tracked production files directly.
  event('IMPORT_TARGET');git(c.prod,'fetch','--no-tags',stage,c.target);check(text(c.prod,'rev-parse','FETCH_HEAD')===c.target,'IMPORTED_TARGET_MISMATCH');
  changed=true;event('UPDATE_PRODUCTION');git(c.prod,'checkout','--detach',c.target);r.production_changed=true;event('AFTER_PRODUCTION');
  check(fs.readFileSync(c.authority).equals(original),'AUTHORITY_CHANGED_DURING_UPDATE');
  check(JSON.parse(fs.readFileSync(c.lock)).token===owner.token,'LOCK_OWNER_CHANGED');
  auth.approvedProductionSha=c.target;updatedAuthority=Buffer.from(JSON.stringify(auth,null,2));atomic(c.authority,updatedAuthority);r.authority_changed=true;event('AFTER_AUTHORITY');
  const after=inspect(c.prod);check(after.head===c.target&&!after.status,'POST_PRODUCTION_MISMATCH');check(JSON.parse(fs.readFileSync(c.authority)).approvedProductionSha===c.target,'POST_AUTHORITY_MISMATCH');
  verifyManifest(c,c.prod);
  for(const h of hashes)check(hash(fs.readFileSync(path.join(c.prod,h.file)))===h.sha256,'DEPLOYED_WORKING_HASH_MISMATCH:'+h.file);
  event('VERIFY');dep.verifier('after');check(dep.evidenceOff(),'EVIDENCE_CHANGED');
  r.status='CODE_DEPLOYMENT_VERIFIED_RUNTIME_PENDING';r.production_after=after;json(path.join(c.out,'rollback-receipt.json'),{status:'NOT_NEEDED'});return r;
 }catch(e){r.error=e.message;
  if(changed){const rb={status:'FAILED',started_at:new Date().toISOString()};try{
    event('ROLLBACK');const current=inspect(c.prod);check([c.expected,c.target].includes(current.head)&&!current.status,'ROLLBACK_EXTERNAL_DRIFT');
    const a=fs.readFileSync(c.authority);check(a.equals(original)||(updatedAuthority&&a.equals(updatedAuthority)),'ROLLBACK_AUTHORITY_DRIFT');
    check(JSON.parse(fs.readFileSync(c.lock)).token===owner.token,'ROLLBACK_LOCK_OWNER_CHANGED');
    git(c.prod,'checkout','--detach',c.expected);atomic(c.authority,original);dep.fault?.('ROLLBACK_VERIFY');
    check(inspect(c.prod).head===before.head&&inspect(c.prod).tree===before.tree&&!inspect(c.prod).status&&fs.readFileSync(c.authority).equals(original),'ROLLBACK_READBACK_FAILED');dep.verifier('rollback');rb.status='RESTORED';
   }catch(x){rb.error=x.message;hold=true;}rb.finished_at=new Date().toISOString();json(path.join(c.out,'rollback-receipt.json'),rb);r.rollback=rb;
  }else json(path.join(c.out,'rollback-receipt.json'),{status:'NOT_REQUIRED_NO_CHECKOUT'});
  return r;
 }finally{
  r.finished_at=new Date().toISOString();r.lock_retained=hold;
  if(fd!==undefined){fs.closeSync(fd);if(!hold){try{check(JSON.parse(fs.readFileSync(c.lock)).token===owner.token,'LOCK_OWNER_CHANGED');fs.unlinkSync(c.lock);}catch(e){r.status='DEPLOYMENT_FAILED';r.lock_error=e.message;}}}
  json(path.join(c.out,'deployment-receipt.json'),r);
 }
}
module.exports={run,git,text,hash};
