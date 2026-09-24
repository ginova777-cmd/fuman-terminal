'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function stable(x){return JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);}
const hash=x=>crypto.createHash('sha256').update(stable(x)).digest('hex');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
function atomic(file,x){fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.'+process.pid+'.tmp';fs.writeFileSync(temp,JSON.stringify(x)+'\n');fs.renameSync(temp,file);}
function readSide(runtime,symbol,dates){const out={};for(const date of dates){const files=['provider-trade-journal','provider-side-journal'].map(d=>path.join(runtime,'data',d,date,symbol+'.jsonl'));if(files.every(f=>fs.existsSync(f)))out[date]=Object.fromEntries(files.map((f,i)=>[i?'side':'trades',fs.readFileSync(f,'utf8').split(/\r?\n/).filter(s=>s.trim()).map(JSON.parse)]));}return out;}
function compact(receipt){return {...receipt,rows:receipt.rows.map(({samples,...r})=>r)};}
function client(runtime){
 const url=(process.env.SUPABASE_URL||'https://cpmpfhbzutkiecccekfr.supabase.co').replace(/\/$/,'');
 async function request(resource,{body,service=false}={}){
  const name=service?'supabase-service-role-key.txt':'supabase-anon-key.txt',key=fs.readFileSync(path.join(runtime,'secrets',name),'utf8').trim();
  const r=await fetch(url+'/rest/v1/'+resource,{method:body?'POST':'GET',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',Prefer:'resolution=merge-duplicates,return=minimal'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw Error('A16_DATABASE_HTTP_'+r.status);const text=await r.text();return text?JSON.parse(text):null;
 }
 async function writeReadback(receipt,generation){const payload=compact(receipt),payload_sha256=hash(payload),db={trade_date:receipt.trade_date,canonical_run_id:receipt.canonical_run_id,generation,symbol:receipt.symbol,payload_sha256,payload,updated_at:new Date().toISOString()};
  await request('mother_pool_a16_baselines?on_conflict=trade_date,generation,symbol',{body:[db],service:true});
  const rows=await readback(db);
  if(rows.length!==1||rows[0].payload_sha256!==payload_sha256||hash(rows[0].payload)!==payload_sha256)throw Error('A16_ANON_READBACK_MISMATCH');
  return {written_count:receipt.rows.length,readback_count:rows[0].payload.rows.length,payload_sha256,db_readback_ok:true,anon_readback_ok:true};
 }
 function readback({trade_date,generation,symbol}){return request('v_mother_pool_a16_baselines?select=trade_date,canonical_run_id,generation,symbol,payload_sha256,payload&trade_date=eq.'+encodeURIComponent(trade_date)+'&generation=eq.'+encodeURIComponent(generation)+'&symbol=eq.'+encodeURIComponent(symbol));}
 return {request,writeReadback,readback};
}
module.exports={stable,hash,read,atomic,readSide,compact,client};
