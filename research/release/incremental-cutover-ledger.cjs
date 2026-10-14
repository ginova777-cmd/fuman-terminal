'use strict';
// Pure release-review evaluator. It performs no deployment, policy write or rollback.
function assess(manifest,records,failed,now){
 if(manifest?.contract!=='incremental_cutover_dependencies_v1'||!Array.isArray(manifest.batches))throw Error('BATCH_MANIFEST_REQUIRED');
 const map=new Map();for(const b of manifest.batches){if(!b.id||map.has(b.id)||!Array.isArray(b.dependencies)||!Array.isArray(b.modules))throw Error('INVALID_BATCH');map.set(b.id,b);}
 const visited=new Set(),active=new Set();function visit(id){if(active.has(id))throw Error('DEPENDENCY_CYCLE');if(visited.has(id))return;const b=map.get(id);if(!b)throw Error('UNKNOWN_DEPENDENCY:'+id);active.add(id);for(const d of b.dependencies)visit(d);active.delete(id);visited.add(id);}for(const id of map.keys())visit(id);
 if(failed.some(id=>!map.has(id)))throw Error('UNKNOWN_FAILED_BATCH');
 const impacted=new Set(failed);let changed=true;while(changed){changed=false;for(const b of map.values())if(!impacted.has(b.id)&&b.dependencies.some(d=>impacted.has(d))){impacted.add(b.id);changed=true;}}
 return manifest.batches.map(b=>{const r=records[b.id],same=Boolean(r&&r.release_sha===b.release_sha&&r.installed_sha===b.release_sha),accepted=same&&r.independent_verified===true&&r.natural_pass===true;
 const approval=r?.approval;const authorized=approval?.release_sha===b.release_sha&&JSON.stringify(approval.modules)===JSON.stringify(b.modules)&&approval.reviewer_approved===true&&Number.isFinite(Date.parse(now))&&Date.parse(approval.starts_at)<=Date.parse(now)&&Date.parse(now)<Date.parse(approval.ends_at);
 const dependenciesReady=b.dependencies.every(id=>{const d=records[id],spec=map.get(id);return d?.release_sha===spec.release_sha&&d.installed_sha===spec.release_sha&&d.independent_verified===true;});
 return {batch_id:b.id,release_sha:b.release_sha,installed_sha:r?.installed_sha||null,state:impacted.has(b.id)?'BLOCKED':accepted?'NATURAL_PASS':same?(r.enabled===true?'ENABLED_NATURAL_PENDING':'DEPLOYED_NOT_ENABLED'):'NOT_DEPLOYED',preserve_success:accepted&&!impacted.has(b.id),can_continue:!impacted.has(b.id)&&b.dependency_review_complete===true&&dependenciesReady&&authorized,first_blocker:impacted.has(b.id)?'FAILED_BATCH_OR_DEPENDENCY':b.dependency_review_complete!==true?'DEPENDENCY_REVIEW_INCOMPLETE':!dependenciesReady?'DEPENDENCY_NOT_VERIFIED':!authorized?'EXACT_APPROVAL_OR_WINDOW_MISSING':null};});
}
module.exports={assess};
