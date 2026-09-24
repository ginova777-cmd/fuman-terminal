'use strict';
const assert=require('node:assert/strict'),{collect,verify}=require('../lib/mother-pool-websocket-source');
function fixture(){
 const date='2026-09-18',at=date+'T06:00:00+08:00',asOf=date+'T06:01:00+08:00',symbols=['1101','2330'];
 const identity={trade_date:date,canonical_run_id:'fugle_daytrade_source:20260918:canonical'};
 const tracker=require('../lib/fugle-subscription-evidence').create('isolated-connection');tracker.message({event:'authenticated'},at);
 for(const symbol of symbols)for(const channel of ['trades','aggregates','candles']){tracker.request(channel,symbol,at);tracker.message({event:'subscribed',data:{symbol,channel,id:symbol+channel}},at);}
 const status={tradeDate:date,canonicalRunId:identity.canonical_run_id,collectorRole:'daytrade',mode:'streaming',streamingUrl:'wss://api.fugle.tw/marketdata/v1.0/stock/streaming',sourceHostId:'isolated-host',pid:123,connectionAttempt:1,websocketConnected:true,websocketAuthenticated:true,streamingOpenedAt:at,updatedAt:asOf,websocketLastMessageAt:asOf,websocketHeartbeatAt:asOf,lastMessageAt:'',streamingChannels:['trades','aggregates','candles'],subscriptionAckEvidence:tracker.snapshot()};
 return {identity,symbols,status,asOf};
}
if(require.main===module){let checks=0;const test=(name,fn)=>{fn();checks++;console.log('PASS '+name);};
 test('acknowledged preopen transport does not invent quote event',()=>{const f=fixture();for(const row of collect(f).rows){assert(verify(row,{...f.identity,observed_at:f.asOf}));assert.equal(row.market_message_seen,false);assert.equal(row.last_market_message_at,null);}});
 for(const [name,change] of [['missing ACK',s=>s.subscriptionAckEvidence.acknowledged.pop()],['unauthenticated',s=>s.websocketAuthenticated=false],['disconnected',s=>s.websocketConnected=false],['missing channel',s=>s.streamingChannels.pop()],['wrong date',s=>s.tradeDate='2026-09-17'],['wrong canonical',s=>s.canonicalRunId='old'],['stale transport',s=>s.websocketLastMessageAt='2026-09-18T05:00:00+08:00'],['future status',s=>s.updatedAt='2026-09-18T07:00:00+08:00'],['ack before request',s=>s.subscriptionAckEvidence.acknowledged[0].acknowledged_at='2026-09-18T05:59:00+08:00'],['closed connection',s=>s.subscriptionAckEvidence.closed_at=s.updatedAt],['wrong endpoint',s=>s.streamingUrl='wss://other.invalid'],['missing reconnect count',s=>delete s.connectionAttempt],['duplicate ACK',s=>s.subscriptionAckEvidence.acknowledged.push(s.subscriptionAckEvidence.acknowledged[0])]])test(name+' rejected',()=>{const f=fixture();change(f.status);const rows=collect(f).rows;assert(rows.some(row=>row.status==='DATA_GAP'));assert(rows.some(row=>!verify(row,{...f.identity,observed_at:f.asOf})));});
 test('heartbeat cannot replace market event',()=>{const f=fixture(),row=collect(f).rows[0];row.market_message_seen=true;row.last_market_message_at=f.status.websocketHeartbeatAt;assert(!verify(row,{...f.identity,observed_at:f.asOf}));});
 test('missing status is explicit gap',()=>{const f=fixture();assert(collect({...f,status:null}).rows.every(r=>r.status==='DATA_GAP'));});
 console.log(JSON.stringify({checks,scope:'isolated_A06_source',production_complete:false}));
}
module.exports={fixture};
