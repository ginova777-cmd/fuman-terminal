const assert=require('node:assert/strict');
const {createHealth}=require('../lib/futopt-stream-health.cjs');
let clock=Date.parse('2026-10-04T08:00:00Z');
const health=createHealth({symbols:['TXFJ6'],channels:['trades','candles'],now:()=>clock});
assert.equal(health.observe({event:'error',message:'authentication failed'}).authenticated,false);
const h=createHealth({symbols:['TXFJ6'],channels:['trades','candles'],now:()=>clock});
h.observe({event:'authenticated'});
h.observe({event:'subscribed',data:[{symbol:'TXFJ6',channel:'trades'},{symbol:'TXFK6',channel:'candles'}]});
assert.equal(h.snapshot().subscriptions_ready,false);
h.observe({event:'subscribed',data:{symbol:'TXFJ6',channel:'candles'}});
assert.equal(h.snapshot().subscriptions_ready,true);
for(let i=0;i<30;i++){clock+=30000;h.observe({event:'heartbeat'});assert.equal(h.snapshot().transport_age_ms,0);}
clock+=121000;assert.equal(h.snapshot().transport_age_ms,121000);
assert.equal(h.observe({event:'error'}).subscriptions_ready,false);
console.log('PASS: exact auth, per-symbol/channel ACK, heartbeat without trades, transport silence and protocol errors');
