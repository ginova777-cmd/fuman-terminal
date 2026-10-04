'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {PRODUCTS}=require('./stock-future-candidate-contract.cjs');
const {writeExclusive}=require('./daytrade-durable-json');
async function obtain({runtime,tradeDate,asOf,key,fetchImpl=fetch}){
 const now=Date.parse(asOf);
 if(!Number.isFinite(now)||new Date(now+28800000).toISOString().slice(0,10)!==tradeDate)throw Error('PRODUCTS_EXECUTION_DATE');
 const file=path.join(runtime,'data','futures-products',tradeDate+'.json');
 try {const cached=JSON.parse(fs.readFileSync(file,'utf8'));if(cached.trade_date!==tradeDate||cached.url!==PRODUCTS||cached.http_status!==200||crypto.createHash('sha256').update(cached.raw_text).digest('hex')!==cached.raw_sha256||Date.parse(cached.received_at)>now)throw Error('PRODUCTS_CACHE_INVALID');return cached;}catch(e){if(e.code!=='ENOENT')throw e;}
 if(!key)throw Error('FUGLE_CREDENTIAL_REQUIRED');
 fs.mkdirSync(path.dirname(file),{recursive:true});
 // Exclusive file prevents concurrent Writer/Collector metadata requests.
 let fd;try{fd=fs.openSync(file+'.lock','wx');}catch(e){if(e.code==='EEXIST')throw Error('PRODUCTS_CACHE_IN_PROGRESS');throw e;}
 try{
  const r=await fetchImpl(PRODUCTS,{headers:{'X-API-KEY':key},redirect:'error',signal:AbortSignal.timeout(15000)});
  if(r.status!==200)throw Error('FUGLE_PRODUCTS_HTTP_'+r.status);
  const raw=await r.text(),p=JSON.parse(raw),received_at=new Date().toISOString();
  if(p.type!=='FUTURE'||p.exchange!=='TAIFEX'||p.session!=='REGULAR'||p.contractType!=='S'||!Array.isArray(p.data)||new Date(Date.parse(received_at)+28800000).toISOString().slice(0,10)!==tradeDate)throw Error('FUGLE_PRODUCTS_IDENTITY');
  const result={contract:'fugle-stock-future-products-v1',trade_date:tradeDate,url:PRODUCTS,http_status:200,received_at,raw_text:raw,raw_sha256:crypto.createHash('sha256').update(raw).digest('hex')};
  writeExclusive(file,result);return result;
 }finally{fs.closeSync(fd);fs.unlinkSync(file+'.lock');}
}
module.exports={obtain};
