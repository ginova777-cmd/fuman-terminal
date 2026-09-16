'use strict';
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {createSender}=require('./telegram-delivery.cjs');
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'telegram-send-fixture-')),keys=[],calls=[];
 const sender=createSender({targets:['test-a','test-b','test-a'],token:'unit-only',runtimeRoot:root,guardedSend:async x=>{keys.push(x.options.idempotencyKey);return {sent:true,result:await x.send()};},fetchImpl:async(u,o)=>{calls.push(JSON.parse(o.body).chat_id);return{ok:true,json:async()=>({ok:true,result:{message_id:calls.length}})};}});
 const intent={event_id:'test-event',dedup_key:'stable-test-key',timestamp:new Date().toISOString(),trade_date:'2026-09-16',text:'fixture only'};
 const first=await sender(intent);assert.equal(first.length,2);assert.equal(first.filter(x=>x.sent).length,2);assert.notEqual(keys[0],keys[1]);assert.deepEqual(calls,['test-a','test-b']);
 const repeat=await sender(intent);assert.equal(calls.length,2);assert(repeat.every(x=>x.previouslyDelivered));
 const bad=createSender({targets:['test-c'],token:'unit-only',runtimeRoot:root,guardedSend:async x=>({sent:true,result:await x.send()}),fetchImpl:async()=>({ok:true,json:async()=>({ok:false})})});
 assert.equal((await bad(intent))[0].sent,false);
 fs.rmSync(root,{recursive:true});console.log('PASS per-target idempotency, duplicate target removal, durable acknowledgements, replayed acknowledgements, HTTP-200 API rejection; no network');
})().catch(e=>{console.error(e);process.exitCode=1;});
