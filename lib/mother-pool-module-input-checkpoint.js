'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {identityFields}=require('./mother-pool-module-write-set');
const {writeExclusive}=require('./daytrade-durable-json');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function save({directory,identity,inputs,observedAt}){
 if(!Number.isFinite(Date.parse(observedAt))||identityFields.some(k=>identity[k]==null||identity[k]===''))throw Error('MODULE_INPUT_CHECKPOINT_IDENTITY');
 const concrete=[],deferred=[];
 for(const input of inputs){
  if(typeof input.build==='function'){deferred.push(input.module_id);continue;}
  if(identityFields.some(k=>input[k]!==identity[k]))throw Error('MODULE_INPUT_CHECKPOINT_MIXED_IDENTITY');
  concrete.push(JSON.parse(JSON.stringify(input)));
 }
 const ids=[...concrete.map(x=>x.module_id),...deferred];if(new Set(ids).size!==ids.length)throw Error('MODULE_INPUT_CHECKPOINT_DUPLICATE');
 const document={contract:'mother_pool_module_inputs_checkpoint_v1',identity,observed_at:observedAt,inputs:concrete,deferred_modules:deferred,complete:false};
 const bytes=JSON.stringify(document),digest=sha(bytes),file=path.join(directory,digest+'.json');
 writeExclusive(file,document);return {file,content_sha256:digest,modules:concrete.map(x=>x.module_id),deferred_modules:deferred,complete:false};
}
function load(reference,identity){
 const document=JSON.parse(fs.readFileSync(reference.file,'utf8'));
 if(sha(JSON.stringify(document))!==reference.content_sha256||document.contract!=='mother_pool_module_inputs_checkpoint_v1'||identityFields.some(k=>document.identity[k]!==identity[k]))throw Error('MODULE_INPUT_CHECKPOINT_MISMATCH');
 return document;
}
module.exports={save,load};
