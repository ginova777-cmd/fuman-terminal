'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');const {createSourceReadback}=require('../lib/mother-shared-water-source-readback.cjs');
const root=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'shared-source-test-'));fs.mkdirSync(path.join(root,'state'));fs.writeFileSync(path.join(root,'state','daytrade-mother-pool-snapshot-latest.json'),'{}');
const key='test.'+Buffer.from(JSON.stringify({role:'anon'})).toString('base64url')+'.test';
(async()=>{
 let calls=0;const make=(status,range)=>createSourceReadback({url:'https://example.invalid',key,runtimeRoot:root,fetchImpl:async()=>{calls++;return new Response(JSON.stringify([{source_name:'fugle_daytrade_source'}]),{status,headers:{'content-range':range}});}});
 const value=await make(200,'0-0/1')();assert.equal(value.sourceStatus.source_name,'fugle_daytrade_source');assert.equal(value.snapshotBytes.toString(),'{}');
 await assert.rejects(make(403,'0-0/1')(),/HTTP_403/);
 await assert.rejects(make(200,'0-0\/2')(),/COUNT_INVALID/);
 assert.throws(()=>createSourceReadback({url:'https://example.invalid',key:'not-anon',runtimeRoot:root}),/ANON_REQUIRED/);
 assert.equal(calls,3);console.log(JSON.stringify({ok:true,cases:4,mode:'bounded_anon_source_readback',real_http_requests:0}));
})().catch(e=>{console.error(e);process.exitCode=1;});
