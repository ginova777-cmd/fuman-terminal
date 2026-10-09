'use strict';
const fs=require('fs'),path=require('path'),cp=require('child_process');
const adapter=require('./junction-graceful-stop-adapter.cjs');
const {guardOwner}=require('./OwnerAuthorization.cjs');
async function execute(c,expected,authorize){
 const config={scope:'FORMAL_OWNER',runtime:c.runtime,approvedRoot:c.prod,approvedHash:c.collector_entry_sha256,authorize};
 const frozen=adapter.prepare(config);
 if(frozen.pid!==expected.pid||frozen.executable.toLowerCase()!==expected.exe.toLowerCase())throw Error('BOUND_PID_MISMATCH');
 const ticks=cp.execFileSync('pwsh',['-NoProfile','-Command',`(Get-Process -Id ${frozen.pid}).StartTime.ToUniversalTime().Ticks`],{encoding:'utf8',windowsHide:true,timeout:10000}).trim();
 if(ticks!==String(expected.creation_ticks))throw Error('BOUND_CREATION_MISMATCH');
 // Refresh the short-lived identity proof after the extra Windows read.
 const fresh=adapter.prepare(config);
 if(fresh.owner_hash!==frozen.owner_hash||fresh.pid!==frozen.pid)throw Error('OWNER_DRIFT');
 return adapter.stop(config,fresh);
}
if(require.main===module){
 const [ownerFile,expectedFile]=process.argv.slice(2);
 const c=JSON.parse(fs.readFileSync(path.join(__dirname,'release-config.json'),'utf8'));
 execute(c,JSON.parse(fs.readFileSync(expectedFile,'utf8').replace(/^\uFEFF/,'')),()=>guardOwner(__dirname,c,ownerFile,'stop')).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(JSON.stringify({status:'GRACEFUL_STOP_BLOCKED',error:e.message,force_fallback:false}));process.exitCode=1;});
}
module.exports={execute};
