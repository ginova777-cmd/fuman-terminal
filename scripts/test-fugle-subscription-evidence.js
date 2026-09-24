'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {create}=require('../lib/fugle-subscription-evidence');
const at='2026-09-18T06:00:00+08:00',later='2026-09-18T06:00:01+08:00';let checks=0;
const tracker=create('connection-1');
tracker.message({event:'error',data:{message:'Invalid authentication credentials'}},at);assert.equal(tracker.snapshot().authenticated,false);assert.equal(tracker.request('trades','2330',at),false);checks++;
tracker.message({event:'heartbeat',data:{message:'authenticated'}},at);assert.equal(tracker.snapshot().authenticated,false);checks++;
tracker.message({event:'authenticated',data:{message:'Authenticated successfully'}},at);assert.equal(tracker.snapshot().authenticated,true);checks++;
for(const channel of ['trades','aggregates','candles'])assert(tracker.request(channel,'2330',at));assert.equal(tracker.snapshot().pending.length,3);assert.equal(tracker.snapshot().acknowledged.length,0);checks++;
tracker.message({event:'subscribed',data:{id:'a',channel:'trades',symbol:'2330'}},later);assert.equal(tracker.snapshot().pending.length,2);checks++;
tracker.message({event:'subscribed',data:[{id:'b',channel:'aggregates',symbol:'2330'},{id:'c',channel:'candles',symbol:'2330'}]},later);assert.equal(tracker.snapshot().pending.length,0);checks++;
tracker.message({event:'subscribed',data:{id:'other',channel:'trades',symbol:'2317'}},later);assert.equal(tracker.snapshot().acknowledged.length,3);checks++;
tracker.message({event:'unsubscribed',data:{id:'a'}},later);assert.equal(tracker.snapshot().pending.length,1);checks++;
tracker.message({event:'subscriptions',data:[{id:'c',channel:'candles',symbol:'2330'}]},later);assert.equal(tracker.snapshot().pending.length,2);checks++;
tracker.close(later);tracker.message({event:'authenticated'},later);assert.equal(tracker.snapshot().authenticated,false);assert.equal(tracker.snapshot().acknowledged.length,0);checks++;
const source=fs.readFileSync(require.resolve('./fugle-websocket-collector'),'utf8');
const start=source.indexOf('      ws.addEventListener("message", (event) => {'),end=source.indexOf('        const data = payload?.data || payload || {};',start);assert(start>=0&&end>start);
const prefix=source.slice(source.indexOf('{',start)+1,end);
const context={messages:0,authenticated:false,lastTransportMessageAt:'',lastWebSocketHeartbeatAt:'',lastSubscribeSignature:'',subscriptionEvidence:create('actual-callback'),nowIso:()=>at,subscribe:()=>{context.subscriptions++;},subscriptions:0,marketReached:0,forbiddenChunks:0,forbiddenSymbols:0,STREAMING_SUBSCRIBE_CHUNK_SIZE:1,getStreamingNotice:p=>({noticeText:p?.data?.message||'',eventName:p?.event||''})};
const callback=vm.runInNewContext('(event)=>{'+prefix+'marketReached++;}',context);
callback({data:JSON.stringify({event:'error',data:{message:'Invalid authentication credentials'}})});assert.equal(context.authenticated,false);assert.equal(context.subscriptions,0);assert.equal(context.marketReached,0);checks++;
callback({data:JSON.stringify({event:'authenticated'})});assert.equal(context.authenticated,true);assert.equal(context.subscriptions,1);assert.equal(context.marketReached,0);checks++;
callback({data:JSON.stringify({event:'heartbeat'})});assert.equal(context.lastWebSocketHeartbeatAt,at);assert.equal(context.marketReached,0);checks++;
callback({data:JSON.stringify({event:'subscribed',data:{id:'a',channel:'trades',symbol:'2330'}})});assert.equal(context.marketReached,0);checks++;
callback({data:JSON.stringify({event:'data',data:{symbol:'2330',price:100}})});assert.equal(context.marketReached,1);checks++;
callback({data:JSON.stringify({event:'error',data:{message:'Invalid authentication credentials'}})});assert.equal(context.authenticated,false);assert.equal(context.marketReached,1);checks++;
const snapshotStart=source.indexOf('        const ack = subscriptionEvidence.snapshot();'),snapshotEnd=source.indexOf('      scheduleSourceStatusHeartbeat(statusSnapshot);',snapshotStart);assert(snapshotStart>0&&snapshotEnd>snapshotStart);
function actualSnapshot(t){let value;vm.runInNewContext('(()=>{if(true){'+source.slice(snapshotStart,snapshotEnd)+'})()',{
 subscriptionEvidence:t,selection:{subscriptionCount:3,requested:1,selected:['2330']},statusSnapshot:{websocketConnected:true,canonicalRunId:'fugle_daytrade_source:20260918:canonical',updatedAt:later},snapshotTradeDate:'2026-09-18',cycles:1,STREAMING_CHANNELS:['trades','aggregates','candles'],crypto:require('node:crypto'),path:require('node:path'),RUNTIME_DIR:'unused',writeJson:(_file,data)=>{value=data;}
});return value;}
const partial=create('c2');partial.message({event:'authenticated'},at);for(const channel of ['trades','aggregates','candles'])partial.request(channel,'2330',at);
assert.equal(actualSnapshot(partial).complete,false);assert.equal(actualSnapshot(partial).subscribed_count,0);checks++;
partial.message({event:'subscribed',data:{id:'a',channel:'trades',symbol:'2330'}},later);assert.equal(actualSnapshot(partial).complete,false);checks++;
partial.message({event:'subscribed',data:[{id:'b',channel:'aggregates',symbol:'2330'},{id:'c',channel:'candles',symbol:'2330'}]},later);assert.equal(actualSnapshot(partial).complete,true);assert.equal(actualSnapshot(partial).exit_code,0);checks++;
partial.close(later);assert.equal(actualSnapshot(partial).complete,false);assert.equal(actualSnapshot(partial).exit_code,1);checks++;
console.log(JSON.stringify({checks,scope:'isolated_actual_Collector_callback_and_subscription_tracker',production_complete:false}));
