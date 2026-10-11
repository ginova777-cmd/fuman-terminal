'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const hash=r=>crypto.createHash('sha256').update(JSON.stringify(r)).digest('hex');
const proofPath=(file,r)=>path.join(path.dirname(file),'institution-origin',hash(r)+'.json');
function read(file,r){
 const blocked={...r,naturalSlotComplete:false,naturalEvidenceStatus:'ORIGIN_LINK_UNVERIFIED'};
 try{
  const p=proofPath(file,r);if(fs.statSync(p).size>1024*1024)return blocked;
  const e=JSON.parse(fs.readFileSync(p,'utf8'));
  if(e.contract!=='institution-origin-link-v1'||e.runId!==r.runId||e.receiptSha256!==hash(r))return blocked;
  return {...r,naturalSlotComplete:e.proof.naturalSlotComplete===true&&r.recoveryReplay!==true&&e.proof.recoveryReplay!==true,recoveryReplay:r.recoveryReplay===true||e.proof.recoveryReplay===true,naturalEvidenceStatus:e.proof.naturalEvidenceStatus,naturalOriginLink:p};
 }catch{return blocked;}
}
module.exports={hash,proofPath,read};
