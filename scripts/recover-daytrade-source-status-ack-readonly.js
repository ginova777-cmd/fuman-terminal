'use strict';
// Acknowledges one preserved write only. Never replays a write or completes a round.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const journal=require('../lib/daytrade-source-status-journal');
const {acknowledgeStored}=require('../lib/daytrade-source-status-ack');
async function recover({checkpoint,url,key,guard,fetchImpl=fetch}){
 if(!/^[a-f0-9]{64}$/.test(checkpoint?.row_sha256||''))throw Error('CHECKPOINT_HASH_REQUIRED');
 const row=journal.read(checkpoint);
 if(row.source_name!=='fugle_daytrade_source')throw Error('SOURCE_NAME_INVALID');
 if(fs.existsSync(checkpoint.file+'.ack.json'))throw Error('ACK_ALREADY_EXISTS');
 const endpoint=new URL(url);
 if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||endpoint.search||endpoint.hash||endpoint.pathname!=='/')throw Error('SUPABASE_ORIGIN_REQUIRED');
 if(!key)throw Error('SERVICE_CREDENTIAL_REQUIRED');
 await guard();
 const ack=await acknowledgeStored({row,read:async expected=>{
  const query=new URLSearchParams({source_name:'eq.'+expected.source_name,trade_date:'eq.'+expected.trade_date,
   'payload->>canonical_run_id':'eq.'+expected.payload.canonical_run_id,
   'payload->>writer_run_id':'eq.'+expected.payload.writer_run_id,
   'payload->>generation_id':'eq.'+expected.payload.generation_id,
   select:Object.keys(expected).join(','),limit:'2'});
  const response=await fetchImpl(new URL('rest/v1/source_status?'+query,endpoint),{
   method:'GET',redirect:'error',headers:{apikey:key,Authorization:'Bearer '+key,Accept:'application/json'},signal:AbortSignal.timeout(20000)});
  if(response.status!==200)throw Error('SOURCE_STATUS_READ_HTTP_'+response.status);
  return await response.json();
 }});
 return journal.confirm(checkpoint,ack);
}
async function main(){
 const arg=name=>process.argv.find(x=>x.startsWith('--'+name+'='))?.slice(name.length+3);
 const file=arg('intent'),sha=arg('sha256');if(!file||!sha)throw Error('Explicit --intent and --sha256 are required');
 const result=await recover({checkpoint:{file:path.resolve(file),row_sha256:sha},
  url:process.env.SUPABASE_URL||process.env.FUMAN_SUPABASE_URL||'https://cpmpfhbzutkiecccekfr.supabase.co',
  key:process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.FUMAN_SUPABASE_SERVICE_ROLE_KEY,
  guard:async()=>{const r=spawnSync(process.execPath,[path.join(__dirname,'supabase-incident-guard.js'),'check','--class=full-verifier','--action=source-status-exact-ack-recovery'],{stdio:'pipe',windowsHide:true,timeout:10000});if(r.status!==0)throw Error('INCIDENT_GUARD_BLOCKED');}});
 console.log(JSON.stringify(result));
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={recover};
