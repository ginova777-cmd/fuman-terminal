'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {refresh}=require('../lib/mother-pool-futures-catalogue');
const {createCatalogueRetry}=require('../lib/futopt-catalogue-retry.cjs');
(async()=>{
 const runtime=fs.mkdtempSync(path.join(os.tmpdir(),'catalogue-retry-'));
 try{
  let calls=0,clock=Date.parse('2026-10-04T08:00:00Z'),state=null;
  const options={runtime,tradeDate:'2026-10-04',asOf:new Date(clock).toISOString(),key:'test',fetchImpl:async()=>{calls++;return {status:200,json:async()=>({date:'2026-10-02',type:'FUTURE',exchange:'TAIFEX',session:'REGULAR',data:[]})};}};
  const dependencies={refresh,readState:()=>state,writeState:r=>{state=r;},now:()=>clock};
  for(const wait of [60000,120000,240000,300000]){
   let attempt=createCatalogueRetry(dependencies),result=await attempt(options);
   assert.equal(result.status,'blocked');assert.equal(result.retry_after_ms,wait);assert.equal(result.receipt.provider_identity.date,'2026-10-02');assert.equal(result.receipt.error,'FUTURES_CATALOGUE_PROVIDER_DATE_PENDING');
   const before=calls;attempt=createCatalogueRetry(dependencies);assert.equal((await attempt(options)).status,'backoff');assert.equal(calls,before);clock+=wait;
  }
  assert.equal(calls,4,'one Fugle request per attempt, no TAIFEX request after wrong provider date');
  assert.equal(fs.existsSync(path.join(runtime,'data/futures-catalogue/2026-10-04.json')),false);
  const ready=await createCatalogueRetry({...dependencies,refresh:async()=>({trade_date:'2026-10-05'})})(options);assert.equal(ready.status,'ready');assert.equal(state.failures,0);
  console.log('PASS provider-date evidence, no false catalogue, no unnecessary TAIFEX request, restart-persistent 1/2/4/5 backoff and reset');
 }finally{fs.rmSync(runtime,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
