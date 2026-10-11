'use strict';
const fs=require('fs'),path=require('path'),cp=require('child_process');
const adapter=require('./junction-graceful-stop-adapter.cjs');
const {guardOwner}=require('./OwnerAuthorization.cjs');
const releaseBinding=require('./collector-release-binding.cjs');
async function execute(c,expected,authorize){
 let stopMayHaveBeenRequested=false;
 try {
 authorize();
 const release=releaseBinding.select(c);
 if(expected.release_sha&&expected.release_sha!==release.release_sha)throw Error('BOUND_RELEASE_MISMATCH');
 const boundAuthorize=()=>{authorize();releaseBinding.revalidate(c,release);};
 const config={scope:'FORMAL_OWNER',runtime:c.runtime,approvedRoot:c.prod,approvedHash:release.runtime_sha256,authorize:boundAuthorize};
 const frozen=adapter.prepare(config);
 if(frozen.pid!==expected.pid||frozen.executable.toLowerCase()!==expected.exe.toLowerCase())throw Error('BOUND_PID_MISMATCH');
 const ticks=cp.execFileSync('pwsh',['-NoProfile','-Command',`(Get-Process -Id ${frozen.pid}).StartTime.ToUniversalTime().Ticks`],{encoding:'utf8',windowsHide:true,timeout:10000}).trim();
 if(ticks!==String(expected.creation_ticks))throw Error('BOUND_CREATION_MISMATCH');
 // Refresh the short-lived identity proof after the extra Windows read.
 const fresh=adapter.prepare(config);
 if(fresh.owner_hash!==frozen.owner_hash||fresh.pid!==frozen.pid)throw Error('OWNER_DRIFT');
 // From this boundary onward a request may exist. Never infer no STOP from
 // a live PID, a timeout, missing stdout, or a missing receipt.
 stopMayHaveBeenRequested=true;
 const receipt=await adapter.stop(config,fresh);
 return {...receipt,collector_release:release};
 } catch(e) {
  e.stop_not_requested=!stopMayHaveBeenRequested;
  throw e;
 }
}
if(require.main===module){
 const [ownerFile,expectedFile]=process.argv.slice(2);
 const c=JSON.parse(fs.readFileSync(path.join(__dirname,'release-config.json'),'utf8'));
 execute(c,JSON.parse(fs.readFileSync(expectedFile,'utf8').replace(/^\uFEFF/,'')),()=>guardOwner(__dirname,c,ownerFile,'stop')).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.log(JSON.stringify({status:'GRACEFUL_STOP_BLOCKED',error:e.message,stop_not_requested:e.stop_not_requested===true,force_fallback:false}));process.exitCode=1;});
}
module.exports={execute};
