'use strict';
const fs=require('fs'),path=require('path'),cp=require('child_process'),crypto=require('crypto');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function guardOwner(root,c,ownerFile,action){
 if(!c.formal_apply_authorized||!c.release_approved||!c.remote_main_verified||c.target!==c.final_sha_after_merge)throw Error('FORMAL_APPROVAL_REQUIRED');
 const mbytes=fs.readFileSync(path.join(root,'tool-manifest.json'));
 if(hash(mbytes)!==c.package_sha256)throw Error('TOOL_MANIFEST_DRIFT');
 const m=JSON.parse(mbytes);
 for(const [k,v] of Object.entries(m.config_identity))if(c[k]!==v)throw Error('CONFIG_IDENTITY_DRIFT:'+k);
 for(const f of m.files){const full=path.resolve(root,f.path),rel=path.relative(root,full);if(rel.startsWith('..')||path.isAbsolute(rel))throw Error('PACKAGE_PATH');const b=fs.readFileSync(full);if(b.length!==f.bytes||hash(b)!==f.sha256)throw Error('TOOL_FILE_DRIFT:'+f.path);}
 const o=JSON.parse(fs.readFileSync(ownerFile,'utf8').replace(/^\uFEFF/,''));
 const lock=JSON.parse(fs.readFileSync(path.join(c.runtime,'state/mother-cutover-maintenance-owner.lock'),'utf8'));
 if(o.owner_pid!==process.ppid||o.owner_pid!==lock.owner_pid||o.token!==lock.token||o.target!==c.target||o.creation_ticks!==lock.creation_ticks||!o.token||o.maintenance_verified!==true||!/^\d+$/.test(o.creation_ticks))throw Error('INDEPENDENT_OWNER_REQUIRED');
 const ticks=cp.execFileSync('pwsh',['-NoProfile','-Command',`(Get-Process -Id ${process.ppid}).StartTime.ToUniversalTime().Ticks`],{encoding:'utf8',windowsHide:true,timeout:10000}).trim();
 if(ticks!==o.creation_ticks)throw Error('OWNER_PID_RECYCLED');
 if(action!=='rollback'&&!(Date.now()>=Date.parse(o.approval_not_before)&&Date.now()<Date.parse(o.approval_expires_at)))throw Error('APPROVAL_WINDOW_EXPIRED');
 const actual=fs.realpathSync.native(root),protectedRoot=path.join(process.env.ProgramFiles||'C:/Program Files','FumanMaintenanceOwner',c.target);
 if(actual.toLowerCase()!==path.resolve(protectedRoot).toLowerCase()||!c.installed_acl_sddl)throw Error('PROTECTED_PACKAGE_REQUIRED');
 const quote=s=>"'"+s.replaceAll("'","''")+"'";
 const acl=cp.execFileSync('pwsh',['-NoProfile','-Command',`(Get-Acl -LiteralPath ${quote(actual)}).Sddl`],{encoding:'utf8',windowsHide:true,timeout:10000}).trim();
 if(acl!==c.installed_acl_sddl)throw Error('OWNER_ACL_DRIFT');
 return o;
}
module.exports={guardOwner};
