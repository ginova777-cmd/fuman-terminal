'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function stable(x){return JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);}
const hash=x=>crypto.createHash('sha256').update(stable(x)).digest('hex');
function read(file){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(cause){const error=new Error('A16_JSON_READ_FAILED:'+file,{cause});error.code=cause.code||'A16_JSON_INVALID';throw error;}}
function atomic(file,x){
 const bytes=JSON.stringify(x)+'\n';
 fs.mkdirSync(path.dirname(file),{recursive:true});
 const temp=file+'.'+process.pid+'.'+crypto.randomUUID()+'.tmp';let fd,created=false;
 try{
  fd=fs.openSync(temp,'wx');created=true;
  fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
  fs.renameSync(temp,file);created=false;
 }finally{
  if(fd!==undefined)try{fs.closeSync(fd);}catch{}
  if(created)try{fs.unlinkSync(temp);}catch{}
 }
}
function readSide(runtime,symbol,dates){const out={};for(const date of dates){const files=['provider-trade-journal','provider-side-journal'].map(d=>path.join(runtime,'data',d,date,symbol+'.jsonl'));if(files.every(f=>fs.existsSync(f)))out[date]=Object.fromEntries(files.map((f,i)=>[i?'side':'trades',fs.readFileSync(f,'utf8').split(/\r?\n/).flatMap((s,line)=>{if(!s.trim())return [];try{return [JSON.parse(s)];}catch(cause){throw new Error('A16_JOURNAL_JSON_INVALID:'+f+':line='+(line+1),{cause});}})]));}return out;}
function compact(receipt){return {...receipt,rows:receipt.rows.map(({samples,...r})=>r)};}
function client(runtime){
 const url=(process.env.SUPABASE_URL||'https://cpmpfhbzutkiecccekfr.supabase.co').replace(/\/$/,'');
 async function request(resource,{body,service=false}={}){
  const name=service?'supabase-service-role-key.txt':'supabase-anon-key.txt',key=fs.readFileSync(path.join(runtime,'secrets',name),'utf8').trim();
  const r=await fetch(url+'/rest/v1/'+resource,{method:body?'POST':'GET',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',Prefer:'resolution=merge-duplicates,return=minimal'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw Error('A16_DATABASE_HTTP_'+r.status);const text=await r.text();return text?JSON.parse(text):null;
 }
 async function writeReadback(receipt,generation){const payload=compact(receipt),payload_sha256=hash(payload),db={trade_date:receipt.trade_date,canonical_run_id:receipt.canonical_run_id,generation,symbol:receipt.symbol,payload_sha256,payload,updated_at:new Date().toISOString()};
  let writeAck='response';
  try{await request('mother_pool_a16_baselines?on_conflict=trade_date,generation,symbol',{body:[db],service:true});}
  catch(e){if(!['TimeoutError','AbortError'].includes(e?.name))throw e;writeAck='exact_readback_after_timeout';}
  return verifyReadback(receipt,generation,writeAck);
 }
 async function verifyReadback(receipt,generation,writeAck='previous_verified_write'){
  const payload=compact(receipt),payload_sha256=hash(payload),db={trade_date:receipt.trade_date,canonical_run_id:receipt.canonical_run_id,generation,symbol:receipt.symbol,payload_sha256};
  let rows;const readback_evidence=[];
  // Stop on an invalid DB readback; do not double outage load with an anon read.
  for(const [role,service] of [['DB',true],['ANON',false]]){
   const result=await readback(db,service);
   if(!service)rows=result;
   if(!Array.isArray(result)||result.length!==1||['trade_date','canonical_run_id','generation','symbol','payload_sha256'].some(k=>result[0][k]!==db[k])||hash(result[0].payload)!==payload_sha256)throw Error('A16_'+role+'_READBACK_MISMATCH');
   readback_evidence.push({role,checked_at:new Date().toISOString(),...db,row_count:result.length});
  }
  return {written_count:receipt.rows.length,readback_count:rows[0].payload.rows.length,payload_sha256,db_readback_ok:true,anon_readback_ok:true,write_ack:writeAck,readback_contract:'a16_db_anon_v2',readback_evidence};
 }
 function readback({trade_date,generation,symbol},service=false){return request((service?'mother_pool_a16_baselines':'v_mother_pool_a16_baselines')+'?select=trade_date,canonical_run_id,generation,symbol,payload_sha256,payload&trade_date=eq.'+encodeURIComponent(trade_date)+'&generation=eq.'+encodeURIComponent(generation)+'&symbol=eq.'+encodeURIComponent(symbol)+'&limit=2',{service});}
 return {request,writeReadback,verifyReadback,readback};
}
module.exports={stable,hash,read,atomic,readSide,compact,client};
