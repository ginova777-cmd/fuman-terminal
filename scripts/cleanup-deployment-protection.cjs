'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {assertTree}=require('./cleanup-path-protection');
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
function readBound(runtime,binding,json=true){
 if(!binding||typeof binding.file!=='string'||!/^[a-f0-9]{64}$/.test(binding.sha256||''))throw Error('binding_missing');
 const file=path.resolve(runtime,binding.file);assertTree(runtime,file);const bytes=fs.readFileSync(file);
 if(digest(bytes)!==binding.sha256)throw Error('binding_hash_mismatch');
 return {file,bytes,value:json?JSON.parse(bytes.toString('utf8')):null};
}
function inventoryBindings(runtime,referenceMs){
 const manifestFile=path.join(runtime,'config/cleanup-retired-assets.json'),bindings=new Map(),exclude=[manifestFile];let entries=[];
 try{const manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));if(!Array.isArray(manifest.entries))throw Error('manifest_entries_missing');entries=manifest.entries;}catch(error){return {bindings,exclude,issue:error.code==='ENOENT'?'deployment_retirement_evidence_missing':'deployment_retirement_manifest_invalid'};}
 for(const entry of entries.filter(e=>e&&e.kind==='vercel-deployment')){
  if(typeof entry.deploymentId!=='string'||bindings.has(entry.deploymentId)){bindings.set(entry.deploymentId,{reason:'deployment_retirement_identity_duplicate'});continue;}
  try{
   const proof=readBound(runtime,entry.retirementEvidence),p=proof.value;
   if(p.contract!=='cleanup-deployment-retirement-evidence-v1'||p.deploymentId!==entry.deploymentId||p.url!==entry.url||p.createdAt!==entry.createdAt||p.status!=='retired'||typeof p.owner!=='string'||!p.owner.trim()||typeof p.approvedBy!=='string'||!p.approvedBy.trim()||p.referenceAuditComplete!==true||p.formalAcceptance!==false||p.rollbackRequired!==false||p.incidentState!=='none'||!Array.isArray(p.references)||p.references.length||!Array.isArray(p.holds)||p.holds.length||!Number.isFinite(Date.parse(p.checkedAt))||Date.parse(p.checkedAt)>referenceMs||referenceMs-Date.parse(p.checkedAt)>86400000)throw Error('retirement_safety_unverified');
   const artifact=readBound(runtime,p.rebuildArtifact,false),restore=readBound(runtime,p.rebuildVerification),r=restore.value;
   if(r.contract!=='deployment-rebuild-readback-v1'||r.status!=='complete'||r.complete!==true||r.deploymentId!==p.deploymentId||r.sourceCommit!==p.sourceCommit||!/^[a-f0-9]{40}$/.test(p.sourceCommit||'')||r.artifactSha256!==p.rebuildArtifact.sha256||!Array.isArray(r.failedChecks)||r.failedChecks.length||r.firstBlocker!==null)throw Error('rebuild_readback_unverified');
   exclude.push(proof.file,artifact.file,restore.file);
   bindings.set(entry.deploymentId,{entry,proof:p,evidenceSha256:entry.retirementEvidence.sha256});
  }catch(error){bindings.set(entry.deploymentId,{reason:'deployment_'+error.message});}
 }
 return {bindings,exclude,issue:null};
}
// Existing referenceInventory captures URL/path references. Also examine exact
// deployment ID strings in its hashed sources, because IDs need not contain '/'.
async function idReferences(refs,ids){
 const held=new Set();for(const entry of refs.files||[]){let tail='',hash=crypto.createHash('sha256');const max=Math.max(1,...ids.map(id=>JSON.stringify(id).length));for await(const chunk of fs.createReadStream(entry.file,{encoding:'utf8'})){hash.update(chunk);const text=tail+chunk;for(const id of ids)if(text.includes(JSON.stringify(id)))held.add(id);tail=text.slice(-max);}if(hash.digest('hex')!==entry.sha256)throw Error('deployment_reference_changed');}
 return held;
}
function protectionReason(item,detail,inventory,refs,idRefs){
 const id=String(item.uid||item.id||item.url),binding=inventory.bindings.get(id);
 if(!refs||typeof refs.contains!=='function'||!idRefs)return 'deployment_reference_inventory_unknown';
 if(idRefs.has(id)||refs.contains(id)||refs.contains(item.url)||refs.contains('https://'+item.url))return 'deployment_still_referenced';
 if(!binding||binding.reason)return binding?.reason||inventory.issue||'deployment_retirement_evidence_missing';
 if(binding.entry.url!==item.url||Number(binding.entry.createdAt)!==Number(item.createdAt))return 'deployment_retirement_identity_mismatch';
 if(String(detail.uid||detail.id||'')!==id||detail.url!==item.url||Number(detail.createdAt)!==Number(item.createdAt))return 'deployment_detail_identity_mismatch';
 return null;
}
module.exports={inventoryBindings,idReferences,protectionReason};
