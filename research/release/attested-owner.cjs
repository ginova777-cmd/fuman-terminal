'use strict';
const fs=require('fs'),path=require('path'),cp=require('child_process'),crypto=require('crypto');
const {local,sha}=require('./producer-handoff.cjs');
async function launch(configFile){
 const c=JSON.parse(fs.readFileSync(local(configFile)));if(c.scope!=='ISOLATED_REVIEW')throw Error('SCOPE');
 const child=cp.fork(path.join(__dirname,'attested-bootstrap.cjs'),[configFile],{silent:true,execArgv:['--max-old-space-size=128','--disallow-code-generation-from-strings'],env:{SystemRoot:process.env.SystemRoot,PATH:process.env.PATH,FUMAN_CHANGE_EVIDENCE_PHASE1:'0',MP_PHASE2_ENABLED:'0',MP_PHASE3_ENABLED:'0',MP_PHASE4_ENABLED:'0'}});
 let stderr='';child.stderr.on('data',b=>{stderr=(stderr+b).slice(-4096);});
 try{
 const message=await new Promise((resolve,reject)=>{const t=setTimeout(()=>{reject(Error('ATTESTATION_TIMEOUT'));},12000);child.once('message',m=>{clearTimeout(t);resolve(m);});child.once('exit',()=>{clearTimeout(t);reject(Error('EARLY_EXIT '+stderr));});});
 if(message.status!=='LOADED_DECLARED_CJS')throw Error('OWNER_ATTESTATION_REJECTED:'+message.reason);
 const os=JSON.parse(cp.execFileSync('pwsh',['-NoProfile','-Command',`Get-CimInstance Win32_Process -Filter 'ProcessId=${child.pid}' | Select-Object ProcessId,CreationDate,ExecutablePath | ConvertTo-Json -Compress`],{encoding:'utf8',timeout:12000,windowsHide:true}).replace(/^\uFEFF/,''));
 if(message.status!=='LOADED_DECLARED_CJS'||message.pid!==child.pid||message.parent_pid!==process.pid||message.challenge!==c.challenge||message.manifest_hash!==c.manifest_hash||os.ProcessId!==child.pid||!os.CreationDate||!os.ExecutablePath||path.resolve(os.ExecutablePath).toLowerCase()!==path.resolve(process.execPath).toLowerCase())throw Error('OWNER_ATTESTATION_REJECTED');
 const receipt={...message,creation_date:os.CreationDate,os_executable:os.ExecutablePath,owner_pid:process.pid,owner_verified:true,bootstrap_sha256:sha(fs.readFileSync(path.join(__dirname,'attested-bootstrap.cjs'))),trust:'ISOLATED_OWNER_NOT_FORMAL_AUTHORITY'};
 return {child,receipt};
 }catch(e){child.kill();throw e;}
}
module.exports={launch};
