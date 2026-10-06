'use strict';
const assert=require('node:assert/strict');const {createReadback}=require('../lib/mother-shared-water-anon-readback.cjs');
const key='test.'+Buffer.from(JSON.stringify({role:'anon'})).toString('base64url')+'.test';
const good={symbol:'1216',trade_date:'2026-10-06',price:70,last_trade_time:'2026-10-06T04:55:00Z'};
let count=0;
async function run(body,range,status=200){let requests=0;const read=createReadback({url:'https://example.invalid',key,fetchImpl:async()=>{requests++;return new Response(JSON.stringify(body),{status,headers:{'content-range':range}});}});return {result:await read(['1216'],'2026-10-06'),requests};}
(async()=>{let r=await run([good],'0-0/1');assert.equal(r.requests,1);assert.equal(r.result.returned_count,1);count++;
 r=await run([],'*/0');assert.deepEqual(r.result.missing_symbols,['1216']);count++;
 for(const [body,range,status]of [[[good],'0-0/2',200],[[{...good,trade_date:'2026-10-05'}],'0-0/1',200],[[good,good],'0-1/2',200],[{},'',500]]){await assert.rejects(()=>run(body,range,status));count++;}
 assert.throws(()=>createReadback({url:'https://example.invalid',key:'x.'+Buffer.from('{"role":"service_role"}').toString('base64url')+'.x'}));count++;
 console.log(JSON.stringify({ok:true,cases:count,mode:'mock_http',production_connected:false}));
})().catch(e=>{console.error(e);process.exitCode=1;});
