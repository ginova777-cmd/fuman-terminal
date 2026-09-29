'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {verify}=require('./verify-mother-pool-wiring-inventory'),root=path.join(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'wiring-entrypoints-'));
try{
 const files=['data/contracts/mother-pool-a01-b24-module-registry-v1.json','scripts/run-daytrade-source-writer.js','scripts/capture-daytrade-module-readbacks.js','scripts/run-daytrade-module-verifiers.js','scripts/verify-daytrade-module-receipt.js','scripts/verify-daytrade-mother-pool-a01-b24-total.js','lib/verify-mother-pool-module-round.js','lib/preopen-a15-a19.js','lib/intraday-context-detectors-b19-b24.js'];
 for(const f of files){fs.mkdirSync(path.dirname(path.join(tmp,f)),{recursive:true});fs.copyFileSync(path.join(root,f),path.join(tmp,f));}
 assert.equal(verify(tmp).ok,true);assert.equal(verify(tmp).natural_complete,false);
 const target=path.join(tmp,'scripts/capture-daytrade-module-readbacks.js');fs.unlinkSync(target);assert(verify(tmp).failed_checks.includes('ENTRYPOINT_MISSING:scripts/capture-daytrade-module-readbacks.js'));
 fs.copyFileSync(path.join(root,'scripts/capture-daytrade-module-readbacks.js'),target);
 const reg=path.join(tmp,files[0]),j=JSON.parse(fs.readFileSync(reg));j.modules.A10='removed';fs.writeFileSync(reg,JSON.stringify(j));assert(verify(tmp).failed_checks.includes('MODULE_REGISTRY_SCOPE_INVALID'));
 console.log('PASS static inventory rejects missing entrypoint and removed A10; never claims natural completion');
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
