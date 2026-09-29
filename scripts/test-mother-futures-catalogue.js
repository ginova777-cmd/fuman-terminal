'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {refresh,inspect,FUGLE,TAIFEX}=require('../lib/mother-pool-futures-catalogue');
(async()=>{
 const runtime=fs.mkdtempSync(path.join(os.tmpdir(),'futures-catalogue-')),date='2026-09-29',asOf='2026-09-29T00:00:00Z';
 const html='證券代號 股票期貨<tr>'+['CA','南亞公司','1303','南亞','●','','','◎','','','','2000','',''].map(x=>'<td>'+x+'</td>').join('')+'</tr>';
 let calls=0;
 const options={runtime,tradeDate:date,asOf,key:'test-secret',now:()=>asOf,fetchImpl:async(url,opts)=>{calls++;if(url===FUGLE){assert.equal(opts.headers['X-API-KEY'],'test-secret');return {status:200,json:async()=>({data:[{symbol:'CAFC7',contractType:'S',endDate:'2027-03-17'}]})};}assert.equal(url,TAIFEX);assert.equal(opts.headers,undefined);return {status:200,text:async()=>html};}};
 const snapshot=await refresh(options);assert.equal(calls,2);assert.equal(inspect(snapshot,date,asOf).status,'READY');assert(!JSON.stringify(snapshot).includes('test-secret'));
 assert.deepEqual(await refresh(options),snapshot);assert.equal(calls,2);
 const tampered=structuredClone(snapshot);tampered.raw_fugle.data[0].symbol='ZZFC7';assert.equal(inspect(tampered,date,asOf).status,'BLOCKED');
 assert.equal(inspect(snapshot,'2026-09-30','2026-09-30T00:00:00Z').status,'BLOCKED');
 assert.equal(inspect(snapshot,date,'2026-09-28T23:59:59Z').status,'BLOCKED');
 fs.writeFileSync(path.join(runtime,'data','futures-catalogue',date+'.json'),'{');await assert.rejects(refresh(options),/CACHE_UNREADABLE/);assert.equal(calls,2);
 const failedRuntime=fs.mkdtempSync(path.join(os.tmpdir(),'futures-catalogue-failed-'));await assert.rejects(refresh({...options,runtime:failedRuntime,fetchImpl:async()=>({status:503})}),/HTTP_503/);assert.equal(fs.existsSync(path.join(failedRuntime,'data','futures-catalogue',date+'.json')),false);
 console.log('PASS catalogue fresh source, same-day reuse, hash/date/time checks, corrupt cache refusal, no saved credentials or false success');
})().catch(e=>{console.error(e);process.exitCode=1;});
