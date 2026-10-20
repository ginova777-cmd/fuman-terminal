'use strict';
const {randomUUID,createHash}=require('node:crypto');
// Logs identities and query shape, never headers, response bodies or raw URLs.
async function request(url,options,{step,deadline,timeoutMs=30000,symbolCount=null,fetchImpl=global.fetch}={}){
 const started=Date.now(),u=new URL(url),params={};
 for(const name of ['limit','offset','trade_date','order','on_conflict'])if(u.searchParams.has(name))params[name]=u.searchParams.get(name);
 params.query_sha256=createHash('sha256').update(u.search).digest('hex');
 const id={run_id:process.env.FUMAN_CANDLE_SYNC_RUN_ID||'unbound',step,request_id:randomUUID(),entry:u.pathname.split('/').pop(),parameters:params,symbol_count:symbolCount,timeout_ms:Math.max(1,Math.min(timeoutMs,deadline-started)),round_remaining_ms:deadline-started};
 const emit=x=>console.log(JSON.stringify({stage:'writer_operation',...id,...x}));
 emit({event:'start',started_at:new Date(started).toISOString()});
 try{
  const r=await fetchImpl(url,{...options,signal:AbortSignal.timeout(id.timeout_ms)});
  let raw,data;
  if(typeof r.text==='function'){raw=await r.text();try{data=raw?JSON.parse(raw):null;}catch{data=null;}}
  else {data=typeof r.json==='function'?await r.json():null;raw=JSON.stringify(data)||'';}
  emit({event:'end',finished_at:new Date().toISOString(),elapsed_ms:Date.now()-started,http_status:r.status??(r.ok?200:null),returned_rows:Array.isArray(data)?data.length:null,response_bytes:Buffer.byteLength(raw)});
  return {ok:r.ok,status:r.status,json:async()=>{if(data===null&&raw)throw Error('WRITER_RESPONSE_NOT_JSON');return data;},text:async()=>raw};
 }catch(e){emit({event:'error',finished_at:new Date().toISOString(),elapsed_ms:Date.now()-started,http_status:null,exception_type:e.name||'Error',exception_code:e.code??null});throw e;}
}
module.exports={request};
