'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const {serviceRoleKey,terminalSupabaseUrl}=require('../lib/server-supabase-key');
const ROOT=path.resolve(__dirname,'..'),RUNTIME=process.env.FUMAN_RUNTIME_DIR||'C:/fuman-runtime';
async function run({apply=false,rpc,save}){
 const before=await rpc(false);if(before?.ok!==true||before.contract!=='duplicate-index-cleanup-v1')throw Error('INVALID_PREVIEW');
 save('plan',before); // Persist restoration DDL before deletion.
 const execution=apply?await rpc(true):null;
 if(apply&&execution?.ok!==true)throw Error('APPLY_FAILED');
 const after=apply?await rpc(false):before;
 const ok=after?.ok===true&&(!apply||after.count===0);
 return {contract:'duplicate-index-cleanup-v1',checkedAt:new Date().toISOString(),ok,applied:apply,status:ok?(apply?'complete':'preview'):'blocked',before,execution,after};
}
async function main(){
 const apply=process.argv.includes('--apply'),date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(new Date()).replaceAll('-','');
 const out={contract:'duplicate-index-cleanup-v1',checkedAt:new Date().toISOString(),ok:false,applied:false};
 const dir=path.join(RUNTIME,'status');fs.mkdirSync(dir,{recursive:true});
 const write=(file,v)=>{const tmp=file+'.'+process.pid+'.tmp';fs.writeFileSync(tmp,JSON.stringify(v,null,2));fs.renameSync(tmp,file);};
 try{
  if(apply){const guard=spawnSync(process.execPath,[path.join(__dirname,'supabase-incident-guard.js'),'check','--class=guard','--action=duplicate-index-cleanup'],{cwd:ROOT,encoding:'utf8',windowsHide:true,timeout:10000});if(guard.status!==0)throw Error('INCIDENT_GUARD_BLOCKED');}
  const key=serviceRoleKey(),url=terminalSupabaseUrl();if(!key||!url)throw Error('CREDENTIALS_MISSING');
  const rpc=async value=>{const r=await fetch(url.replace(/\/$/,'')+'/rest/v1/rpc/fuman_cleanup_duplicate_indexes_v1',{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({p_apply:value}),signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('CLEANUP_HTTP_'+r.status);return r.json();};
  Object.assign(out,await run({apply,rpc,save:(type,v)=>write(path.join(dir,'duplicate-index-cleanup-'+type+'-'+date+'-'+Date.now()+'.json'),v)}));
 }catch(e){out.status='blocked';out.reasonCode=e.message;out.requiresReadback=true;}
 write(path.join(dir,'duplicate-index-cleanup-'+date+'.json'),out);write(path.join(dir,'duplicate-index-cleanup-status.json'),out);
 console.log(JSON.stringify(out));if(!out.ok)process.exitCode=1;
}
module.exports={run};if(require.main===module)main();
