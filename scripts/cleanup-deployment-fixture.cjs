'use strict';
// Isolated provider fixture only. Never writes an Owner approval to production.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert/strict');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function seed(runtime,deployments,checkedAt){
 const entries=[];for(const item of deployments){
  const id=item.uid||item.id,dir=path.join(runtime,'deployment-fixture-evidence',id);fs.mkdirSync(dir,{recursive:true});
  const artifactFile=path.join(dir,'rebuild-artifact.json'),bytes=JSON.stringify(item);fs.writeFileSync(artifactFile,bytes);
  // The isolated provider's restore API consumes this serialized deployment.
  const restored=JSON.parse(fs.readFileSync(artifactFile));assert.deepEqual(restored,JSON.parse(bytes));
  const sourceCommit='a'.repeat(40),artifact={file:artifactFile,sha256:sha(bytes)};
  const verificationFile=path.join(dir,'rebuild-readback.json'),verification={contract:'deployment-rebuild-readback-v1',scope:'isolated-provider-rebuild',status:'complete',complete:true,deploymentId:id,sourceCommit,artifactSha256:artifact.sha256,failedChecks:[],firstBlocker:null};fs.writeFileSync(verificationFile,JSON.stringify(verification));
  const proofFile=path.join(dir,'retirement.json'),proof={contract:'cleanup-deployment-retirement-evidence-v1',scope:'isolated-test-only-no-formal-approval',deploymentId:id,url:item.url,createdAt:item.createdAt,status:'retired',owner:'isolated-release-owner-fixture',approvedBy:'isolated-approval-fixture',referenceAuditComplete:true,formalAcceptance:false,rollbackRequired:false,incidentState:'none',references:[],holds:[],checkedAt,sourceCommit,rebuildArtifact:artifact,rebuildVerification:{file:verificationFile,sha256:sha(fs.readFileSync(verificationFile))}};fs.writeFileSync(proofFile,JSON.stringify(proof));
  entries.push({kind:'vercel-deployment',deploymentId:id,url:item.url,createdAt:item.createdAt,retirementEvidence:{file:proofFile,sha256:sha(fs.readFileSync(proofFile))}});
 }
 const manifest=path.join(runtime,'config/cleanup-retired-assets.json');fs.mkdirSync(path.dirname(manifest),{recursive:true});fs.writeFileSync(manifest,JSON.stringify({contract:'cleanup-retired-assets-v1',scope:'isolated-fixture',entries}));return entries;
}
module.exports={seed};
