"use strict";
// Explicit retirement evidence is required. Discovery is never deletion permission.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),zlib=require('zlib'),cp=require('child_process');
const {assertTree}=require('./cleanup-path-protection');
const policy=require('../data/contracts/cleanup_local_assets_v1.json');
const DAY=86400000;
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const key=p=>path.resolve(p).replaceAll('\\','/').toLowerCase();
const inside=(r,p)=>key(p)===key(r)||key(p).startsWith(key(r)+'/');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
function files(root){
  const out=[];if(!fs.existsSync(root))return out;
  function visit(p){const s=fs.lstatSync(p);if(s.isSymbolicLink())throw Error('link_rejected:'+p);if(s.isDirectory())for(const n of fs.readdirSync(p))visit(path.join(p,n));else if(s.isFile())out.push(p);else throw Error('special_file_rejected:'+p);}
  visit(root);return out;
}
function fingerprint(p){return files(p).sort().map(f=>{const s=fs.statSync(f);const sha256=hash(fs.readFileSync(f));const after=fs.statSync(f);if(s.size!==after.size||s.mtimeMs!==after.mtimeMs)throw Error('file_changed:'+f);return {path:path.relative(p,f).replaceAll('\\','/'),bytes:s.size,sha256};});}
function git(root,args){return cp.execFileSync('git',['-c','maintenance.auto=false','-c','gc.auto=0','-C',root,...args],{encoding:'utf8',windowsHide:true}).trim();}
function activity(){
  const script="$ErrorActionPreference='Stop'; $p=@(Get-CimInstance Win32_Process | Select-Object ProcessId,CommandLine); $t=@(Get-ScheduledTask | ForEach-Object {foreach($a in $_.Actions){[pscustomobject]@{execute=$a.Execute;arguments=$a.Arguments;workingDirectory=$a.WorkingDirectory}}}); @{processes=$p;tasks=$t}|ConvertTo-Json -Depth 5 -Compress";
  const r=cp.spawnSync('powershell.exe',['-NoProfile','-Command',script],{encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:16*1024*1024});
  if(r.status!==0)throw Error('activity_inventory_failed');const value=JSON.parse(r.stdout);if(!Array.isArray(value.processes)||!Array.isArray(value.tasks))throw Error('activity_inventory_incomplete');return value;
}
function pathMention(text,p){const value=String(text).replaceAll('\\','/').toLowerCase();return value.includes(key(p));}
function validate(entry,ctx){
  const p=path.resolve(entry.path),rule=ctx.policy.categories[entry.category];
  if(!rule)throw Error('unknown_category');
  if(!path.isAbsolute(entry.path))throw Error('absolute_path_required');
  if([...ctx.policy.protectedRoots,...(ctx.productionRoot?[ctx.productionRoot]:[])].some(r=>inside(r,p)||inside(p,r)))throw Error('protected_root');
  if(ctx.policy.protectedNames.includes(path.basename(p).toLowerCase())||/\.lock$|(?:^|[\\/])(?:scorecard88|scan-receipts|locks)(?:[\\/]|$)/i.test(p))throw Error('protected_evidence_or_lock');
  const root=ctx.policy.allowedRoots.find(r=>inside(r,p)&&key(r)!==key(p));if(!root)throw Error('root_not_allowed');assertTree(root,p);
  const members=files(p);if(members.some(f=>ctx.policy.protectedNames.includes(path.basename(f).toLowerCase())||/\.lock$|(?:receipt|scorecard88).*\.json$/i.test(path.basename(f))))throw Error('protected_child');
  if(members.some(f=>fs.statSync(f).mtimeMs>=ctx.now-rule.keepDays*DAY))throw Error('retention_not_elapsed');
  if(!Number.isFinite(Date.parse(entry.retiredAt))||Date.parse(entry.retiredAt)>=ctx.now-rule.keepDays*DAY)throw Error('retirement_not_elapsed');
  if(!entry.evidenceFile||!entry.evidenceSha256||hash(fs.readFileSync(entry.evidenceFile))!==entry.evidenceSha256)throw Error('evidence_hash_mismatch');
  const e=read(entry.evidenceFile);
  if(e.contract!=='cleanup-local-retirement-evidence-v1'||e.type!==rule.evidenceType||key(e.path)!==key(p)||e.retiredAt!==entry.retiredAt||e.status!=='closed'||e.formalEvidence!==false||e.rollbackRequired!==false||e.unresolvedWork!==false)throw Error('retirement_evidence_invalid');
  if(!e.owner||!e.reason||!Number.isFinite(Date.parse(e.checkedAt))||Date.parse(e.checkedAt)>ctx.now)throw Error('evidence_identity_missing');
  if(!Array.isArray(e.leasePaths)||e.leasePaths.some(f=>!path.isAbsolute(f)||fs.existsSync(f)))throw Error('lease_inventory_missing_or_active');
  const before=fingerprint(p);if(hash(JSON.stringify(before))!==e.treeSha256)throw Error('tree_hash_mismatch');
  if(ctx.referenced(p)||members.some(f=>ctx.referenced(f)))throw Error('referenced_by_evidence');
  const activePaths=[p,...(e.repository?[e.repository]:[])];
  if(ctx.activity.processes.some(v=>activePaths.some(a=>pathMention(v.CommandLine,a))|| (e.ownerPid&&v.ProcessId===e.ownerPid))||ctx.activity.tasks.some(v=>Object.values(v).some(s=>activePaths.some(a=>pathMention(s,a)))))throw Error('active_process_or_schedule');
  if(entry.category==='test_artifact'&&!members.every(f=>/\.(?:png|jpe?g|webp|webm|mp4|zip|trace)$/i.test(f)))throw Error('test_artifact_type_rejected');
  if(entry.category==='sealed_log'&&(!fs.statSync(p).isFile()||!e.sealedAt||Date.parse(e.sealedAt)>ctx.now-rule.keepDays*DAY||!Number.isFinite(Date.parse(e.sealedAt))||e.readerSupportsGzip!==true||!/\.(?:log|jsonl)$/i.test(p)))throw Error('log_not_sealed_or_reader_unsupported');
  if(entry.category==='interrupted_temp'&&(!e.ownerPid||!e.terminatedAt||!Number.isFinite(Date.parse(e.terminatedAt))||Date.parse(e.terminatedAt)>ctx.now-rule.keepDays*DAY||!members.every(f=>/\.(?:tmp|partial|download)$/i.test(f))))throw Error('job_termination_unproven');
  if(entry.category==='retired_backup'){
    if(!e.replacementBackup||!fs.existsSync(e.replacementBackup)||inside(p,e.replacementBackup)||!e.replacementTreeSha256||e.treeSha256!==e.replacementTreeSha256||hash(JSON.stringify(fingerprint(e.replacementBackup)))!==e.replacementTreeSha256)throw Error('replacement_backup_unverified');
    if(!e.restoreReceiptFile||hash(fs.readFileSync(e.restoreReceiptFile))!==e.restoreReceiptSha256)throw Error('restore_receipt_unverified');
    const restore=read(e.restoreReceiptFile);
    if(restore.contract!=='backup-restore-verification-v1'||restore.ok!==true||key(restore.backup)!==key(e.replacementBackup)||restore.treeSha256!==e.replacementTreeSha256||!Number.isFinite(Date.parse(restore.checkedAt))||Date.parse(restore.checkedAt)>ctx.now)throw Error('backup_restore_not_proven');
  }
  if(['retired_cache','retired_worktree'].includes(entry.category)){
    if(!e.repository||!e.integratedCommit||!e.retainedRollbackRoot||!fs.existsSync(e.retainedRollbackRoot)||inside(p,e.retainedRollbackRoot))throw Error('release_retirement_unproven');
    if(git(e.repository,['status','--porcelain','--untracked-files=all']))throw Error('retired_repository_dirty');
    const head=git(e.repository,['rev-parse','HEAD']);if(head!==e.integratedCommit)throw Error('retired_head_mismatch');
    git(ctx.productionRoot,['merge-base','--is-ancestor',head,'HEAD']);
    if(git(e.retainedRollbackRoot,['status','--porcelain','--untracked-files=all']))throw Error('rollback_not_clean');
    git(ctx.productionRoot,['merge-base','--is-ancestor',git(e.retainedRollbackRoot,['rev-parse','HEAD']),'HEAD']);
    if(entry.category==='retired_cache'&&(!inside(e.repository,p)||!['node_modules','dist','build','.next','output'].includes(path.basename(p))))throw Error('cache_path_invalid');
    if(entry.category==='retired_worktree'&&(key(e.repository)!==key(p)||!e.worktreeOwner||!git(e.worktreeOwner,['worktree','list','--porcelain']).replaceAll('\\','/').includes('worktree '+p.replaceAll('\\','/'))))throw Error('worktree_registration_missing');
  }
  return {path:p,category:entry.category,action:rule.action,bytes:before.reduce((n,f)=>n+f.bytes,0),treeSha256:e.treeSha256,evidenceSha256:entry.evidenceSha256,evidenceFile:entry.evidenceFile,files:before,evidence:e};
}
function applyOne(item){
  // Caller has revalidated paths, content, retirement, process and reference evidence.
  assertTree(path.dirname(item.path),item.path);
  if(hash(JSON.stringify(fingerprint(item.path)))!==item.treeSha256)throw Error('content_changed_before_apply');
  if(item.action==='gzip'){
    const original=fs.readFileSync(item.path),dest=item.path+'.gz',index=dest+'.index.json';
    if(fs.existsSync(dest)||fs.existsSync(index))throw Error('archive_already_exists');
    const compressed=zlib.gzipSync(original);fs.writeFileSync(dest,compressed,{flag:'wx'});
    if(!zlib.gunzipSync(fs.readFileSync(dest)).equals(original))throw Error('archive_readback_mismatch');
    fs.writeFileSync(index,JSON.stringify({contract:'cleanup-log-archive-v1',source:item.path,sourceSha256:hash(original),archiveSha256:hash(compressed),sealedAt:item.evidence.sealedAt,archivedAt:new Date().toISOString()})+'\n',{flag:'wx'});
    if(hash(fs.readFileSync(item.path))!==hash(original))throw Error('source_changed_before_unlink');
    fs.unlinkSync(item.path);return {...item,archive:dest,index,archiveSha256:hash(compressed),originalSha256:hash(original)};
  }
  if(item.action==='git_worktree_remove')git(item.evidence.worktreeOwner,['worktree','remove',item.path]);
  else fs.rmSync(item.path,{recursive:fs.statSync(item.path).isDirectory(),force:false});
  return item;
}
function verify(receipt){
  const issues=[];if(receipt.contract!==policy.contract||receipt.applied!==true)issues.push('not_applied_local_assets_receipt');
  if(receipt.ok!==true||!receipt.runId||!Array.isArray(receipt.candidates)||!Array.isArray(receipt.processed)||!Array.isArray(receipt.preserved)||!Array.isArray(receipt.errors)||!Array.isArray(receipt.protectedEvidence)||!Array.isArray(receipt.inventory)||JSON.stringify(receipt.categories)!==JSON.stringify(Object.keys(policy.categories)))issues.push('incomplete_receipt_contract');
  const planned=receipt.candidates||[],processed=receipt.processed||[];
  if(planned.length!==processed.length||new Set(processed.map(p=>key(p.path))).size!==processed.length||processed.some(p=>!planned.some(c=>key(c.path)===key(p.path)&&c.treeSha256===p.treeSha256&&c.action===p.action)))issues.push('planned_processed_mismatch');
  for(const item of receipt.processed||[]){if(fs.existsSync(item.path))issues.push('source_remaining:'+item.path);if(item.archive){try{const b=fs.readFileSync(item.archive);if(hash(b)!==item.archiveSha256||hash(zlib.gunzipSync(b))!==item.originalSha256||read(item.index).sourceSha256!==item.originalSha256)issues.push('archive_invalid:'+item.archive);}catch{issues.push('archive_missing:'+item.archive);}}}
  for(const item of receipt.protectedEvidence||[]){try{const b=fs.readFileSync(item.path);if(item.appendAllowed===true){if(!Number.isSafeInteger(item.bytes)||b.length<item.bytes||hash(b.subarray(0,item.bytes))!==item.sha256)issues.push('protected_file_changed:'+item.path);}else if(hash(b)!==item.sha256)issues.push('protected_file_changed:'+item.path);}catch{issues.push('protected_file_missing:'+item.path);}}
  if((receipt.errors||[]).length)issues.push('runner_errors');return {contract:'cleanup-local-assets-readback-v1',ok:issues.length===0,issues,checkedAt:new Date().toISOString(),processed:(receipt.processed||[]).length};
}
module.exports={policy,hash,key,inside,files,fingerprint,validate,applyOne,verify,activity,pathMention};
