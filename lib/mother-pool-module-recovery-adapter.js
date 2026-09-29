'use strict';
const path=require('node:path'),crypto=require('node:crypto'),fs=require('node:fs');
const {isDeepStrictEqual}=require('node:util');
const journal=require('./daytrade-module-attempt-journal');
const {writeExclusive}=require('./daytrade-durable-json');
function create({url,key,directory,guard,assertLease,fetchImpl=fetch}){
 const base=url.replace(/\/$/,'');
 function attempted(document){
  let found=journal.inspect(path.join(directory,'attempts'),document);
  // Older releases used UUID plan files, before the keyed attempt journal.
  // An unreadable legacy intent is uncertainty, never permission to POST.
  for(const name of fs.readdirSync(directory).filter(n=>n.endsWith('-plan.json'))){
   const previous=JSON.parse(fs.readFileSync(path.join(directory,name),'utf8'));
   if(['module_id','trade_date','writer_run_id'].every(k=>previous[k]===document[k])){
    if(!isDeepStrictEqual(previous,document))throw Error('MODULE_LEGACY_PLAN_MISMATCH');
    found=true;
   }
  }
  return found;
 }
 async function request(resource,body){
  await assertLease();await guard();
  const response=await fetchImpl(base+'/rest/v1/'+resource,{method:body?'POST':'GET',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',Prefer:'count=exact'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
  if(response.status!==200)throw Error('MODULE_RECOVERY_HTTP_'+response.status);
  return {data:await response.json(),range:response.headers.get('content-range')};
 }
 async function pages(table,document,select,maxRows){
  let offset=0,total=null;const rows=[];
  for(;;){
   const q=new URLSearchParams({module_id:'eq.'+document.module_id,trade_date:'eq.'+document.trade_date,writer_run_id:'eq.'+document.writer_run_id,select,order:table.endsWith('rows_v2')?'symbol.asc':'writer_run_id.asc',limit:'500',offset:String(offset)});
   const response=await request(table+'?'+q),data=response.data;
   if(!Array.isArray(data))throw Error('MODULE_RECOVERY_NOT_ARRAY');
   const match=/^(?:(\d+)-(\d+)|\*)\/(\d+)$/.exec(response.range||'');
   if(!match)throw Error('MODULE_RECOVERY_RANGE_MISSING');
   const count=Number(match[3]);
   if(total!==null&&total!==count)throw Error('MODULE_RECOVERY_TOTAL_CHANGED');
   total=count;
   if(total>maxRows||data.length>500)throw Error('MODULE_RECOVERY_SET_TOO_LARGE');
   if(!data.length){if(total!==0||offset!==0)throw Error('MODULE_RECOVERY_EMPTY_PAGE');return [];}
   if(Number(match[1])!==offset||Number(match[2])!==offset+data.length-1||offset+data.length>total)throw Error('MODULE_RECOVERY_RANGE_MISMATCH');
   for(const row of data)for(const k of ['module_id','trade_date','writer_run_id'])if(row[k]!==document[k])throw Error('MODULE_RECOVERY_ROW_IDENTITY:'+k);
   rows.push(...data);offset+=data.length;
   if(offset===total)return rows;
  }
 }
 return {
  validatePlan:async document=>{attempted(document);},
  hasAttempt:async document=>attempted(document),
  saveAttempt:async document=>{await assertLease();await guard();journal.begin(path.join(directory,'attempts'),document);},
  readCommitted:async document=>({rounds:await pages('fugle_daytrade_module_round_v2',document,'module_id,trade_date,writer_run_id,document,committed_at',1),rows:await pages('fugle_daytrade_module_rows_v2',document,'module_id,trade_date,writer_run_id,symbol,evidence',document.plan.requested_symbols.length)}),
  persist:async body=>(await request('rpc/persist_daytrade_module_round_v2',body)).data,
  saveEvidence:async evidence=>writeExclusive(path.join(directory,crypto.randomUUID()+'.json'),evidence),
 };
}
module.exports={create};
