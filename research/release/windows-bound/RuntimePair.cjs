'use strict';
// Runtime files are a subordinate transaction of the existing fenced release.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),cp=require('child_process');
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
const q=s=>"'"+s.replaceAll("'","''")+"'";
function powershell(code){const r=cp.spawnSync('pwsh',['-NoProfile','-Command',"$ErrorActionPreference='Stop';"+code],{encoding:'utf8',windowsHide:true,timeout:30000});if(r.error||r.status!==0)throw Error('RUNTIME_ACL_OPERATION_FAILED');return r.stdout.trim();}
const windowsAcl={get:p=>powershell(`(Get-Acl -LiteralPath ${q(p)}).Sddl`),set:(p,s)=>powershell(`$a=Get-Acl -LiteralPath ${q(p)};$a.SetSecurityDescriptorSddlForm(${q(s)});Set-Acl -LiteralPath ${q(p)} -AclObject $a`)};
function noLinks(p){let n=path.resolve(p);for(;;){if(fs.existsSync(n)&&fs.lstatSync(n).isSymbolicLink())throw Error('RUNTIME_REPARSE_REJECTED');const up=path.dirname(n);if(up===n)break;n=up;}}
function save(p,v){const tmp=p+'.tmp-'+crypto.randomUUID(),fd=fs.openSync(tmp,'wx');try{fs.writeFileSync(fd,JSON.stringify(v,null,2));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(tmp,p);}
function create(c,out,dep){
 const acl=dep.acl||windowsAcl,journal=path.join(out,'runtime-pair-journal.json');
 const guard=()=>{dep.guard();dep.noUsers();noLinks(out);noLinks(path.join(c.runtime,'ops'));};
 const manifest=()=>{const p=path.join(c.packageRoot,'runtime-pair.json');noLinks(p);const b=fs.readFileSync(p);if(digest(b)!==c.runtime_pair_sha256)throw Error('RUNTIME_MANIFEST_DRIFT');const m=JSON.parse(b);if(m.target!==c.target||m.expected!==c.expected||m.files.length!==2||m.files.map(x=>x.name).join('|')!=='MotherPoolReceiptCatchup.ps1|Run-DaytradeSourceWriter.ps1')throw Error('RUNTIME_MANIFEST_IDENTITY');return m;};
 const target=name=>path.join(c.runtime,'ops',name);
 function current(p){if(!fs.existsSync(p))return null;noLinks(p);if(!fs.statSync(p).isFile())throw Error('RUNTIME_NOT_FILE');return {hash:digest(fs.readFileSync(p)),acl:acl.get(p)};}
 function load(){guard();manifest();const j=JSON.parse(fs.readFileSync(journal));if(j.target!==c.target||j.expected!==c.expected||j.runtime!==path.resolve(c.runtime)||j.manifest!==c.runtime_pair_sha256||j.rows.length!==2)throw Error('RUNTIME_JOURNAL_IDENTITY');const m=manifest();for(let i=0;i<2;i++){const r=j.rows[i];if(r.name!==m.files[i].name||r.after!==m.files[i].sha256||typeof r.after_acl!=='string')throw Error('RUNTIME_JOURNAL_ROW');if(r.before){const b=fs.readFileSync(path.join(out,'runtime-before-'+i+'.bin'));if(digest(b)!==r.before.hash)throw Error('RUNTIME_BACKUP_DRIFT');}}return j;}
 function prepare(){guard();const m=manifest();if(fs.existsSync(journal))throw Error('RUNTIME_JOURNAL_EXISTS');const rows=[];
  // Validate every source before saving backups or creating staged runtime files.
  const sources=m.files.map(f=>{const p=path.join(c.packageRoot,'runtime-payload',f.name);noLinks(p);const b=fs.readFileSync(p);if(b.length!==f.bytes||digest(b)!==f.sha256)throw Error('RUNTIME_SOURCE_DRIFT');return b;});
  const wrapperBefore=current(target('Run-DaytradeSourceWriter.ps1'));if(!wrapperBefore)throw Error('RUNTIME_ORIGINAL_WRAPPER_REQUIRED');
  for(let i=0;i<2;i++){guard();const f=m.files[i],p=target(f.name),before=current(p);if(before){const fd=fs.openSync(path.join(out,'runtime-before-'+i+'.bin'),'wx');try{fs.writeFileSync(fd,fs.readFileSync(p));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
   const stage=path.join(out,'runtime-stage-'+i+'.bin');fs.writeFileSync(stage,sources[i],{flag:'wx'});
   // A newly introduced helper uses the original wrapper ACL, under the same fence.
   const afterAcl=before?.acl||wrapperBefore.acl;
   rows.push({name:f.name,before,after:f.sha256,after_acl:afterAcl});
  }
  const j={target:c.target,expected:c.expected,runtime:path.resolve(c.runtime),manifest:c.runtime_pair_sha256,stage:'PREPARED',rows};save(journal,j);return j;
 }
 function matches(a,b){return a===null?b===null:!!b&&a.hash===b.hash&&a.acl===b.acl;}
 function write(p,b,sddl){const tmp=p+'.runtime-'+crypto.randomUUID();const fd=fs.openSync(tmp,'wx');try{fs.writeFileSync(fd,b);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}acl.set(tmp,sddl);fs.renameSync(tmp,p);}
 function apply(){const j=load();if(j.stage!=='PREPARED')throw Error('RUNTIME_APPLY_NOT_FRESH');for(const r of j.rows)if(!matches(current(target(r.name)),r.before))throw Error('RUNTIME_PREWRITE_DRIFT');
  for(let i=0;i<2;i++){guard();const r=j.rows[i],b=fs.readFileSync(path.join(out,'runtime-stage-'+i+'.bin'));if(digest(b)!==r.after)throw Error('RUNTIME_STAGE_DRIFT');j.stage='WRITE_INTENT_'+i;save(journal,j);write(target(r.name),b,r.after_acl);dep.fault?.('RUNTIME_AFTER_WRITE_'+i);if(!matches(current(target(r.name)),{hash:r.after,acl:r.after_acl}))throw Error('RUNTIME_WRITE_READBACK');}
  j.stage='APPLIED';save(journal,j);return {status:'RUNTIME_PAIR_VERIFIED'};
 }
 function restore(){const j=load();for(const r of j.rows){const a=current(target(r.name));if(!matches(a,r.before)&&!matches(a,{hash:r.after,acl:r.after_acl}))throw Error('RUNTIME_UNKNOWN_BYTES_OR_ACL');}
  for(let i=1;i>=0;i--){guard();const r=j.rows[i],p=target(r.name);const a=current(p);if(!matches(a,r.before)&&!matches(a,{hash:r.after,acl:r.after_acl}))throw Error('RUNTIME_CONCURRENT_DRIFT');j.stage='RESTORE_INTENT_'+i;save(journal,j);if(r.before)write(p,fs.readFileSync(path.join(out,'runtime-before-'+i+'.bin')),r.before.acl);else if(fs.existsSync(p))fs.unlinkSync(p);dep.fault?.('RUNTIME_AFTER_RESTORE_'+i);if(!matches(current(p),r.before))throw Error('RUNTIME_RESTORE_READBACK');}
  j.stage='RESTORED';save(journal,j);return {status:'RUNTIME_PAIR_RESTORED'};
 }
 return {prepare,apply,restore,exists:()=>fs.existsSync(journal)};
}
module.exports={create};
