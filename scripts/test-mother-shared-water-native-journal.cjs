'use strict';
const assert=require('node:assert/strict'),{createHash}=require('node:crypto'),{createJournal}=require('../lib/mother-shared-water-native-journal.cjs');
const at='2026-10-06T04:59:55Z',t=Date.parse(at)*1000;
const aggregate=()=>({event:'data',channel:'aggregates',id:'a',data:{symbol:'1216',date:'2026-10-06',lastUpdated:t,lastTrade:{time:t-300000000,price:70}}});
function ready(opts={}){const j=createJournal({connectionId:'c',...opts});j.request('trades','1216');j.request('aggregates','1216');j.observe({event:'authenticated'},at);j.observe({event:'subscribed',data:[{channel:'trades',symbol:'1216',id:'t'},{channel:'aggregates',symbol:'1216',id:'a'}]},at);j.observe(aggregate(),at);return j;}
let cases=0;function test(f){f();cases++;}
test(()=>{const j=ready();j.observe({event:'heartbeat',data:{time:'native-time'}},at);const w=JSON.parse(j.snapshot(at).rows[0].raw_utf8);assert.equal(w.events.length,1);assert.equal(w.trade_ack.raw.data.id,'t');assert.equal(w.heartbeat.raw.event,'heartbeat');const e={...w.events[0]};delete e.sha256;assert.equal(createHash('sha256').update(JSON.stringify(e)).digest('hex'),w.head_sha256);});
test(()=>{const j=ready(),raw={event:'data',channel:'trades',id:'t',data:{symbol:'1216',time:t,serial:999,price:71}};j.observe(raw,at);raw.data.price=99;const w=JSON.parse(j.snapshot(at).rows[0].raw_utf8);assert.equal(w.event_count,2);assert.equal(w.events[1].raw.data.price,71);assert.equal(w.events[1].previous_sha256,w.events[0].sha256);});
for(const event of [null,{event:'error'},{event:'unsubscribed',data:{id:'t'}},{event:'data',channel:'trades',id:'wrong',data:{symbol:'1216',time:t,serial:1}}])test(()=>{const j=ready();j.observe(event,at);assert.equal(j.snapshot(at).rows.length,0);});
test(()=>{const j=ready({maxEventsPerSymbol:1});j.observe({event:'data',channel:'trades',id:'t',data:{symbol:'1216',time:t,serial:1}},at);assert.equal(j.snapshot(at).rows.length,0);});
test(()=>{const j=ready({maxBytes:10});assert.equal(j.snapshot(at).rows.length,0);});
test(()=>{const j=ready();j.close();assert.equal(j.snapshot(at).rows.length,0);});
console.log(JSON.stringify({ok:true,cases,mode:'isolated',production_connected:false,no_new_trade_enabled:false}));
