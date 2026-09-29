'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const {verify}=require('../lib/daytrade-module-write-ack');
const {writeExclusive}=require('../lib/daytrade-durable-json');
const {hash,identityFields}=require('../lib/mother-pool-module-write-set');
async function recover({file,sha256,out,url,key,guard,fetchImpl=fetch}){
 const bytes=fs.readFileSync(file);
 if(!/^[a-f0-9]{64}$/.test(sha256||'')||crypto.createHash('sha256').update(bytes).digest('hex')!==sha256)throw Error('MODULE_INTENT_FILE_HASH_MISMATCH');
 const document=JSON.parse(bytes);
 if(document.contract!=='mother_pool_module_write_set_v1'||document.ack||document.plan_hash!==hash(document.plan)||identityFields.some(k=>document[k]==null||document[k]===''))throw Error('MODULE_INTENT_INVALID');
 if(!require('../data/contracts/mother-pool-a01-b24-module-registry-v1.json').modules[document.module_id])throw Error('MODULE_ID_INVALID');
 if(path.resolve(file)===path.resolve(out)||fs.existsSync(out))throw Error('RECOVERY_OUTPUT_ALREADY_EXISTS');
 const origin=new URL(url);
 if(origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw Error('SUPABASE_ORIGIN_REQUIRED');
 if(!key)throw Error('SERVICE_CREDENTIAL_REQUIRED');
 const expected=document.plan.requested_symbols;
 if(!Array.isArray(expected)||!expected.length||expected.length>10000||new Set(expected).size!==expected.length)throw Error('MODULE_RECOVERY_SET_INVALID');
 await guard();
 const pages=[];
 async function read(resource,select,max){
  const rows=[];let total=null;
  do{
   const offset=rows.length,query=new URLSearchParams({module_id:'eq.'+document.module_id,trade_date:'eq.'+document.trade_date,writer_run_id:'eq.'+document.writer_run_id,select,order:resource.endsWith('round_v2')?'writer_run_id.asc':'symbol.asc',limit:'500',offset:String(offset)});
   const response=await fetchImpl(new URL('rest/v1/'+resource+'?'+query,origin),{method:'GET',redirect:'error',headers:{apikey:key,Authorization:'Bearer '+key,Prefer:'count=exact'},signal:AbortSignal.timeout(20000)});
   if(response.status!==200)throw Error('MODULE_RECOVERY_HTTP_'+response.status);
   const chunk=await response.json(),range=response.headers.get('content-range'),m=/^(\d+)-(\d+)\/(\d+)$/.exec(range||'');
   if(!Array.isArray(chunk)||!chunk.length||chunk.length>500||!m||Number(m[1])!==offset||Number(m[2])!==offset+chunk.length-1||Number(m[3])>max||Number(m[3])<offset+chunk.length||(total!==null&&Number(m[3])!==total))throw Error('MODULE_RECOVERY_PAGE_INVALID');
   total=Number(m[3]);pages.push({resource,offset,count:chunk.length,http_status:response.status,content_range:range});rows.push(...chunk);
  }while(rows.length<total);
  return rows;
 }
 const rounds=await read('fugle_daytrade_module_round_v2','module_id,trade_date,writer_run_id,document,committed_at',1);
 // Reject a different document before reading its potentially large row set.
 if(!require('node:util').isDeepStrictEqual(rounds[0].document,document))throw Error('MODULE_ACK_DOCUMENT_MISMATCH');
 const rows=await read('fugle_daytrade_module_rows_v2','module_id,trade_date,writer_run_id,symbol,evidence',expected.length);
 const ack={...verify(document,rounds,rows),acknowledgement_mode:'exact_readback_after_interruption'};
 writeExclusive(out,{...document,ack,recovery:{mode:'same_batch_readonly_recovery',intent_file:path.resolve(file),intent_sha256:sha256,checked_at:new Date().toISOString(),pages,complete:false,scope:'module_write_only'}});
 return {mode:'same_batch_readonly_recovery',module_id:document.module_id,...Object.fromEntries(identityFields.map(k=>[k,document[k]])),written:ack.written_symbols.length,out:path.resolve(out),complete:false,scope:'module_write_only'};
}
async function main(){const arg=k=>process.argv.find(s=>s.startsWith('--'+k+'='))?.slice(k.length+3);
 const file=arg('intent'),out=arg('out'),sha256=arg('sha256');if(!file||!out||!sha256)throw Error('--intent, --sha256 and new --out are required');
 const result=await recover({file,sha256,out,url:process.env.SUPABASE_URL||process.env.FUMAN_SUPABASE_URL,key:process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.FUMAN_SUPABASE_SERVICE_ROLE_KEY,
  guard:async()=>{const p=spawnSync(process.execPath,[path.join(__dirname,'supabase-incident-guard.js'),'check','--class=full-verifier','--action=module-intent-readonly-recovery'],{windowsHide:true,encoding:'utf8',timeout:10000});if(p.status!==0)throw Error('INCIDENT_GUARD_BLOCKED');}});console.log(JSON.stringify(result));}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={recover};
